'use client';

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { firebaseAuth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
import { ArrowLeftIcon, ArrowRightIcon, ArrowSquareOutIcon, ArrowsOutIcon, ArrowsInIcon, CaretUpIcon, CaretDownIcon, DeviceMobileIcon, MonitorIcon, EyeIcon, XIcon } from "@phosphor-icons/react";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citedElement?: { selector: string; artboardId: string } | null;
  citedReferences?: { id: string; title: string; imageUrl?: string }[] | null;
};

type Reference = {
  id: string;
  title: string;
  description: string;
  tag: string;
  url?: string;
  imageUrl?: string;
};

type Idea = {
  id: string;
  title: string;
  description: string;
  presentations?: Presentation[];
  presentationSlides?: PresentationSlide[];
  presentationHtml?: string;
};

type Device = "desktop" | "mobile";

type MissionOption = {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  content: string;
};

type Artboard = {
  id: string;
  html: string;
  label: string;
  x: number;
  y: number;
  device: Device;
  stitchScreenId?: string;
  ideaId: string;
};

type PresentationSlide = {
  title: string;
  content: string;
  imageUrl: string;
};

type Presentation = {
  id: string;
  title: string;
  createdAt: number;
  slides: PresentationSlide[];
  html?: string;
};

const DEVICE_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

type SelectedElement = {
  artboardId: string;
  selector: string;
  outerHTML: string;
};


type PresentationData = { title: string; slides: { title: string; content: string; imagePrompt: string }[] };

function parsePresentationBlock(text: string): { isJson: true; data: PresentationData } | { isJson: false; html: string } | null {
  const match = text.match(/```presentation\n([\s\S]*?)\n```/);
  if (!match) return null;
  const content = match[1].trim();
  if (content.startsWith("{")) {
    try {
      return { isJson: true, data: JSON.parse(content) as PresentationData };
    } catch {
      // fall through to HTML
    }
  }
  return { isJson: false, html: content };
}

function normalizePresentationStatusText(text: string): string {
  if (!/```presentation\s*\n/.test(text)) return text;
  return text
    .replace(/프레젠테이션을 생성했습니다\./g, "프레젠테이션 이미지를 생성하고 있습니다.")
    .replace(/프레젠테이션이 생성되었습니다\./g, "프레젠테이션 이미지를 생성하고 있습니다.")
    .replace(/피치덱을 생성했습니다\./g, "피치덱 이미지를 생성하고 있습니다.")
    .replace(/피치덱이 생성되었습니다\./g, "피치덱 이미지를 생성하고 있습니다.");
}

function normalizePresentations(idea: Idea): Presentation[] {
  if (idea.presentations?.length) return idea.presentations;
  if (idea.presentationSlides?.length) {
    return [{
      id: `legacy-slides-${idea.id}`,
      title: idea.presentationSlides[0]?.title || "Presentation",
      createdAt: 0,
      slides: idea.presentationSlides,
    }];
  }
  if (idea.presentationHtml) {
    return [{
      id: `legacy-html-${idea.id}`,
      title: "Presentation",
      createdAt: 0,
      slides: [],
      html: idea.presentationHtml,
    }];
  }
  return [];
}

function normalizeMissionOptions(mission: { title?: string; description?: string; options?: MissionOption[] } | null): MissionOption[] {
  const options = (mission?.options ?? [])
    .filter(option => option?.title?.trim())
    .map(option => ({
      id: option.id || crypto.randomUUID(),
      title: option.title ?? "",
      description: option.description ?? "",
      // backward compat: old data has imageUrl (string), new data has imageUrls (string[])
      imageUrls: option.imageUrls ?? ((option as unknown as {imageUrl?: string}).imageUrl ? [(option as unknown as {imageUrl: string}).imageUrl] : []),
      content: option.content ?? "",
    }));
  if (options.length > 0) return options;
  if (mission?.title || mission?.description) {
    return [{
      id: "legacy-option",
      title: mission.title || "미션 옵션",
      description: mission.description || "",
      imageUrls: [],
      content: mission.description || "",
    }];
  }
  return [];
}

function optionBrief(option: MissionOption | null) {
  if (!option) return "";
  return [
    option.description,
    option.imageUrls?.length ? `웹/앱에 들어가야 하는 이미지:\n${option.imageUrls.join("\n")}` : "",
    option.content ? `웹/앱에 들어가야 하는 콘텐츠:\n${option.content}` : "",
  ].filter(Boolean).join("\n\n");
}

function isInlineOrLocalAsset(url: string) {
  return !url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("#") || url.startsWith("about:");
}

async function fetchAssetDataUrl(url: string, baseUrl: string) {
  if (isInlineOrLocalAsset(url)) return url;
  try {
    const absoluteUrl = new URL(url, baseUrl).toString();
    const res = await fetch(`/api/image-data?url=${encodeURIComponent(absoluteUrl)}`);
    if (!res.ok) return url;
    const data = await res.json() as { dataUrl?: string };
    return data.dataUrl ?? url;
  } catch {
    return url;
  }
}

async function inlineCaptureAssets(doc: Document) {
  const baseUrl = doc.baseURI || window.location.href;

  await Promise.all(
    Array.from(doc.images).map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || isInlineOrLocalAsset(src)) return;
      const dataUrl = await fetchAssetDataUrl(src, baseUrl);
      img.setAttribute("src", dataUrl);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    })
  );

  await Promise.all(
    Array.from(doc.querySelectorAll("svg image")).map(async (image) => {
      const href = image.getAttribute("href") || image.getAttribute("xlink:href");
      if (!href || isInlineOrLocalAsset(href)) return;
      const dataUrl = await fetchAssetDataUrl(href, baseUrl);
      image.setAttribute("href", dataUrl);
      image.setAttribute("xlink:href", dataUrl);
    })
  );

  const cssUrlPattern = /url\((['"]?)(.*?)\1\)/g;
  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLElement>("*")).map(async (el) => {
      const computed = doc.defaultView?.getComputedStyle(el);
      if (!computed) return;

      for (const prop of ["backgroundImage", "maskImage", "webkitMaskImage"] as const) {
        const value = computed[prop];
        if (!value || value === "none" || !value.includes("url(")) continue;

        const replacements = await Promise.all(
          Array.from(value.matchAll(cssUrlPattern)).map(async (match) => {
            const originalUrl = match[2];
            const dataUrl = await fetchAssetDataUrl(originalUrl, baseUrl);
            return { raw: match[0], value: `url("${dataUrl}")` };
          })
        );

        const nextValue = replacements.reduce(
          (acc, item) => acc.replace(item.raw, item.value),
          value,
        );
        el.style[prop] = nextValue;
      }
    })
  );
}

function pseudoContentToText(content: string) {
  if (!content || content === "none" || content === "normal") return "";
  const unquoted = content.replace(/^['"]|['"]$/g, "");
  return unquoted.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function materializePseudoElements(doc: Document) {
  const pseudoProps = [
    "position",
    "display",
    "box-sizing",
    "width",
    "height",
    "margin",
    "padding",
    "color",
    "background",
    "border",
    "border-radius",
    "font",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "text-align",
    "vertical-align",
    "opacity",
    "transform",
    "inset",
    "top",
    "right",
    "bottom",
    "left",
  ];

  Array.from(doc.querySelectorAll<HTMLElement>("*")).forEach((el) => {
    for (const pseudo of ["::before", "::after"] as const) {
      const computed = doc.defaultView?.getComputedStyle(el, pseudo);
      if (!computed) continue;
      const text = pseudoContentToText(computed.content);
      if (!text) continue;

      const span = doc.createElement("span");
      span.textContent = text;
      span.setAttribute("aria-hidden", "true");
      span.setAttribute("data-vda-materialized-pseudo", pseudo);
      span.setAttribute(
        "style",
        pseudoProps
          .map((prop) => `${prop}:${computed.getPropertyValue(prop)};`)
          .join(""),
      );

      if (pseudo === "::before") el.prepend(span);
      else el.append(span);
    }
  });
}

function cloneWithComputedStyles(doc: Document) {
  const sourceNodes = [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))] as Element[];
  const clonedRoot = doc.documentElement.cloneNode(true) as HTMLElement;
  const clonedNodes = [clonedRoot, ...Array.from(clonedRoot.querySelectorAll("*"))] as HTMLElement[];

  sourceNodes.forEach((source, index) => {
    const target = clonedNodes[index];
    if (!target) return;
    const computed = doc.defaultView?.getComputedStyle(source);
    if (!computed) return;
    const style = Array.from(computed)
      .map((prop) => `${prop}:${computed.getPropertyValue(prop)}${computed.getPropertyPriority(prop) ? " !important" : ""};`)
      .join("");
    target.setAttribute("style", `${target.getAttribute("style") ?? ""};${style}`);
  });

  return clonedRoot;
}

async function captureMockupScreenshot(html: string, device: Device): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof window === "undefined") return null;

  const { width, height } = DEVICE_SIZE[device];
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.border = "0";
  iframe.style.pointerEvents = "none";

  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
      window.setTimeout(resolve, 1200);
    });

    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return null;

    await inlineCaptureAssets(doc);
    materializePseudoElements(doc);
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    const fullHeight = Math.min(
      Math.max(
        height,
        doc.body?.scrollHeight ?? 0,
        doc.body?.offsetHeight ?? 0,
        doc.documentElement.scrollHeight,
        doc.documentElement.offsetHeight,
      ),
      8000,
    );
    iframe.style.height = `${fullHeight}px`;
    doc.documentElement.style.overflow = "hidden";
    if (doc.body) doc.body.style.overflow = "hidden";
    await new Promise((resolve) => window.setTimeout(resolve, 100));

    const clonedRoot = cloneWithComputedStyles(doc);
    const serialized = new XMLSerializer().serializeToString(clonedRoot);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("mockup screenshot image load failed"));
        image.src = svgDataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = fullHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { dataUrl: svgDataUrl, width, height: fullHeight };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, fullHeight);
      ctx.drawImage(image, 0, 0, width, fullHeight);
      return { dataUrl: canvas.toDataURL("image/png"), width, height: fullHeight };
    } catch {
      return { dataUrl: svgDataUrl, width, height: fullHeight };
    }
  } finally {
    iframe.remove();
  }
}



function injectNoNavigation(html: string): string {
  const script = `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && (e.target.closest ? e.target.closest('a[href]') : null);
    if(a){ e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('submit', function(e){ e.preventDefault(); }, true);
})();
</script>`;
  const idx = html.lastIndexOf('</body>');
  return idx !== -1 ? html.slice(0, idx) + script + html.slice(idx) : html + script;
}

function injectHeightReporter(html: string, artboardId: string): string {
  const script = `<script>
(function(){
  var lastHeight = 0;
  function measure(){
    var body = document.body;
    var root = document.documentElement;
    var height = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    );
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.parent.postMessage({
      type: 'vda-artboard-height',
      artboardId: '${artboardId}',
      height: height
    }, '*');
  }
  if (document.documentElement) document.documentElement.style.overflow = 'hidden';
  if (document.body) document.body.style.overflow = 'hidden';
  window.addEventListener('load', measure);
  window.addEventListener('resize', measure);
  if (typeof ResizeObserver !== 'undefined') {
    var observer = new ResizeObserver(measure);
    if (document.body) observer.observe(document.body);
    if (document.documentElement) observer.observe(document.documentElement);
  }
  setTimeout(measure, 0);
  setTimeout(measure, 300);
  setTimeout(measure, 1000);
})();
</script>`;
  const idx = html.lastIndexOf('</body>');
  return idx !== -1 ? html.slice(0, idx) + script + html.slice(idx) : html + script;
}

type ContentChip = { label: string; done: boolean; code?: string };
type ContentPart = { type: "text"; content: string } | { type: "chip"; chip: ContentChip };

const BLOCK_RULES = [
  { complete: /\[GENERATE_MOCKUP:[^\]]+\]/, partial: /\[GENERATE_MOCKUP:[\s\S]*$/, doneLabel: "새 목업 생성 요청", pendingLabel: "목업 설명 작성 중..." },
  { complete: /\[EDIT_MOCKUP:[^\]]+\]/, partial: /\[EDIT_MOCKUP:[\s\S]*$/, doneLabel: "목업 수정 요청", pendingLabel: "수정 내용 작성 중..." },
  { complete: /```presentation\s*\n[\s\S]*?\n?\s*```/, partial: /```presentation[\s\S]*$/, doneLabel: "피치덱 프롬프트 준비됨", pendingLabel: "피치덱 프롬프트 작성 중..." },
  { complete: /\[FETCH_REFERENCES(?::[^\]]+)?\]/, partial: /\[FETCH_REFERENCES[\s\S]*$/, doneLabel: "레퍼런스 검색됨", pendingLabel: "레퍼런스 검색 중..." },
  { complete: /\[WEB_SEARCHED\]/, partial: /\[WEB_SEARCHED\]/, doneLabel: "웹 검색 완료", pendingLabel: "웹 검색 중..." },
];

function processMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    let earliest: { index: number; matchStr: string; label: string; done: boolean } | null = null;

    for (const rule of BLOCK_RULES) {
      for (const [regex, done, label] of [
        [rule.complete, true, rule.doneLabel],
        [rule.partial, false, rule.pendingLabel],
      ] as [RegExp, boolean, string][]) {
        const m = remaining.match(regex);
        if (m && m.index !== undefined && (earliest === null || m.index < earliest.index)) {
          earliest = { index: m.index, matchStr: m[0], label, done };
        }
      }
    }

    if (!earliest) {
      if (remaining.trim()) parts.push({ type: "text", content: remaining.trim() });
      break;
    }

    const before = remaining.slice(0, earliest.index).trim();
    if (before) parts.push({ type: "text", content: before });

    // Extract code content from the matched block
    const codeMatch = earliest.matchStr.match(/```(?:html|presentation)\s*\n([\s\S]*?)(?:\n?\s*```|$)/);
    const code = codeMatch ? codeMatch[1].trim() : earliest.matchStr;

    parts.push({ type: "chip", chip: { label: earliest.label, done: earliest.done, code } });
    remaining = remaining.slice(earliest.index + earliest.matchStr.length);
  }

  return parts;
}

function CodeChip({ chipKey, chip, expanded, onToggle }: {
  chipKey: string;
  chip: ContentChip;
  expanded: boolean;
  onToggle: (key: string) => void;
}) {
  const hasCode = !!chip.code;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-xs">
      <button
        onClick={() => hasCode && onToggle(chipKey)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${hasCode ? "cursor-pointer hover:bg-slate-100" : "cursor-default"}`}
      >
        {chip.done ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-slate-400" />
        )}
        <span className="flex-1 text-slate-600">{chip.label}</span>
        {hasCode && (expanded ? <CaretUpIcon size={12} className="text-slate-400" /> : <CaretDownIcon size={12} className="text-slate-400" />)}
      </button>
      {expanded && hasCode && (
        <pre className="max-h-64 overflow-y-auto border-t border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap break-all">
          {chip.code}
        </pre>
      )}
    </div>
  );
}

function injectSelectionScript(html: string, artboardId: string): string {
  const script = `
<style>
  [data-vda-selected] { outline: 2px solid #6366f1 !important; outline-offset: 2px; }
</style>
<script>
  document.addEventListener('wheel', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-wheel',
      artboardId: '${artboardId}',
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-gesture-start',
      artboardId: '${artboardId}'
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-gesture-change',
      artboardId: '${artboardId}',
      scale: e.scale,
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('[data-vda-selected]').forEach(function(el) {
      el.removeAttribute('data-vda-selected');
    });
    var el = e.target;
    el.setAttribute('data-vda-selected', 'true');

    var selector = el.tagName.toLowerCase();
    if (el.id) selector += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/)[0];
      if (cls) selector += '.' + cls;
    }

    window.parent.postMessage({
      type: 'vda-element-selected',
      artboardId: '${artboardId}',
      selector: selector,
      outerHTML: el.outerHTML,
    }, '*');
  }, true);
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", script + "\n</body>");
  }
  return html + script;
}

const ARTBOARD_GAP = 120;
const MIN_CANVAS_SCALE = 0.1;
const MAX_CANVAS_SCALE = 4;

type WebKitGestureEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

function buildMockupPrompt(basePrompt: string, idea?: Idea | null) {
  if (!idea?.description?.trim()) return basePrompt;
  return [
    basePrompt,
    "",
    "Use the following active idea as the authoritative product brief and visual style guide. Preserve concrete requirements, visual tokens, typography, layout, components, and do/don't constraints instead of summarizing them away.",
    `Idea title: ${idea.title}`,
    `Idea content:\n${idea.description.slice(0, 12000)}`,
  ].join("\n");
}

function isExplicitNewMockupRequest(text: string) {
  return /새(로운|로)?\s*(목업|디자인|버전|시안|화면|캔버스)|처음부터|다시\s*(만들|생성)|완전(히)?\s*(새|다른)|another\s+(mockup|version|design)|new\s+(mockup|version|design)|fresh\s+(mockup|canvas|design)/i.test(text);
}

function buildEditMockupPrompt(changePrompt: string) {
  return [
    "Edit the existing mockup in place. Preserve the current layout structure, visual style, typography, spacing, colors, content hierarchy, and all unrelated sections.",
    "Do not redesign the page from scratch. Do not create a new concept, new canvas, or unrelated alternative version.",
    `Requested change: ${changePrompt}`,
  ].join("\n");
}

function normalizeArtboardPositionsByIdea(boards: Artboard[]) {
  const counts = new Map<string, number>();
  return boards.map((board) => {
    const ideaId = board.ideaId ?? "";
    const index = counts.get(ideaId) ?? 0;
    counts.set(ideaId, index + 1);
    return {
      ...board,
      x: index * (DEVICE_SIZE[board.device ?? "desktop"].width + ARTBOARD_GAP),
      y: 0,
    };
  });
}


export default function MainScreenPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAs"); // admin: view another user's session

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isGeneratingPresentation, setIsGeneratingPresentation] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<Reference[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [missionTitle, setMissionTitle] = useState("");
  const [missionBrief, setMissionBrief] = useState("");
  const [missionPeriod, setMissionPeriod] = useState("");
  const [missionOptions, setMissionOptions] = useState<MissionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [missionDurationMinutes, setMissionDurationMinutes] = useState<number | null>(null);
  const [activeOptionPreviewId, setActiveOptionPreviewId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loadedImageUrls, setLoadedImageUrls] = useState<Set<string>>(new Set());
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerDisplay, setTimerDisplay] = useState<string>("");
  const [activeIdeaTab, setActiveIdeaTab] = useState("idea");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [isIdeaExpanded, setIsIdeaExpanded] = useState(false);
  const [isMissionBriefExpanded, setIsMissionBriefExpanded] = useState(false);
  const [activePresentationId, setActivePresentationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isFetchingRefs, setIsFetchingRefs] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  const [stitchProjectId, setStitchProjectId] = useState<string>("");
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false);
  const [generatingMockupIdeaId, setGeneratingMockupIdeaId] = useState<string | null>(null);
  const [ideaEditMode, setIdeaEditMode] = useState(false);
  const [isMockupExpanded, setIsMockupExpanded] = useState(false);

  const isReadOnly = !!(viewAs && isAdmin);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const ideaSectionRef = useRef<HTMLElement>(null);
  const mockupSectionRef = useRef<HTMLElement>(null);
  const presentationSectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasWorldRef = useRef<HTMLDivElement>(null);
  const canvasViewCommitTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);
  const canvasOffsetRef = useRef({ x: 40, y: 40 });
  const canvasScaleRef = useRef(0.5);
  const gestureStartScaleRef = useRef(0.5);
  const artboardHeightsRef = useRef<Record<string, number>>({});
  const artboardsRef = useRef<Artboard[]>([]);
  const activeIdeaIdRef = useRef<string | null>(null);
  const selectedOptionIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [artboardHeights, setArtboardHeights] = useState<Record<string, number>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [expandedChips, setExpandedChips] = useState<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => { canvasOffsetRef.current = canvasOffset; }, [canvasOffset]);
  useEffect(() => { canvasScaleRef.current = canvasScale; }, [canvasScale]);
  useEffect(() => { artboardHeightsRef.current = artboardHeights; }, [artboardHeights]);
  useEffect(() => { artboardsRef.current = artboards; }, [artboards]);
  useEffect(() => { activeIdeaIdRef.current = activeIdeaId; }, [activeIdeaId]);
  useEffect(() => { selectedOptionIdRef.current = selectedOptionId; }, [selectedOptionId]);

  const applyCanvasViewDirectly = useCallback((scale: number, offset: { x: number; y: number }) => {
    canvasScaleRef.current = scale;
    canvasOffsetRef.current = offset;
    if (canvasRef.current) {
      const gridSize = 20 * scale;
      canvasRef.current.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      canvasRef.current.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
    }
    if (canvasWorldRef.current) {
      canvasWorldRef.current.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
    }
  }, []);

  const commitCanvasViewSoon = useCallback((scale: number, offset: { x: number; y: number }) => {
    if (canvasViewCommitTimerRef.current !== null) {
      window.clearTimeout(canvasViewCommitTimerRef.current);
    }
    canvasViewCommitTimerRef.current = window.setTimeout(() => {
      canvasViewCommitTimerRef.current = null;
      setCanvasScale(scale);
      setCanvasOffset(offset);
    }, 120);
  }, []);

  useEffect(() => () => {
    if (canvasViewCommitTimerRef.current !== null) {
      window.clearTimeout(canvasViewCommitTimerRef.current);
    }
  }, []);

  // Auth state
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      setUserId(user?.uid ?? null);
      setIsAdmin(ADMIN_EMAILS.includes(user?.email ?? ""));
    });
  }, []);

  // Load session from Firestore + fallback to global mission data
  useEffect(() => {
    if (!userId || !missionId) return;

    const targetUserId = (viewAs && isAdmin) ? viewAs : userId;
    const sessionRef = doc(db, "sessions", targetUserId, "missions", missionId);
    const missionRef = doc(db, "missions", missionId);

    // Register current user as participant (skip if viewing as someone else)
    if (!viewAs) {
      const user = firebaseAuth.currentUser;
      setDoc(doc(db, "missions", missionId, "participants", userId), {
        displayName: user?.displayName ?? null,
        email: user?.email ?? null,
        photoURL: user?.photoURL ?? null,
        updatedAt: Date.now(),
      }, { merge: true });
    }

    // If viewAs, fetch participant display name
    if (viewAs && isAdmin) {
      getDoc(doc(db, "missions", missionId, "participants", viewAs)).then(snap => {
        if (snap.exists()) setViewAsName(snap.data().displayName ?? snap.data().email ?? viewAs);
        else setViewAsName(viewAs);
      }).catch(() => setViewAsName(viewAs));
    }

    // Session: load once; Mission: real-time listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionData: Record<string, any> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyMission = (missionData: Record<string, any> | null) => {
      const session = sessionData;
      const normalizedOptions = normalizeMissionOptions(missionData as { title?: string; description?: string; options?: MissionOption[] } | null);
      // Use ref so re-selection by user is never overwritten
      const currentOptionId = selectedOptionIdRef.current ?? (session?.selectedOptionId as string | undefined);
      const selectedOption = normalizedOptions.find(o => o.id === currentOptionId) ?? (normalizedOptions.length === 1 ? normalizedOptions[0] : null);
      setMissionOptions(normalizedOptions);
      // Only update title/brief from mission if they can be freshly derived
      if (selectedOption) {
        setMissionTitle(selectedOption.title || missionData?.title || "");
        setMissionBrief(optionBrief(selectedOption) || missionData?.description || "");
      } else {
        setMissionTitle(session?.missionTitle || missionData?.title || "");
        setMissionBrief(session?.missionBrief || missionData?.description || "");
      }
      if (missionData?.startDate && missionData?.endDate) setMissionPeriod(`${missionData.startDate} – ${missionData.endDate}`);
      if (missionData?.device) setDevice(missionData.device as Device);
      if (missionData?.durationMinutes) setMissionDurationMinutes(Number(missionData.durationMinutes));
    };

    getDoc(sessionRef).then(sessionSnap => {
      const session = sessionSnap.exists() ? sessionSnap.data() : null;
      sessionData = session ?? null;

      if (session?.messages) setMessages(session.messages);
      // Load ideas first so we can reference their IDs
      const loadedIdeas: Idea[] = session?.ideas ?? [];
      const firstIdeaId = loadedIdeas[0]?.id ?? "";

      if (session?.artboards && session.artboards.length > 0) {
        // Backward compat: old artboards without ideaId → assign to first idea
        const loaded: Artboard[] = session.artboards.map((a: Artboard) => ({
          ...a,
          ideaId: a.ideaId ?? firstIdeaId,
        }));
        const normalizedLoaded = normalizeArtboardPositionsByIdea(loaded);
        setArtboards(normalizedLoaded);
        const firstIdeaBoards = normalizedLoaded.filter(a => a.ideaId === firstIdeaId);
        setActiveArtboardId((firstIdeaBoards.at(-1) ?? normalizedLoaded[normalizedLoaded.length - 1])?.id ?? null);
        setActiveIdeaTab("mockup");
        const pid = session.stitchProjectId;
        if (pid) {
          normalizedLoaded.forEach((a: Artboard) => {
            if (!a.stitchScreenId || a.html) return;
            fetch(`/api/stitch/html?projectId=${pid}&screenId=${a.stitchScreenId}`)
              .then(r => r.json())
              .then(d => {
                if (d.html) setArtboards(prev => prev.map(p => p.id === a.id ? { ...p, html: d.html } : p));
              })
              .catch(() => {});
          });
        }
      } else if (session?.mockupHtml) {
        const board: Artboard = { id: crypto.randomUUID(), html: session.mockupHtml, label: "Design 1", x: 0, y: 0, device: "desktop", ideaId: firstIdeaId };
        setArtboards([board]);
        setActiveArtboardId(board.id);
        setActiveIdeaTab("mockup");
      }

      // Backward compat: global presentation → assign to first idea
      const ideasWithPresentation: Idea[] = loadedIdeas.map((idea: Idea, idx: number) => {
        const ideaWithLegacy = idx === 0
          ? {
              ...idea,
              presentationSlides: idea.presentationSlides ?? (session?.presentationSlides?.length ? session.presentationSlides : undefined),
              presentationHtml: idea.presentationHtml ?? session?.presentationHtml ?? undefined,
            }
          : idea;
        const presentations = normalizePresentations(ideaWithLegacy);
        if (idx === 0) {
          return {
            ...ideaWithLegacy,
            presentations,
          };
        }
        return {
          ...ideaWithLegacy,
          presentations,
        };
      });

      if (ideasWithPresentation.length > 0) {
        setIdeas(ideasWithPresentation);
        setActiveIdeaId(ideasWithPresentation[0].id);
      }
      if (session?.references) setReferences(session.references);
      if (session?.stitchProjectId) setStitchProjectId(session.stitchProjectId);

      if (session?.timerStartedAt) setTimerStartedAt(Number(session.timerStartedAt));
      // Set selectedOptionId from session — only once at load
      if (session?.selectedOptionId) {
        setSelectedOptionId(session.selectedOptionId as string);
        selectedOptionIdRef.current = session.selectedOptionId as string;
      }
    });

    // Real-time mission listener — picks up admin edits immediately
    const unsubMission = onSnapshot(missionRef, (snap) => {
      applyMission(snap.exists() ? snap.data() : null);
    });

    return () => unsubMission();
  }, [userId, missionId, viewAs, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save session to Firestore (debounced to avoid write storms during streaming)
  useEffect(() => {
    if (isReadOnly) return;
    if (!userId || !missionId || (messages.length === 0 && artboards.length === 0 && references.length === 0 && ideas.length === 0 && !missionTitle && !missionBrief)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ref = doc(db, "sessions", userId, "missions", missionId);
      const artboardsToSave = artboards.map(a => a.stitchScreenId ? { ...a, html: "" } : a);
      // Per-idea presentation: only save Storage URLs (not base64)
      const ideasToSave = ideas.map(idea => ({
        ...idea,
        presentations: normalizePresentations(idea).map(p => ({
          ...p,
          slides: (p.slides ?? []).filter(s => s.imageUrl.startsWith("https://")),
          html: p.html ?? null,
        })),
        presentationSlides: (idea.presentationSlides ?? []).filter(s => s.imageUrl.startsWith("https://")),
        presentationHtml: idea.presentationHtml ?? null,
      }));
      // Strip undefined values — Firestore rejects them
      const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_, val) => val === undefined ? null : val));
      setDoc(ref, clean({ messages, artboards: artboardsToSave, references, ideas: ideasToSave, missionTitle, missionBrief, selectedOptionId, stitchProjectId: stitchProjectId || null, updatedAt: Date.now() }), { merge: true });
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [userId, missionId, messages, artboards, references, ideas, missionTitle, missionBrief, selectedOptionId, stitchProjectId]);

  // Countdown / count-up timer
  useEffect(() => {
    if (!timerStartedAt) { setTimerDisplay(""); return; }
    const update = () => {
      const elapsed = Date.now() - timerStartedAt;
      if (missionDurationMinutes && missionDurationMinutes > 0) {
        const remaining = missionDurationMinutes * 60 * 1000 - elapsed;
        if (remaining <= 0) { setTimerDisplay("시간 종료"); return; }
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        setTimerDisplay(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      } else {
        const m = Math.floor(elapsed / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        setTimerDisplay(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timerStartedAt, missionDurationMinutes]);

  // Preload all option images when options are available
  useEffect(() => {
    const allUrls = missionOptions.flatMap(o => o.imageUrls ?? []);
    allUrls.forEach(url => {
      if (!url) return;
      const img = new window.Image();
      img.onload = () => setLoadedImageUrls(prev => new Set(prev).add(url));
      img.src = url;
    });
  }, [missionOptions]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for element selection from iframe
  const editModeRef = useRef(false);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "vda-element-selected" && editModeRef.current) {
        setSelectedElement({
          artboardId: e.data.artboardId,
          selector: e.data.selector,
          outerHTML: e.data.outerHTML,
        });
        setActiveArtboardId(e.data.artboardId);
      }
      if (e.data?.type === "vda-artboard-height") {
        const artboardId = String(e.data.artboardId ?? "");
        const height = Number(e.data.height);
        if (!artboardId || !Number.isFinite(height)) return;
        setArtboardHeights(prev => {
          const nextHeight = Math.max(Math.ceil(height), 1);
          if (Math.abs((prev[artboardId] ?? 0) - nextHeight) < 2) return prev;
          return { ...prev, [artboardId]: nextHeight };
        });
      }
      if (e.data?.type === "vda-canvas-gesture-start") {
        gestureStartScaleRef.current = canvasScaleRef.current;
      }
      if (e.data?.type === "vda-canvas-wheel" || e.data?.type === "vda-canvas-gesture-change") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const artboard = artboardsRef.current.find(a => a.id === e.data.artboardId);
        if (!artboard) return;

        const rect = canvas.getBoundingClientRect();
        const scale = canvasScaleRef.current;
        const clientX = rect.left + canvasOffsetRef.current.x + (artboard.x + (e.data.clientX ?? 0)) * scale;
        const clientY = rect.top + canvasOffsetRef.current.y + (artboard.y + (e.data.clientY ?? 0)) * scale;
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const prevScale = canvasScaleRef.current;
        const nextScale = e.data.type === "vda-canvas-gesture-change"
          ? gestureStartScaleRef.current * (e.data.scale ?? 1)
          : prevScale * Math.exp(-(e.data.deltaY ?? 0) * (e.data.ctrlKey ? 0.006 : 0.0025));
        const clampedScale = Math.min(Math.max(nextScale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
        if (Math.abs(clampedScale - prevScale) < 0.001) return;

        const prevOffset = canvasOffsetRef.current;
        const nextOffset = {
          x: mouseX - (mouseX - prevOffset.x) * (clampedScale / prevScale),
          y: mouseY - (mouseY - prevOffset.y) * (clampedScale / prevScale),
        };
        applyCanvasViewDirectly(clampedScale, nextOffset);
        commitCanvasViewSoon(clampedScale, nextOffset);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [applyCanvasViewDirectly, commitCanvasViewSoon]);

  // Trackpad and mouse zoom toward cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame: number | null = null;
    let pendingScale = canvasScaleRef.current;
    let pendingOffset = canvasOffsetRef.current;

    const clampScale = (scale: number) => Math.min(Math.max(scale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
    const scheduleCanvasView = (scale: number, offset: { x: number; y: number }) => {
      pendingScale = scale;
      pendingOffset = offset;
      if (animationFrame !== null) return;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        applyCanvasViewDirectly(pendingScale, pendingOffset);
        commitCanvasViewSoon(pendingScale, pendingOffset);
      });
    };

    const zoomAtPoint = (clientX: number, clientY: number, nextScale: number) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const prevScale = canvasScaleRef.current;
      const clampedScale = clampScale(nextScale);
      if (Math.abs(clampedScale - prevScale) < 0.001) return;

      const prevOffset = canvasOffsetRef.current;
      scheduleCanvasView(clampedScale, {
        x: mouseX - (mouseX - prevOffset.x) * (clampedScale / prevScale),
        y: mouseY - (mouseY - prevOffset.y) * (clampedScale / prevScale),
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1;
      const normalizedDelta = e.deltaY * unit;
      const sensitivity = e.ctrlKey ? 0.006 : 0.0025;
      const factor = Math.exp(-normalizedDelta * sensitivity);
      zoomAtPoint(e.clientX, e.clientY, canvasScaleRef.current * factor);
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartScaleRef.current = canvasScaleRef.current;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as WebKitGestureEvent;
      const rect = canvas.getBoundingClientRect();
      const clientX = gesture.clientX ?? rect.left + rect.width / 2;
      const clientY = gesture.clientY ?? rect.top + rect.height / 2;
      zoomAtPoint(clientX, clientY, gestureStartScaleRef.current * (gesture.scale ?? 1));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
    canvas.addEventListener("gesturechange", onGestureChange, { passive: false });
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
  }, [artboards.length, activeIdeaId, isMockupExpanded, applyCanvasViewDirectly, commitCanvasViewSoon]);

  // Fit all artboards into canvas view
  const fitToCanvasForIdea = useCallback((ideaId: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boards = artboardsRef.current.filter(a => a.ideaId === ideaId);
    if (boards.length === 0) return;
    const { clientWidth, clientHeight } = canvas;
    const minX = Math.min(...boards.map(a => a.x));
    const minY = Math.min(...boards.map(a => a.y));
    const maxX = Math.max(...boards.map(a => a.x + DEVICE_SIZE[a.device ?? "desktop"].width));
    const maxY = Math.max(...boards.map(a => a.y + (artboardHeightsRef.current[a.id] ?? DEVICE_SIZE[a.device ?? "desktop"].height)));
    const totalW = maxX - minX;
    const totalH = maxY - minY;
    const scale = Math.min((clientWidth - 80) / totalW, (clientHeight - 80) / totalH, 1);
    setCanvasScale(scale);
    setCanvasOffset({
      x: (clientWidth - totalW * scale) / 2 - minX * scale,
      y: (clientHeight - totalH * scale) / 2 - minY * scale,
    });
  }, []);

  const fitToCanvas = useCallback(() => {
    fitToCanvasForIdea(activeIdeaIdRef.current);
  }, [fitToCanvasForIdea]);

  // Auto-fit when first artboard is added
  useEffect(() => {
    if (artboards.length === 1) setTimeout(fitToCanvas, 0);
  }, [artboards.length, fitToCanvas]);


  const addIdea = () => {
    const newIdea: Idea = { id: crypto.randomUUID(), title: "새 아이디어", description: "" };
    setIdeas(prev => [...prev, newIdea]);
    setActiveIdeaId(newIdea.id);
    setActiveArtboardId(null);
    setCurrentSlideIndex(0);
    setActivePresentationId(null);
    setIsIdeaExpanded(false);
    setActiveIdeaTab("idea");
    setIdeaEditMode(true);
  };

  const switchIdea = (ideaId: string) => {
    setActiveIdeaId(ideaId);
    setCurrentSlideIndex(0);
    setActivePresentationId(null);
    setIsIdeaExpanded(false);
    setActiveIdeaTab("idea");
    setIdeaEditMode(false);
    const ideaBoards = artboardsRef.current.filter(a => a.ideaId === ideaId);
    setActiveArtboardId(ideaBoards.at(-1)?.id ?? null);
    setTimeout(() => fitToCanvasForIdea(ideaId), 0);
  };

  const updateIdea = (id: string, changes: Partial<Omit<Idea, "id">>) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, ...changes } : i));
  };

  const deleteIdea = (id: string) => {
    setIdeas(prev => {
      const next = prev.filter(i => i.id !== id);
      if (activeIdeaId === id) setActiveIdeaId(next[next.length - 1]?.id ?? null);
      return next;
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offsetX: canvasOffset.x, offsetY: canvasOffset.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    setCanvasOffset({
      x: dragStartRef.current.offsetX + (e.clientX - dragStartRef.current.mouseX),
      y: dragStartRef.current.offsetY + (e.clientY - dragStartRef.current.mouseY),
    });
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 96)}px`;
  };

  const cancelMessage = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading || isGeneratingMockup) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      citedElement: selectedElement ? { selector: selectedElement.selector, artboardId: selectedElement.artboardId } : null,
      citedReferences: selectedReferences.length > 0 ? selectedReferences.map(r => ({ id: r.id, title: r.title, imageUrl: r.imageUrl })) : null,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSelectedReferences([]);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), 90_000);

    const currentIdeaBoards = artboards.filter(a => a.ideaId === activeIdeaId);
    const activeBoard = currentIdeaBoards.find(a => a.id === activeArtboardId) ?? currentIdeaBoards.at(-1) ?? null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
          mockupHtml: activeBoard?.html || undefined,
          selectedElement: selectedElement || undefined,
          citedReferences: selectedReferences.length > 0 ? selectedReferences : undefined,
          missionTitle: missionTitle || undefined,
          missionBrief: missionBrief || undefined,
          missionImageUrls: selectedMissionOption?.imageUrls?.length ? selectedMissionOption.imageUrls : undefined,
          device,
          activeIdea: ideas.find(i => i.id === activeIdeaId) ?? undefined,
        }),
      });

      if (!res.ok || !res.body) throw new Error("API error");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m))
        );
      }

      fullText = normalizePresentationStatusText(fullText);

      // Convert web search citation domains (domain.com) to clickable markdown links
      fullText = fullText.replace(
        /\(([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*)+(?:\/[^\s)]*)?)\)/g,
        (match, domain) => /\.[a-zA-Z]{2,}/.test(domain) ? `([${domain}](https://${domain}))` : match
      );
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));

      // Parse special blocks from completed response
      const fetchRefMatch = fullText.match(/\[FETCH_REFERENCES(?::\s*(.*?))?\]/);
      if (fetchRefMatch) {
        const customQuery = fetchRefMatch[1]?.trim() || null;
        fetchReferences(missionTitle, missionBrief, customQuery);
      }


      const generateMatch = fullText.match(/\[GENERATE_MOCKUP:\s*([\s\S]*?)\]/);
      const editMatch = !generateMatch ? fullText.match(/\[EDIT_MOCKUP:\s*([\s\S]*?)\]/) : null;

      if (generateMatch || editMatch) {
        const prompt = (generateMatch ?? editMatch)![1].trim();
        const hasExistingMockup = !!activeBoard?.stitchScreenId || currentIdeaBoards.length > 0;
        const forceEditExisting = !!generateMatch && hasExistingMockup && !isExplicitNewMockupRequest(text);
        const isNew = !!generateMatch && !forceEditExisting;
        const activeIdea = ideas.find(i => i.id === activeIdeaId) ?? null;
        const mockupIdeaId = activeIdeaId;
        const stitchPrompt = isNew ? buildMockupPrompt(prompt, activeIdea) : buildEditMockupPrompt(prompt);

        if (isNew && ideas.length === 0) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n⚠️ 아이디어를 먼저 저장해야 목업을 생성할 수 있습니다. 아이디어를 정리한 후 다시 시도해 주세요." }
              : m
          ));
          return;
        }

        const targetArtboard = !isNew
          ? (currentIdeaBoards.find(a => a.id === activeArtboardId) ?? currentIdeaBoards.at(-1) ?? null)
          : null;

        if (!isNew && !targetArtboard?.stitchScreenId) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n⚠️ 기존 목업의 Stitch 화면 ID가 없어 수정할 수 없습니다. 새 목업으로 다시 생성해 주세요." }
              : m
          ));
          return;
        }

        setIsGeneratingMockup(true);
        setGeneratingMockupIdeaId(mockupIdeaId);
        try {
          const stitchController = new AbortController();
          const stitchTimeout = setTimeout(() => stitchController.abort(), 115_000);
          let res: Response;
          try {
            res = await fetch("/api/stitch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: stitchController.signal,
              body: JSON.stringify({
                prompt: stitchPrompt,
                device,
                projectId: stitchProjectId || undefined,
                screenId: targetArtboard?.stitchScreenId || undefined,
              }),
            });
          } finally {
            clearTimeout(stitchTimeout);
          }
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(errText);
          }
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          if (data.projectId) setStitchProjectId(data.projectId);

          if (isNew) {
            const primaryId = crypto.randomUUID();
            // Collect extra screens Stitch created (excluding the primary one)
            const extraScreenIds: string[] = (data.allScreenIds ?? []).filter(
              (sid: string) => sid !== data.screenId
            );

            setArtboards(prev => {
              const existingScreenIds = new Set(prev.map(a => a.stitchScreenId).filter(Boolean));
              const newExtra = extraScreenIds.filter((sid: string) => !existingScreenIds.has(sid));
              const ideaId = activeIdeaId ?? "";
              const ideaBoards = prev.filter(a => a.ideaId === ideaId);
              const last = ideaBoards[ideaBoards.length - 1];
              let offsetX = last ? last.x + DEVICE_SIZE[last.device ?? "desktop"].width + ARTBOARD_GAP : 0;
              const primaryBoard: Artboard = {
                id: primaryId,
                html: data.html,
                label: `Design ${ideaBoards.length + 1}`,
                x: offsetX,
                y: 0,
                device,
                stitchScreenId: data.screenId,
                ideaId,
              };
              offsetX += DEVICE_SIZE[device].width + ARTBOARD_GAP;

              const extraBoards: Artboard[] = newExtra.map((sid: string, i: number) => ({
                id: crypto.randomUUID(),
                html: "",
                label: `Design ${ideaBoards.length + 2 + i}`,
                x: offsetX + i * (DEVICE_SIZE[device].width + ARTBOARD_GAP),
                y: 0,
                device,
                stitchScreenId: sid,
                ideaId,
              }));

              return [...prev, primaryBoard, ...extraBoards];
            });
            setActiveArtboardId(primaryId);
            setTimeout(() => fitToCanvasForIdea(activeIdeaId ?? ""), 0);

            // Lazy-load HTML for extra screens
            extraScreenIds.forEach((sid: string) => {
              fetch(`/api/stitch/html?projectId=${data.projectId}&screenId=${sid}`)
                .then(r => r.json())
                .then(d => {
                  if (d.html) setArtboards(prev => prev.map(a =>
                    a.stitchScreenId === sid ? { ...a, html: d.html } : a
                  ));
                })
                .catch(() => {});
            });
          } else {
            const targetId = activeArtboardId ?? currentIdeaBoards.at(-1)?.id;
            setArtboards(prev => prev.map(a =>
              a.id === targetId ? { ...a, html: data.html, stitchScreenId: data.screenId } : a
            ));
          }
          setActiveIdeaTab("mockup");
          setSelectedElement(null);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Stitch 생성 실패";
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + `\n\n⚠️ 목업 생성 실패: ${errMsg}` } : m
          ));
        } finally {
          setIsGeneratingMockup(false);
          setGeneratingMockupIdeaId(null);
        }
      }

      const presentationBlock = parsePresentationBlock(fullText);
      console.log("[presentation] block:", presentationBlock ? (presentationBlock.isJson ? "json" : "html") : "none");
      if (presentationBlock) {
        if (currentIdeaBoards.length === 0) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n⚠️ 목업이 먼저 만들어져야 피치덱을 생성할 수 있습니다." }
              : m
          ));
        } else if (presentationBlock.isJson) {
          console.log("[presentation] slides:", presentationBlock.data.slides?.length);
          setIsGeneratingPresentation(true);
          try {
            const uid = firebaseAuth.currentUser?.uid ?? "anonymous";
            const presentationMockupHtml = activeBoard?.html || currentIdeaBoards.at(-1)?.html || "";
            const presentationMockupDevice = activeBoard?.device || currentIdeaBoards.at(-1)?.device || device;
            const mockupScreenshot = presentationMockupHtml
              ? await captureMockupScreenshot(presentationMockupHtml, presentationMockupDevice)
              : null;
            const presRes = await fetch("/api/presentation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: presentationBlock.data.title,
                slides: presentationBlock.data.slides,
                uid,
                missionId,
                device: presentationMockupDevice,
                mockupHtml: presentationMockupHtml || undefined,
                mockupScreenshot: mockupScreenshot?.dataUrl || undefined,
                mockupScreenshotWidth: mockupScreenshot?.width,
                mockupScreenshotHeight: mockupScreenshot?.height,
              }),
            });
            const presData = await presRes.json();
            console.log("[presentation] api response:", presData.error ?? `${presData.slides?.length} slides`);
            if (presData.error) throw new Error(presData.error);
            if (presData.slides) {
              const uploadedSlides: PresentationSlide[] = await Promise.all(
                (presData.slides as PresentationSlide[]).map(async (slide, i) => {
                  if (!slide.imageUrl.startsWith("data:")) return slide;
                  try {
                    const imgRef = storageRef(storage, `presentations/${uid}/${missionId}/slide-${i}.png`);
                    await uploadString(imgRef, slide.imageUrl, "data_url");
                    const url = await getDownloadURL(imgRef);
                    console.log(`[presentation] slide ${i} uploaded`);
                    return { ...slide, imageUrl: url };
                  } catch {
                    console.info(`[presentation] slide ${i} storage upload skipped; showing generated base64 image for this session.`);
                    return slide;
                  }
                })
              );
              if (activeIdeaId) {
                const newPresentation: Presentation = {
                  id: crypto.randomUUID(),
                  title: presentationBlock.data.title || uploadedSlides[0]?.title || "Presentation",
                  createdAt: Date.now(),
                  slides: uploadedSlides,
                };
                const nextIdeas = ideas.map(idea =>
                  idea.id === activeIdeaId
                    ? {
                        ...idea,
                        presentations: [...normalizePresentations(idea), newPresentation],
                        presentationSlides: uploadedSlides,
                      }
                    : idea
                );
                setIdeas(nextIdeas);

                const persistentSlides = uploadedSlides.filter(s => s.imageUrl.startsWith("https://"));
                if (persistentSlides.length !== uploadedSlides.length) {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + "\n\n⚠️ 프레젠테이션 이미지를 임시로 표시했지만 Firebase Storage 저장에 실패했습니다. 새로고침하면 사라질 수 있습니다." }
                      : m
                  ));
                } else if (!isReadOnly && userId) {
                  const ref = doc(db, "sessions", userId, "missions", missionId);
                  const artboardsToSave = artboards.map(a => a.stitchScreenId ? { ...a, html: "" } : a);
                  const ideasToSave = nextIdeas.map(idea => ({
                    ...idea,
                    presentations: normalizePresentations(idea).map(p => ({
                      ...p,
                      slides: (p.slides ?? []).filter(s => s.imageUrl.startsWith("https://")),
                      html: p.html ?? null,
                    })),
                    presentationSlides: (idea.presentationSlides ?? []).filter(s => s.imageUrl.startsWith("https://")),
                    presentationHtml: idea.presentationHtml ?? null,
                  }));
                  const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_, val) => val === undefined ? null : val));
                  await setDoc(ref, clean({ messages, artboards: artboardsToSave, references, ideas: ideasToSave, missionTitle, missionBrief, stitchProjectId: stitchProjectId || null, updatedAt: Date.now() }), { merge: true });
                }
                setActivePresentationId(newPresentation.id);
              }
              setCurrentSlideIndex(0);
              setActiveIdeaTab("presentation");
            }
          } catch (presErr) {
            const msg = presErr instanceof Error ? presErr.message : String(presErr);
            console.error("[presentation] error:", msg);
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + `\n\n⚠️ 피치덱 이미지 생성 실패: ${msg}` }
                : m
            ));
          } finally {
            setIsGeneratingPresentation(false);
          }
        } else {
          if (activeIdeaId) {
            const newPresentation: Presentation = {
              id: crypto.randomUUID(),
              title: "Presentation",
              createdAt: Date.now(),
              slides: [],
              html: presentationBlock.html,
            };
            const activeIdea = ideas.find(idea => idea.id === activeIdeaId);
            updateIdea(activeIdeaId, {
              presentations: activeIdea ? [...normalizePresentations(activeIdea), newPresentation] : [newPresentation],
              presentationHtml: presentationBlock.html,
            });
            setActivePresentationId(newPresentation.id);
          }
          setActiveIdeaTab("presentation");
        }
      }
    } catch (err) {
      const isTimeout = (err as Error)?.message === "timeout" || (err instanceof DOMException && err.name === "AbortError");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: isTimeout ? "응답 시간이 초과되었습니다. 다시 시도해주세요." : "오류가 발생했습니다. 다시 시도해주세요." }
            : m
        )
      );
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [inputText, isLoading, isGeneratingMockup, messages, artboards, activeArtboardId, activeIdeaId, selectedElement, selectedReferences, ideas, references, device, stitchProjectId, missionTitle, missionBrief, userId, isReadOnly, missionId, fitToCanvasForIdea]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearSelectedElement = () => setSelectedElement(null);

  const fetchReferences = useCallback(async (title: string, brief: string, customQuery?: string | null) => {
    if (isFetchingRefs || isReadOnly) return;
    setIsFetchingRefs(true);
    try {
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionTitle: title, missionBrief: brief, customQuery }),
      });
      const data = await res.json();
      if (data.references?.length > 0) {
        setReferences(prev => {
          const existingIds = new Set(prev.map(r => r.id));
          const newRefs = data.references.filter((r: Reference) => !existingIds.has(r.id));
          return [...prev, ...newRefs];
        });
      }
    } finally {
      setIsFetchingRefs(false);
    }
  }, [isFetchingRefs, isReadOnly]);



  const ideaArtboards = artboards.filter(a => a.ideaId === activeIdeaId);
  const activeArtboard = ideaArtboards.find(a => a.id === activeArtboardId) ?? ideaArtboards[ideaArtboards.length - 1] ?? null;
  const selectedMissionOption = missionOptions.find(option => option.id === selectedOptionId) ?? null;
  const chooseMissionOption = async (option: MissionOption) => {
    const now = Date.now();
    setSelectedOptionId(option.id);
    setMissionTitle(option.title);
    setMissionBrief(optionBrief(option));
    setTimerStartedAt(now);
    if (!isReadOnly && userId) {
      const ref = doc(db, "sessions", userId, "missions", missionId);
      await setDoc(ref, {
        selectedOptionId: option.id,
        missionTitle: option.title,
        missionBrief: optionBrief(option),
        timerStartedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
  };
  const isGeneratingCurrentIdeaMockup = isGeneratingMockup && generatingMockupIdeaId === activeIdeaId;
  const gridSize = 20 * canvasScale;
  const getArtboardRenderHeight = (artboard: Artboard) => Math.max(
    DEVICE_SIZE[artboard.device ?? "desktop"].height,
    artboardHeights[artboard.id] ?? 0,
  );
  const renderMockupCanvas = (expanded = false) => (
    <div
      ref={canvasRef}
      className={`relative w-full overflow-hidden select-none ${expanded ? "flex-1" : "h-150 rounded-2xl"}`}
      style={{
        backgroundColor: "#1a1a1a",
        backgroundImage: "radial-gradient(circle, #383838 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
    >
      {isGeneratingCurrentIdeaMockup && (
        <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 ${expanded ? "" : "rounded-2xl"}`}>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <p className="text-sm text-white/80">Stitch로 목업 생성 중...</p>
        </div>
      )}
      <div
        ref={canvasWorldRef}
        className="absolute inset-0"
        style={{
          transform: `translate3d(${canvasOffset.x}px, ${canvasOffset.y}px, 0) scale(${canvasScale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          pointerEvents: isDragging ? "none" : "auto",
        }}
      >
        {ideaArtboards.map(artboard => {
          const isActive = artboard.id === activeArtboardId;
          const artboardHeight = getArtboardRenderHeight(artboard);
          const artboardHtml = injectHeightReporter(injectNoNavigation(editMode ? injectSelectionScript(artboard.html, artboard.id) : artboard.html), artboard.id);
          return (
            <div key={artboard.id}>
              <div style={{ position: "absolute", left: artboard.x, top: artboard.y - 22, color: isActive ? "#a5b4fc" : "#888", fontSize: 11, fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", userSelect: "none" }}>{artboard.label}</div>
              <div style={{ position: "absolute", left: artboard.x, top: artboard.y, width: DEVICE_SIZE[artboard.device ?? "desktop"].width, height: artboardHeight, borderRadius: artboard.device === "mobile" ? 24 : 12, overflow: "hidden", outline: isActive ? "2px solid #6366f1" : "2px solid transparent", outlineOffset: 3, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }} onClick={() => setActiveArtboardId(artboard.id)}>
                <iframe
                  srcDoc={artboardHtml}
                  sandbox="allow-scripts"
                  scrolling="no"
                  style={{
                    width: DEVICE_SIZE[artboard.device ?? "desktop"].width,
                    height: artboardHeight,
                    border: "none",
                    display: "block",
                    overflow: "hidden",
                    pointerEvents: editMode ? "auto" : "none",
                  }}
                  title={artboard.label}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          <span className="flex items-center gap-1"><EyeIcon size={14} /> 읽기 전용 —<strong>{viewAsName ?? viewAs}</strong>의 세션을 보고 있습니다</span>
          <Link href={`/admin`} className="font-semibold underline underline-offset-2">어드민으로 돌아가기</Link>
        </div>
      )}
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="space-y-1">
          {missionPeriod && <p className="text-sm text-slate-500">{missionPeriod}</p>}
          <h1 className="text-xl font-semibold">{missionTitle || "미션 제목 없음"}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {timerDisplay && (
            <span className={`font-mono text-lg font-semibold tabular-nums ${timerDisplay === "시간 종료" ? "text-red-500" : missionDurationMinutes && timerStartedAt && (missionDurationMinutes * 60 * 1000 - (Date.now() - timerStartedAt)) < 60000 ? "text-red-500" : "text-slate-900"}`}>
              {missionDurationMinutes ? `⏱ ${timerDisplay}` : `${timerDisplay} 경과`}
            </span>
          )}
          <Link
            href="/lobby"
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            로비로 돌아가기
          </Link>
        </div>
      </header>

      {missionOptions.length > 1 && !selectedOptionId ? (
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-8 py-8 space-y-6">

              {/* Mission info */}
              {(missionTitle || missionBrief) && (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">미션</p>
                    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                      {device === "mobile" ? <><DeviceMobileIcon size={11} className="inline" /> 모바일</> : <><MonitorIcon size={11} className="inline" /> PC</>}
                    </span>
                    {missionPeriod && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{missionPeriod}</span>}
                  </div>
                  {missionTitle && <h2 className="mt-2 text-lg font-semibold text-slate-900">{missionTitle}</h2>}
                  {missionBrief && <p className="mt-1.5 text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">{missionBrief}</p>}
                </div>
              )}

              {/* Option tabs */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {missionOptions.map((o, i) => {
                  const isActive = activeOptionPreviewId === o.id || (!activeOptionPreviewId && i === 0);
                  return (
                    <button
                      key={o.id}
                      onClick={() => setActiveOptionPreviewId(o.id)}
                      className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition ${isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {o.title}
                    </button>
                  );
                })}
              </div>

              {/* Option detail */}
              {(() => {
                const option = missionOptions.find(o => o.id === activeOptionPreviewId) ?? missionOptions[0];
                if (!option) return null;
                return (
                  <div className="space-y-6">
                    {option.description && (
                      <p className="text-base leading-relaxed text-slate-500">{option.description}</p>
                    )}

                    {/* Images — horizontal scroll with skeleton */}
                    {option.imageUrls?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">이미지</p>
                        <div className="flex gap-4 overflow-x-auto pb-2">
                          {option.imageUrls.map((url, i) => (
                            <div key={i} className="relative h-72 shrink-0">
                              {!loadedImageUrls.has(url) && (
                                <div className="h-72 w-64 rounded-2xl bg-slate-200 animate-pulse" />
                              )}
                              <img
                                src={url}
                                alt={`image ${i + 1}`}
                                onClick={() => setLightboxUrl(url)}
                                onLoad={() => setLoadedImageUrls(prev => new Set(prev).add(url))}
                                className={`h-72 w-auto rounded-2xl border border-slate-100 object-contain cursor-zoom-in transition-opacity duration-300 ${loadedImageUrls.has(url) ? "opacity-100" : "opacity-0 absolute inset-0"}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Content — markdown */}
                    {option.content && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">콘텐츠</p>
                        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 text-sm text-slate-700 space-y-2">
                          <ReactMarkdown components={{
                            h1: ({ children }) => <h1 className="text-xl font-bold text-slate-900 mb-2 mt-4 first:mt-0">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-semibold text-slate-900 mb-2 mt-4 first:mt-0">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-800 mb-1 mt-3">{children}</h3>,
                            p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc ml-5 space-y-1 mb-2">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal ml-5 space-y-1 mb-2">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                            strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
                            em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
                            code: ({ children }) => <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">{children}</code>,
                            blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-4 italic text-slate-500 my-2">{children}</blockquote>,
                            hr: () => <hr className="border-slate-200 my-4" />,
                          }}>{option.content}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Start button — fixed bottom */}
          <div className="border-t border-slate-200 bg-white px-8 py-4">
            <div className="mx-auto max-w-3xl">
              <button
                onClick={() => {
                  const option = missionOptions.find(o => o.id === activeOptionPreviewId) ?? missionOptions[0];
                  if (option) chooseMissionOption(option);
                }}
                className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                이 옵션으로 시작 {missionDurationMinutes ? `(${missionDurationMinutes}분)` : ""}
              </button>
            </div>
          </div>
        </main>
      ) : (
      <main className="flex flex-1 overflow-hidden">
        {/* Left panel: content */}
        <section className="flex-1 space-y-6 overflow-y-auto pb-32 pt-8 pl-10 pr-6">
          {/* Mission */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Mission</p>
              <div className="flex items-center gap-2">
                {missionOptions.length > 1 && (
                  <button
                    onClick={async () => {
                      setSelectedOptionId(null);
                      selectedOptionIdRef.current = null;
                      if (!isReadOnly && userId) {
                        await setDoc(doc(db, "sessions", userId, "missions", missionId), { selectedOptionId: null, updatedAt: Date.now() }, { merge: true });
                      }
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
                  >
                    옵션 변경
                  </button>
                )}
                {missionPeriod && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{missionPeriod}</span>
                )}
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                  {device === "mobile" ? <><DeviceMobileIcon size={12} className="inline" /> 모바일</> : <><MonitorIcon size={12} className="inline" /> PC</>}
                </span>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900">
                {missionTitle || <span className="font-normal text-slate-400">미션 제목 없음</span>}
              </p>
              {missionBrief ? (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 overflow-hidden">
                  <button
                    onClick={() => setIsMissionBriefExpanded(p => !p)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-500 hover:bg-slate-100 transition"
                  >
                    <span>미션 브리핑</span>
                    <span>{isMissionBriefExpanded ? "▲" : "▼"}</span>
                  </button>
                  {isMissionBriefExpanded && (
                    <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-700 space-y-2">
                      <ReactMarkdown components={{
                        h1: ({ children }) => <h1 className="text-base font-bold text-slate-900 mb-1 mt-3 first:mt-0">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-semibold text-slate-900 mb-1 mt-3 first:mt-0">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-medium text-slate-800 mb-1 mt-2">{children}</h3>,
                        p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc ml-4 space-y-1 mb-2">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal ml-4 space-y-1 mb-2">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
                        code: ({ children }) => <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-500 my-2">{children}</blockquote>,
                      }}>{missionBrief}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400">미션 브리핑 없음</p>
              )}
              {(selectedMissionOption?.imageUrls ?? []).length > 0 && (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {(selectedMissionOption?.imageUrls ?? []).map((url, i) => (
                    <div key={i} className="relative shrink-0">
                      {!loadedImageUrls.has(url) && <div className="h-48 w-48 rounded-2xl bg-slate-200 animate-pulse" />}
                      <img
                        src={url}
                        alt=""
                        onClick={() => setLightboxUrl(url)}
                        onLoad={() => setLoadedImageUrls(prev => new Set(prev).add(url))}
                        className={`h-48 w-auto rounded-2xl border border-slate-100 object-contain cursor-zoom-in transition-opacity duration-300 ${loadedImageUrls.has(url) ? "opacity-100" : "opacity-0 absolute inset-0"}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Reference */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Reference</p>
              {isFetchingRefs && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
                  레퍼런스 검색 중...
                </span>
              )}
            </div>
            {references.length === 0 && !isFetchingRefs ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                {'채팅에서 "레퍼런스 찾아줘"라고 입력하면 관련 UI 이미지가 표시됩니다.'}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {references.map((card) => {
                  const isSelected = selectedReferences.some(r => r.id === card.id);
                  return (
                    <div
                      key={card.id}
                      onClick={() => setSelectedReferences(prev => isSelected ? prev.filter(r => r.id !== card.id) : [...prev, card])}
                      className={`group relative flex flex-col rounded-2xl border overflow-hidden transition cursor-pointer ${
                        isSelected
                          ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300"
                          : "border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      {card.imageUrl && (
                        <div className="w-full h-36 overflow-hidden bg-slate-100">
                          <img
                            src={card.imageUrl}
                            alt={card.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-1 p-3">
                        <p className={`text-sm font-semibold leading-snug line-clamp-2 ${isSelected ? "text-indigo-700" : "text-slate-900"}`}>{card.title}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{card.tag}</span>
                          <div className="flex items-center gap-1">
                            {card.url && (
                              <a
                                href={card.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition"
                                title="새 탭에서 열기"
                              >
                                <ArrowSquareOutIcon size={12} />
                                링크
                              </a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm("이 레퍼런스를 삭제할까요?")) return;
                                setReferences(prev => prev.filter(r => r.id !== card.id));
                                setSelectedReferences(prev => prev.filter(r => r.id !== card.id));
                              }}
                              className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-400 transition"
                              title="삭제"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2 rounded-full bg-indigo-500 text-white text-xs px-2 py-0.5">인용됨</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Idea / Mockup / Presentation */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            {ideas.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-400">
                <p>아이디어를 직접 작성해보세요.</p>
                <button onClick={addIdea} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">+ 새 아이디어</button>
              </div>
            ) : (
              <>
                {/* Top: idea tabs */}
                <div className="flex gap-2 overflow-x-auto pb-4 mb-6 border-b border-slate-100">
                  {ideas.map((idea) => (
                    <button
                      key={idea.id}
                      onClick={() => switchIdea(idea.id)}
                      className={`shrink-0 rounded-xl border px-4 py-2 text-sm transition ${
                        activeIdeaId === idea.id
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {idea.title}
                    </button>
                  ))}
                  <button onClick={addIdea} className="shrink-0 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-400 hover:bg-slate-50 transition">+</button>
                </div>

                <div className="flex gap-4">
                  {/* Sub-tab sidebar */}
                  <div className="sticky top-4 flex flex-col space-y-2 self-start text-sm text-slate-600">
                    {[
                      { id: "idea", label: "Idea", ref: ideaSectionRef },
                      { id: "mockup", label: "Mockup", ref: mockupSectionRef },
                      { id: "presentation", label: "Presentation", ref: presentationSectionRef },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveIdeaTab(tab.id);
                          setTimeout(() => tab.ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                        }}
                        className={`rounded-xl border px-4 py-2 text-left transition ${
                          activeIdeaTab === tab.id
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Content — all sections always visible */}
                  <div className="flex-1 min-w-0 space-y-10">
                    {/* Idea */}
                    {(() => {
                      const idea = ideas.find(i => i.id === activeIdeaId) ?? null;
                      if (!idea) return null;
                      return (
                        <section ref={ideaSectionRef} className="space-y-3 scroll-mt-4">
                          <div className="flex items-center justify-between">
                            {ideaEditMode ? (
                              <input
                                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-base font-semibold text-slate-900 outline-none focus:border-slate-400"
                                value={idea.title}
                                onChange={e => updateIdea(idea.id, { title: e.target.value })}
                              />
                            ) : (
                              <p className="text-base font-semibold text-slate-900">{idea.title}</p>
                            )}
                            <div className="ml-3 flex items-center gap-2">
                              <button onClick={() => setIdeaEditMode(p => !p)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 transition">
                                {ideaEditMode ? "완료" : "편집"}
                              </button>
                              <button onClick={() => { if (confirm("이 아이디어를 삭제할까요?")) deleteIdea(idea.id); }} className="rounded border border-red-100 px-2 py-1 text-xs text-red-400 hover:bg-red-50 transition">삭제</button>
                            </div>
                          </div>
                          {ideaEditMode ? (
                            <textarea
                              className="w-full min-h-64 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 outline-none focus:border-slate-400"
                              placeholder={"마크다운으로 아이디어를 작성하세요.\n\n## 목표\n- ...\n\n## 핵심 기능\n- ..."}
                              value={idea.description}
                              onChange={e => updateIdea(idea.id, { description: e.target.value })}
                            />
                          ) : (
                            <div className="relative rounded-xl border border-slate-100 bg-slate-50">
                              <div className={`px-5 pt-4 pb-14 text-sm text-slate-700 space-y-2 ${isIdeaExpanded ? "max-h-[60vh] overflow-y-auto" : "max-h-56 overflow-hidden"}`}>
                                {idea.description ? (
                                  <ReactMarkdown components={{
                                    h1: ({ children }) => <h1 className="text-base font-bold text-slate-900 mb-1">{children}</h1>,
                                    h2: ({ children }) => <h2 className="text-sm font-semibold text-slate-900 mb-1 mt-3">{children}</h2>,
                                    h3: ({ children }) => <h3 className="text-sm font-medium text-slate-800 mb-1 mt-2">{children}</h3>,
                                    p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,
                                    ul: ({ children }) => <ul className="list-disc ml-4 space-y-1 mb-2">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal ml-4 space-y-1 mb-2">{children}</ol>,
                                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                    strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
                                    em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
                                    code: ({ children }) => <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>,
                                    blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-500 my-2">{children}</blockquote>,
                                    hr: () => <hr className="border-slate-200 my-3" />,
                                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700">{children}</a>,
                                  }}>{idea.description}</ReactMarkdown>
                                ) : (
                                  <p className="text-slate-400">편집 버튼을 눌러 내용을 작성하세요.</p>
                                )}
                              </div>
                              {!isIdeaExpanded && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent" />
                              )}
                              <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
                                <button
                                  onClick={() => setIsIdeaExpanded(p => !p)}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm transition hover:bg-slate-50"
                                >
                                  {isIdeaExpanded ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
                                  {isIdeaExpanded ? "접기" : "펼치기"}
                                </button>
                              </div>
                            </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* Mockup */}
                    <section ref={mockupSectionRef} className="space-y-3 scroll-mt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-base font-semibold text-slate-900">Mockup</p>
                        {ideaArtboards.length > 0 && (
                          <div className="flex items-center gap-2">
                            {editMode && selectedElement && (
                              <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                {selectedElement.selector} 선택됨
                                <button onClick={clearSelectedElement} className="ml-1 text-indigo-400 hover:text-indigo-600"><XIcon size={12} /></button>
                              </span>
                            )}
                            <button onClick={() => { setEditMode(p => { if (p) setSelectedElement(null); return !p; }); }} className={`rounded border px-2 py-1 text-xs font-semibold transition ${editMode ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                              {editMode ? "편집 중" : "편집"}
                            </button>
                            <button onClick={fitToCanvas} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Fit</button>
                            <button onClick={() => setCanvasScale(s => Math.min(s * 1.2, MAX_CANVAS_SCALE))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">+</button>
                            <button onClick={() => setCanvasScale(s => Math.max(s * 0.8, MIN_CANVAS_SCALE))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">−</button>
                            <span className="w-10 text-center text-xs text-slate-400">{Math.round(canvasScale * 100)}%</span>
                            <button onClick={() => { const html = activeArtboard?.html; if (!html) return; const blob = new Blob([html], { type: "text/html" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${activeArtboard?.label ?? "mockup"}.html`; a.click(); URL.revokeObjectURL(url); }} className="text-xs font-semibold text-slate-600 hover:text-slate-900">Export</button>
                            <button onClick={() => setIsMockupExpanded(true)} className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50" title="확대"><ArrowsOutIcon size={14} /></button>
                          </div>
                        )}
                      </div>
                      {ideaArtboards.length > 0 ? (
                        isMockupExpanded ? (
                          <div className="flex h-64 items-center justify-center rounded-2xl bg-[#1a1a1a] text-xs text-white/40">확대 보기 중...</div>
                        ) : renderMockupCanvas()
                      ) : (
                        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                          {isGeneratingCurrentIdeaMockup ? (
                            <><div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" /><p className="text-slate-500">Stitch로 목업 생성 중...</p></>
                          ) : (
                            <p>{'에이전트에게 "목업 만들어줘"라고 말하면 여기에 표시됩니다.'}</p>
                          )}
                        </div>
                      )}
                    </section>

                    {/* Presentation — per-idea */}
                    {(() => {
                      const activeIdea = ideas.find(i => i.id === activeIdeaId);
                      const presentations = activeIdea ? normalizePresentations(activeIdea) : [];
                      const selectedPresentation = presentations.find(p => p.id === activePresentationId) ?? presentations.at(-1) ?? null;
                      const deletePresentation = (presentationId: string) => {
                        if (!activeIdea) return;
                        const nextPresentations = normalizePresentations(activeIdea).filter(p => p.id !== presentationId);
                        updateIdea(activeIdea.id, {
                          presentations: nextPresentations,
                          presentationSlides: nextPresentations.at(-1)?.slides ?? [],
                          presentationHtml: nextPresentations.at(-1)?.html,
                        });
                        if (activePresentationId === presentationId) {
                          setActivePresentationId(nextPresentations.at(-1)?.id ?? null);
                        }
                      };
                      return (
                        <section ref={presentationSectionRef} className="space-y-3 scroll-mt-4">
                          <div className="flex items-center justify-between">
                            <p className="text-base font-semibold text-slate-900">Presentation</p>
                            {presentations.length > 0 && (
                              <span className="text-xs text-slate-400">{presentations.length}개</span>
                            )}
                          </div>
                          {isGeneratingPresentation ? (
                            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                              <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                              <p className="text-slate-500">피치덱 이미지 생성 중...</p>
                            </div>
                          ) : presentations.length > 0 ? (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
                                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                                  {presentations.map((presentation, index) => {
                                    const isActive = presentation.id === selectedPresentation?.id;
                                    return (
                                      <button
                                        key={presentation.id}
                                        onClick={() => setActivePresentationId(presentation.id)}
                                        className={`max-w-44 shrink-0 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                          isActive
                                            ? "bg-slate-900 text-white"
                                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                        }`}
                                        title={presentation.title}
                                      >
                                        {presentation.title || `P${index + 1}`}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {selectedPresentation && (
                                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-800">{selectedPresentation.title}</p>
                                    <p className="text-xs text-slate-400">
                                      {selectedPresentation.createdAt ? new Date(selectedPresentation.createdAt).toLocaleString("ko-KR") : "이전 프레젠테이션"}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (confirm("이 프레젠테이션을 삭제할까요?")) deletePresentation(selectedPresentation.id);
                                    }}
                                    className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                                    title="프레젠테이션 삭제"
                                  >
                                    <XIcon size={14} />
                                  </button>
                                </div>
                              )}
                              {selectedPresentation?.slides?.[0]?.imageUrl ? (
                                <div className="bg-black">
                                  <img src={selectedPresentation.slides[0].imageUrl} alt={selectedPresentation.slides[0].title} className="w-full object-contain" />
                                </div>
                              ) : selectedPresentation?.html ? (
                                <iframe srcDoc={selectedPresentation.html} sandbox="allow-scripts allow-same-origin" className="h-125 w-full bg-white" title={selectedPresentation.title || "Presentation preview"} />
                              ) : (
                                <div className="flex h-64 items-center justify-center text-sm text-slate-500">이미지 생성 실패</div>
                              )}
                            </div>
                          ) : (
                            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                              {ideaArtboards.length === 0 ? "목업을 먼저 생성하면 피치덱을 만들 수 있습니다." : '에이전트에게 "피치덱 만들어줘"라고 말하면 여기에 표시됩니다.'}
                            </div>
                          )}
                        </section>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Right panel: agent chat */}
        <aside className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white">
          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
                <p className="font-medium text-slate-500">디자인 에이전트</p>
                <p>레퍼런스 탐색, 목업 생성, 요소 수정을 도와드립니다.</p>
                <div className="mt-4 flex flex-col gap-2 text-xs">
                  {(ideas.length > 0 ? ["레퍼런스 찾아줘", "목업 만들어줘", "이 버튼 색상 바꿔줘"] : ["레퍼런스 찾아줘", "목업에 쓸 레퍼런스 찾아줘"]).map((hint) => (
                    <button
                      key={hint}
                      onClick={() => setInputText(hint)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, msgIdx) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-100 bg-slate-50 text-slate-700"
                  }`}
                >
                  {msg.role === "user" ? (
                    <div className="space-y-1.5">
                      {msg.citedElement && (
                        <div className="flex justify-end">
                          <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs text-white/80">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                            {msg.citedElement.selector}
                          </span>
                        </div>
                      )}
                      {msg.citedReferences && msg.citedReferences.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {msg.citedReferences.map(r => (
                            <span key={r.id} className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/80">
                              {r.imageUrl && <img src={r.imageUrl} alt="" className="h-3.5 w-5 rounded object-cover opacity-80" />}
                              <span className="max-w-32 truncate">{r.title}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div>{msg.content}</div>
                    </div>
                  ) : msg.content ? (() => {
                    const parts = processMessageContent(msg.content);
                    const mdComponents = {
                      p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                      ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                      li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
                      strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
                      code: ({ children }: { children?: React.ReactNode }) => <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>,
                      pre: ({ children }: { children?: React.ReactNode }) => <pre className="mt-1 max-h-36 overflow-y-auto rounded-xl bg-slate-800 p-3 text-xs text-slate-100">{children}</pre>,
                      h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-1 text-base font-semibold">{children}</h1>,
                      h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-1 text-sm font-semibold">{children}</h2>,
                      h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1 text-sm font-medium">{children}</h3>,
                      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700">{children}</a>
                      ),
                    };
                    const isStreamingThis = isLoading && msgIdx === messages.length - 1;
                    return (
                      <div className="space-y-2">
                        {parts.map((part, i) =>
                          part.type === "text" ? (
                            <ReactMarkdown key={i} components={mdComponents}>{part.content}</ReactMarkdown>
                          ) : (
                            <CodeChip
                              key={i}
                              chipKey={`${msg.id}-${i}`}
                              chip={part.chip}
                              expanded={expandedChips.has(`${msg.id}-${i}`)}
                              onToggle={(k: string) => setExpandedChips(prev => {
                                const next = new Set(prev);
                                next.has(k) ? next.delete(k) : next.add(k);
                                return next;
                              })}
                            />
                          )
                        )}
                        {isStreamingThis && (
                          <span className="inline-flex items-center gap-0.5 ml-0.5">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
                          </span>
                        )}
                      </div>
                    );
                  })() : (
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 bg-white/95 p-4">
            {isReadOnly && (
              <div className="flex h-12 items-center justify-center rounded-2xl bg-amber-50 text-xs text-amber-600">
                읽기 전용 모드 — 채팅을 사용할 수 없습니다
              </div>
            )}
            {!isReadOnly && selectedElement && (
              <div className="mb-2 flex items-center justify-between rounded-xl bg-indigo-50 px-3 py-2 text-xs">
                <span className="font-medium text-indigo-600">
                  선택된 요소: <code className="font-mono">{selectedElement.selector}</code>
                </span>
                <button onClick={clearSelectedElement} className="text-indigo-400 hover:text-indigo-600"><XIcon size={12} /></button>
              </div>
            )}
            {!isReadOnly && selectedReferences.length > 0 && (
              <div className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-violet-600">레퍼런스 인용 ({selectedReferences.length})</span>
                  <button onClick={() => setSelectedReferences([])} className="text-violet-400 hover:text-violet-600">전체 해제</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedReferences.map(r => (
                    <span key={r.id} className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">
                      {r.imageUrl && <img src={r.imageUrl} alt="" className="h-3.5 w-5 rounded object-cover" />}
                      <span className="max-w-32 truncate">{r.title}</span>
                      <button onClick={() => setSelectedReferences(prev => prev.filter(x => x.id !== r.id))} className="ml-0.5 text-violet-400 hover:text-violet-600"><XIcon size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!isReadOnly && (
              <div className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputText}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="에이전트에게 메시지를 입력하세요..."
                  className="max-h-24 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
                {isGeneratingMockup ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2 text-xs text-slate-500">
                    <span className="h-2 w-2 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                    {generatingMockupIdeaId === activeIdeaId ? "Stitch 생성 중" : "다른 아이디어 생성 중"}
                  </span>
                ) : isLoading ? (
                  <button
                    onClick={cancelMessage}
                    className="rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                  >
                    중단
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim()}
                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Send
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
      )}

      {/* Mockup expanded canvas: keep the chat panel visible */}
      {isMockupExpanded && (
        <div className="fixed inset-y-0 left-0 right-0 z-40 flex flex-col bg-[#1a1a1a] md:right-[28rem]" style={{ backgroundImage: "radial-gradient(circle, #383838 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          {/* Overlay header */}
          <div className="flex items-center justify-between bg-slate-900/80 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <button onClick={fitToCanvas} className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10">Fit</button>
              <button onClick={() => setCanvasScale(s => Math.min(s * 1.2, MAX_CANVAS_SCALE))} className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10">+</button>
              <button onClick={() => setCanvasScale(s => Math.max(s * 0.8, MIN_CANVAS_SCALE))} className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10">−</button>
              <span className="text-xs text-white/40">{Math.round(canvasScale * 100)}%</span>
            </div>
            <button onClick={() => setIsMockupExpanded(false)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20">
              <ArrowsInIcon size={14} /> 축소
            </button>
          </div>

          {/* Canvas */}
          {renderMockupCanvas(true)}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <XIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
