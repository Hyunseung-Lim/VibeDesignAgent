"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { firebaseAuth, db, storage } from "@/lib/firebase";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import {
  ref as storageRef,
  uploadString,
  getDownloadURL,
} from "firebase/storage";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ArrowsOutIcon,
  ArrowsInIcon,
  CaretUpIcon,
  CaretDownIcon,
  DeviceMobileIcon,
  MonitorIcon,
  EyeIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { isAdminEmail } from "@/lib/admin";
const ONBOARDING_MISSION_ID = "onboarding";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  citedElement?: {
    selector: string;
    artboardId: string;
    outerHTML?: string;
  } | null;
  citedReferences?: { id: string; title: string; imageUrl?: string }[] | null;
  citedTexts?: string[] | null;
};

type ActivityLogEvent = {
  id: string;
  createdAt: number;
  section: "reference" | "note" | "mockup" | "presentation";
  action: "add" | "delete" | "create" | "update" | "stitch_prompt";
  input?: string;
  output?: string;
  outputTitle?: string;
  link?: string;
  imageUrl?: string;
  html?: string;
  stitchPrompt?: string;
};

type MemoryRecord = {
  id: string;
  category?: string[];
  subcategory?: string[];
  keywords?: string[];
  episode?: string;
  semantic?: string;
  timestamp?: number;
  createdAt?: number;
};

type MemoryContext = {
  episodic: MemoryRecord[];
  semantic: MemoryRecord[];
};

type MemoryRetrievalResponse = {
  retrieved?: MemoryRecord[];
};

type Reference = {
  id: string;
  title: string;
  description: string;
  tag: string;
  url?: string;
  imageUrl?: string;
  referenceMode?: "style" | "product";
  searchProvider?: "openai-web" | "serper-image";
};

type DesignStyle = {
  id: string;
  title: string;
  content: string;
  createdAt?: number;
};

type Idea = {
  id: string;
  title: string;
  description: string;
  designStyle?: DesignStyle;
  createdAt?: number;
  updatedAt?: number;
  presentations?: Presentation[];
  presentationSlides?: PresentationSlide[];
  presentationHtml?: string;
};

type Device = "desktop" | "mobile";

type MissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
  device?: Device;
};

type Artboard = {
  id: string;
  html: string;
  label: string;
  createdAt?: number;
  htmlUpdatedAt?: number;
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

type PresentationData = {
  title: string;
  slides: { title: string; content: string; imagePrompt: string }[];
};

type MockupCaptureSection = {
  label: string;
  description: string;
  yRatio: number;
  kind: string;
};

type MockupCapture = {
  dataUrl: string;
  width: number;
  height: number;
  sections: MockupCaptureSection[];
};

type CreateNoteData = {
  title?: string;
  description?: string;
};

type UpdateNoteData = {
  title?: string;
  description?: string;
};

function parsePresentationBlock(
  text: string,
):
  | { isJson: true; data: PresentationData }
  | { isJson: false; html: string }
  | null {
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
    .replace(
      /프레젠테이션을 생성했습니다\./g,
      "프레젠테이션 이미지를 생성하고 있습니다.",
    )
    .replace(
      /프레젠테이션이 생성되었습니다\./g,
      "프레젠테이션 이미지를 생성하고 있습니다.",
    )
    .replace(/피치덱을 생성했습니다\./g, "프레젠테이션 이미지를 생성하고 있습니다.")
    .replace(
      /피치덱이 생성되었습니다\./g,
      "프레젠테이션 이미지를 생성하고 있습니다.",
    );
}

function normalizePresentations(idea: Idea): Presentation[] {
  if (idea.presentations?.length) return idea.presentations;
  if (idea.presentationSlides?.length) {
    return [
      {
        id: `legacy-slides-${idea.id}`,
        title: idea.presentationSlides[0]?.title || "Presentation",
        createdAt: 0,
        slides: idea.presentationSlides,
      },
    ];
  }
  if (idea.presentationHtml) {
    return [
      {
        id: `legacy-html-${idea.id}`,
        title: "Presentation",
        createdAt: 0,
        slides: [],
        html: idea.presentationHtml,
      },
    ];
  }
  return [];
}

function canonicalReferenceUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.searchParams.sort();
    const pathname =
      url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function referenceMatches(a: Reference, b: Reference) {
  const aUrl = canonicalReferenceUrl(a.url);
  const bUrl = canonicalReferenceUrl(b.url);
  const aImage = canonicalReferenceUrl(a.imageUrl);
  const bImage = canonicalReferenceUrl(b.imageUrl);
  return Boolean((aUrl && aUrl === bUrl) || (aImage && aImage === bImage));
}

function normalizeMissionOptions(
  mission: {
    title?: string;
    description?: string;
    options?: MissionOption[];
  } | null,
): MissionOption[] {
  const options = (mission?.options ?? [])
    .filter((option) => option?.title?.trim())
    .map((option) => ({
      id: option.id || crypto.randomUUID(),
      title: option.title ?? "",
      description: option.description ?? "",
      device: option.device,
      content: option.content ?? "",
    }));
  if (options.length > 0) return options;
  if (mission?.title || mission?.description) {
    return [
      {
        id: "legacy-option",
        title: mission.title || "미션 옵션",
        description: mission.description || "",
        content: mission.description || "",
      },
    ];
  }
  return [];
}

function optionBrief(option: MissionOption | null) {
  if (!option) return "";
  return [
    option.description,
    option.content ? `웹/앱에 들어가야 하는 콘텐츠:\n${option.content}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createDefaultOnboardingMissionData() {
  return {
    title: "온보딩 미션",
    description:
      "자유주제로 PC 또는 모바일 화면을 선택해 노트, 목업, 프레젠테이션 생성 흐름을 연습합니다.",
    durationMinutes: 20,
    options: [
      {
        id: "onboarding-desktop",
        title: "PC 자유주제",
        description: "PC 화면 기준으로 자유롭게 웹/앱 아이디어를 진행합니다.",
        device: "desktop" as Device,
        content:
          "자유주제로 랜딩 페이지, 서비스 화면, 포트폴리오, 커머스 등 원하는 웹/앱 화면을 만들어보세요.",
      },
      {
        id: "onboarding-mobile",
        title: "모바일 자유주제",
        description: "모바일 화면 기준으로 자유롭게 앱/웹 아이디어를 진행합니다.",
        device: "mobile" as Device,
        content:
          "자유주제로 온보딩, 홈 화면, 상세 화면, 예약/구독/커머스 등 원하는 모바일 화면을 만들어보세요.",
      },
    ],
  };
}

async function fetchOnboardingMissionData() {
  const fallback = createDefaultOnboardingMissionData();
  try {
    const res = await fetch("/api/onboarding");
    if (!res.ok) return fallback;
    const settings = (await res.json()) as {
      durationMinutes?: number;
    };
    return {
      ...fallback,
      durationMinutes: Number(settings.durationMinutes) || 20,
    };
  } catch {
    return fallback;
  }
}

function isInlineOrLocalAsset(url: string) {
  return (
    !url ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("#") ||
    url.startsWith("about:")
  );
}

async function fetchAssetDataUrl(url: string, baseUrl: string) {
  if (isInlineOrLocalAsset(url)) return url;
  try {
    const absoluteUrl = new URL(url, baseUrl).toString();
    const res = await fetch(
      `/api/image-data?url=${encodeURIComponent(absoluteUrl)}`,
    );
    if (!res.ok) return url;
    const data = (await res.json()) as { dataUrl?: string };
    return data.dataUrl ?? url;
  } catch {
    return url;
  }
}

async function fetchAssetText(url: string, baseUrl: string) {
  if (isInlineOrLocalAsset(url)) return "";
  try {
    const absoluteUrl = new URL(url, baseUrl).toString();
    const res = await fetch(
      `/api/image-data?url=${encodeURIComponent(absoluteUrl)}`,
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  } catch {
    return "";
  }
}

function extractJsonActionPayload(text: string, tag: "CREATE_NOTE" | "UPDATE_NOTE") {
  const start = text.indexOf(`[${tag}:`);
  if (start === -1) return null;

  const payloadStart = text.indexOf("{", start);
  if (payloadStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = payloadStart; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(payloadStart, i + 1);
    }
  }

  return null;
}

function parseCreateNoteBlock(text: string): CreateNoteData | null {
  const payload = extractJsonActionPayload(text, "CREATE_NOTE");
  if (!payload) return null;
  try {
    return JSON.parse(payload) as CreateNoteData;
  } catch {
    return { description: payload.trim() };
  }
}

function parseUpdateNoteBlock(text: string): UpdateNoteData | null {
  const payload = extractJsonActionPayload(text, "UPDATE_NOTE");
  if (!payload) return null;
  try {
    return JSON.parse(payload) as UpdateNoteData;
  } catch {
    return { description: payload.trim() };
  }
}

function parseCreateDesignSpecBlock(text: string): { title: string; content: string } | null {
  const tag = "[CREATE_DESIGN_SPEC:";
  const start = text.indexOf(tag);
  if (start === -1) return null;
  const payloadStart = text.indexOf("{", start);
  if (payloadStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = payloadStart; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") { depth--; if (depth === 0) {
      try { return JSON.parse(text.slice(payloadStart, i + 1)); } catch { return null; }
    }}
  }
  return null;
}

function compactText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trim()}...`
    : normalized;
}

function elementText(el: Element, maxLength = 180) {
  return compactText((el.textContent ?? "").replace(/\s+/g, " "), maxLength);
}

function nearestSectionElement(el: Element) {
  return (
    el.closest("section, article, header, nav, footer, main > div") ?? el
  );
}

function sectionKind(label: string, tagName: string) {
  const text = label.toLowerCase();
  if (tagName === "nav" || tagName === "header") return "navigation";
  if (tagName === "footer") return "footer";
  if (/faq|question|문의|질문/.test(text)) return "faq";
  if (/review|testimonial|rating|후기|리뷰|추천/.test(text)) return "reviews";
  if (/feature|benefit|특징|혜택|기능/.test(text)) return "features";
  if (/logo|partner|press|media|trusted|신뢰|매체|파트너/.test(text))
    return "trust";
  if (/cta|subscribe|sign|download|구독|가입|시작|문의/.test(text))
    return "conversion";
  return "section";
}

function extractMockupCaptureSections(
  doc: Document,
  fullHeight: number,
): MockupCaptureSection[] {
  const sections: MockupCaptureSection[] = [];
  const seen = new Set<string>();

  const addSection = (
    source: Element | null | undefined,
    label: string,
    kind = "section",
  ) => {
    if (!source || !label.trim()) return;
    const rect = source.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 12) return;
    const yRatio = Math.max(
      0.03,
      Math.min(0.97, (rect.top + rect.height * 0.45) / fullHeight),
    );
    const normalizedLabel = compactText(label, 72);
    const dedupeKey = `${Math.round(yRatio * 20)}:${normalizedLabel.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const sourceText = elementText(source, 260);
    const description =
      compactText(sourceText.replace(normalizedLabel, "").trim(), 170) ||
      sourceText ||
      normalizedLabel;
    sections.push({
      label: normalizedLabel,
      description,
      yRatio,
      kind,
    });
  };

  const nav = doc.querySelector("header, nav, [role='banner']");
  addSection(nav, "Navigation", "navigation");

  const headings = Array.from(
    doc.querySelectorAll<HTMLElement>("h1, h2, h3, [role='heading']"),
  ).filter((heading) => elementText(heading, 90).length > 0);

  for (const heading of headings) {
    const section = nearestSectionElement(heading);
    const label = elementText(heading, 90);
    addSection(section, label, sectionKind(label, section.tagName.toLowerCase()));
  }

  const footer = doc.querySelector("footer, [role='contentinfo']");
  addSection(footer, "Footer", "footer");

  return sections
    .sort((a, b) => a.yRatio - b.yRatio)
    .filter((section, index, all) => {
      const previous = all[index - 1];
      return !previous || Math.abs(section.yRatio - previous.yRatio) > 0.045;
    })
    .slice(0, 9);
}

async function inlineCaptureAssets(doc: Document) {
  const baseUrl = doc.baseURI || window.location.href;
  const cssUrlPattern = /url\((['"]?)(.*?)\1\)/g;

  const inlineCssUrls = async (css: string, cssBaseUrl: string) => {
    let nextCss = css;
    const importMatches = Array.from(
      nextCss.matchAll(/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?[^;]*;/g),
    );
    for (const match of importMatches) {
      const importedCss = await fetchAssetText(match[1], cssBaseUrl);
      if (!importedCss) continue;
      const importedBaseUrl = new URL(match[1], cssBaseUrl).toString();
      const inlinedImport = await inlineCssUrls(importedCss, importedBaseUrl);
      nextCss = nextCss.replace(match[0], inlinedImport);
    }

    const replacements = await Promise.all(
      Array.from(nextCss.matchAll(cssUrlPattern)).map(async (match) => {
        const originalUrl = match[2];
        const dataUrl = await fetchAssetDataUrl(originalUrl, cssBaseUrl);
        return { raw: match[0], value: `url("${dataUrl}")` };
      }),
    );

    return replacements.reduce(
      (acc, item) => acc.replace(item.raw, item.value),
      nextCss,
    );
  };

  await Promise.all(
    Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
    ).map(async (link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      const css = await fetchAssetText(href, baseUrl);
      if (!css) return;
      const cssBaseUrl = new URL(href, baseUrl).toString();
      const style = doc.createElement("style");
      style.setAttribute("data-vda-inlined-stylesheet", href);
      style.textContent = await inlineCssUrls(css, cssBaseUrl);
      link.replaceWith(style);
    }),
  );

  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLStyleElement>("style")).map(
      async (style) => {
        if (!style.textContent?.includes("url(") && !style.textContent?.includes("@import")) return;
        style.textContent = await inlineCssUrls(style.textContent, baseUrl);
      },
    ),
  );

  if ("fonts" in doc) {
    await (doc as Document & { fonts: FontFaceSet }).fonts.ready.catch(
      () => undefined,
    );
  }

  await Promise.all(
    Array.from(doc.images).map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || isInlineOrLocalAsset(src)) return;
      const dataUrl = await fetchAssetDataUrl(src, baseUrl);
      img.setAttribute("src", dataUrl);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    }),
  );

  await Promise.all(
    Array.from(doc.querySelectorAll("svg image")).map(async (image) => {
      const href =
        image.getAttribute("href") || image.getAttribute("xlink:href");
      if (!href || isInlineOrLocalAsset(href)) return;
      const dataUrl = await fetchAssetDataUrl(href, baseUrl);
      image.setAttribute("href", dataUrl);
      image.setAttribute("xlink:href", dataUrl);
    }),
  );

  await Promise.all(
    Array.from(doc.querySelectorAll("svg use")).map(async (use) => {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (!href || isInlineOrLocalAsset(href)) return;
      const [assetUrl, fragment = ""] = href.split("#");
      const dataUrl = await fetchAssetDataUrl(assetUrl, baseUrl);
      const nextHref = fragment ? `${dataUrl}#${fragment}` : dataUrl;
      use.setAttribute("href", nextHref);
      use.setAttribute("xlink:href", nextHref);
    }),
  );

  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLElement>("*")).map(async (el) => {
      const computed = doc.defaultView?.getComputedStyle(el);
      if (!computed) return;

      for (const prop of [
        "backgroundImage",
        "maskImage",
        "webkitMaskImage",
      ] as const) {
        const value = computed[prop];
        if (!value || value === "none" || !value.includes("url(")) continue;

        const replacements = await Promise.all(
          Array.from(value.matchAll(cssUrlPattern)).map(async (match) => {
            const originalUrl = match[2];
            const dataUrl = await fetchAssetDataUrl(originalUrl, baseUrl);
            return { raw: match[0], value: `url("${dataUrl}")` };
          }),
        );

        const nextValue = replacements.reduce(
          (acc, item) => acc.replace(item.raw, item.value),
          value,
        );
        el.style[prop] = nextValue;
      }
    }),
  );
}

function pseudoContentToText(content: string) {
  if (!content || content === "none" || content === "normal") return "";
  const unquoted = content.replace(/^['"]|['"]$/g, "");
  return unquoted.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
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
  const sourceNodes = [
    doc.documentElement,
    ...Array.from(doc.documentElement.querySelectorAll("*")),
  ] as Element[];
  const clonedRoot = doc.documentElement.cloneNode(true) as HTMLElement;
  const clonedNodes = [
    clonedRoot,
    ...Array.from(clonedRoot.querySelectorAll("*")),
  ] as HTMLElement[];

  sourceNodes.forEach((source, index) => {
    const target = clonedNodes[index];
    if (!target) return;
    const computed = doc.defaultView?.getComputedStyle(source);
    if (!computed) return;
    const style = Array.from(computed)
      .map(
        (prop) =>
          `${prop}:${computed.getPropertyValue(prop)}${computed.getPropertyPriority(prop) ? " !important" : ""};`,
      )
      .join("");
    target.setAttribute(
      "style",
      `${target.getAttribute("style") ?? ""};${style}`,
    );
  });

  return clonedRoot;
}

async function captureMockupScreenshot(
  html: string,
  device: Device,
): Promise<MockupCapture | null> {
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
    const sections = extractMockupCaptureSections(doc, fullHeight);

    const clonedRoot = cloneWithComputedStyles(doc);
    const serialized = new XMLSerializer().serializeToString(clonedRoot);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("mockup screenshot image load failed"));
        image.src = svgDataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = fullHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx)
        return { dataUrl: svgDataUrl, width, height: fullHeight, sections };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, fullHeight);
      ctx.drawImage(image, 0, 0, width, fullHeight);
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width,
        height: fullHeight,
        sections,
      };
    } catch {
      return { dataUrl: svgDataUrl, width, height: fullHeight, sections };
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
  const idx = html.lastIndexOf("</body>");
  return idx !== -1
    ? html.slice(0, idx) + script + html.slice(idx)
    : html + script;
}

function injectHeightReporter(html: string, artboardId: string): string {
  const script = `<style>
/* Prevent viewport-relative heights from creating feedback loop with iframe resize */
html, body { min-height: 0 !important; height: auto !important; }
.h-screen, .h-dvh, .h-svh, .h-lvh,
.min-h-screen, .min-h-dvh, .min-h-svh, .min-h-lvh {
  height: auto !important;
  min-height: 0 !important;
}
</style>
<script>
(function(){
  var lastHeight = 0;
  var reportCount = 0;
  var MAX_REPORTS = 6;
  function measure(){
    if (reportCount >= MAX_REPORTS) return;
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
    reportCount++;
    window.parent.postMessage({
      type: 'vda-artboard-height',
      artboardId: '${artboardId}',
      height: height
    }, '*');
  }
  if (document.documentElement) document.documentElement.style.overflow = 'hidden';
  if (document.body) document.body.style.overflow = 'hidden';
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-artboard-context-menu',
      artboardId: '${artboardId}',
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true });
  window.addEventListener('load', measure);
  setTimeout(measure, 0);
  setTimeout(measure, 500);
  setTimeout(measure, 1500);
  setTimeout(measure, 3000);
})();
</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx !== -1
    ? html.slice(0, idx) + script + html.slice(idx)
    : html + script;
}

type ContentChip = { label: string; done: boolean; code?: string };
type ContentPart =
  | { type: "text"; content: string }
  | { type: "chip"; chip: ContentChip };

const BLOCK_RULES = [
  {
    complete: /\[CREATE_NOTE:\s*\{[\s\S]*?\}\]/,
    partial: /\[CREATE_NOTE:[\s\S]*$/,
    doneLabel: "노트 생성됨",
    pendingLabel: "노트 작성 중...",
  },
  {
    complete: /\[UPDATE_NOTE:\s*\{[\s\S]*?\}\]/,
    partial: /\[UPDATE_NOTE:[\s\S]*$/,
    doneLabel: "노트 수정됨",
    pendingLabel: "노트 수정 중...",
  },
  {
    complete: /\[GENERATE_MOCKUP(?::[^\]]*)?\]/,
    partial: /\[GENERATE_MOCKUP:[\s\S]*$/,
    doneLabel: "새 목업 생성 요청",
    pendingLabel: "목업 설명 작성 중...",
  },
  {
    complete: /\[EDIT_MOCKUP(?::[^\]]*)?\]/,
    partial: /\[EDIT_MOCKUP:[\s\S]*$/,
    doneLabel: "목업 수정 요청",
    pendingLabel: "수정 내용 작성 중...",
  },
  {
    complete: /```presentation\s*\n[\s\S]*?\n?\s*```/,
    partial: /```presentation[\s\S]*$/,
    doneLabel: "프레젠테이션 프롬프트 준비됨",
    pendingLabel: "프레젠테이션 프롬프트 작성 중...",
  },
  {
    complete: /\[FETCH_REFERENCES(?::[^\]]+)?\]/,
    partial: /\[FETCH_REFERENCES[\s\S]*$/,
    doneLabel: "레퍼런스 검색됨",
    pendingLabel: "레퍼런스 검색 중...",
  },
  {
    complete: /\[WEB_SEARCHED\]/,
    partial: /\[WEB_SEARCHED\]/,
    doneLabel: "웹 검색 완료",
    pendingLabel: "웹 검색 중...",
  },
  {
    complete: /\[CREATE_DESIGN_SPEC:\s*\{[\s\S]*?\}\]/,
    partial: /\[CREATE_DESIGN_SPEC:[\s\S]*$/,
    doneLabel: "디자인 스타일 추가됨",
    pendingLabel: "디자인 스타일 작성 중...",
  },
];

function processMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    let earliest: {
      index: number;
      matchStr: string;
      label: string;
      done: boolean;
    } | null = null;

    for (const rule of BLOCK_RULES) {
      for (const [regex, done, label] of [
        [rule.complete, true, rule.doneLabel],
        [rule.partial, false, rule.pendingLabel],
      ] as [RegExp, boolean, string][]) {
        const m = remaining.match(regex);
        if (
          m &&
          m.index !== undefined &&
          (earliest === null || m.index < earliest.index)
        ) {
          earliest = { index: m.index, matchStr: m[0], label, done };
        }
      }
    }

    if (!earliest) {
      if (remaining.trim())
        parts.push({ type: "text", content: remaining.trim() });
      break;
    }

    const before = remaining.slice(0, earliest.index).trim();
    if (before) parts.push({ type: "text", content: before });

    // Extract code content from the matched block
    const codeMatch = earliest.matchStr.match(
      /```(?:html|presentation)\s*\n([\s\S]*?)(?:\n?\s*```|$)/,
    );
    const code = codeMatch ? codeMatch[1].trim() : earliest.matchStr;

    parts.push({
      type: "chip",
      chip: { label: earliest.label, done: earliest.done, code },
    });
    remaining = remaining.slice(earliest.index + earliest.matchStr.length);
  }

  return parts;
}

function splitPendingMockupCompletionText(content: string) {
  const match = content.match(/\[(?:GENERATE|EDIT)_MOCKUP:\s*[\s\S]*?\]/);
  if (!match || match.index === undefined) {
    return { visibleText: content, completionText: "" };
  }

  const blockEnd = match.index + match[0].length;
  const completionText = content.slice(blockEnd).trim();
  if (!completionText) return { visibleText: content, completionText: "" };

  return {
    visibleText: content.slice(0, blockEnd).trimEnd(),
    completionText,
  };
}

function normalizeActionBlockAliases(content: string) {
  return content
    .replace(/\[(?:목업\s*)?생성\s*요청\s*\]/g, "[GENERATE_MOCKUP: ]")
    .replace(/\[(?:목업\s*)?생성\s*요청\s*:\s*([\s\S]*?)\]/g, "[GENERATE_MOCKUP: $1]")
    .replace(/\[목업\s*생성\s*:\s*([\s\S]*?)\]/g, "[GENERATE_MOCKUP: $1]")
    .replace(/\[(?:목업\s*)?수정\s*요청\s*\]/g, "[EDIT_MOCKUP: ]")
    .replace(/\[(?:목업\s*)?수정\s*요청\s*:\s*([\s\S]*?)\]/g, "[EDIT_MOCKUP: $1]")
    .replace(/\[목업\s*수정\s*:\s*([\s\S]*?)\]/g, "[EDIT_MOCKUP: $1]")
    .replace(/\[레퍼런스\s*검색\s*:\s*([\s\S]*?)\]/g, "[FETCH_REFERENCES: $1]");
}

function defaultMockupPromptForIdea(idea: Idea | null, targetDevice: Device) {
  const deviceLabel = targetDevice === "mobile" ? "mobile app screen" : "desktop web page";
  return [
    `Create a high-fidelity ${deviceLabel} UI mockup based on the active note.`,
    idea?.title ? `Note title: ${idea.title}` : "",
    idea?.description ? `Note content:\n${idea.description}` : "",
    "Use polished visual hierarchy, realistic content, strong spacing, and a complete usable first screen.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeMockupActionPrompt(rawPrompt: string) {
  const prompt = rawPrompt.trim();
  if (!prompt.startsWith("{") || !prompt.endsWith("}")) return prompt;

  try {
    const parsed = JSON.parse(prompt) as { prompt?: unknown };
    if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      return parsed.prompt.trim();
    }
  } catch {
    return prompt;
  }

  return prompt;
}

function cleanMessageContentForModel(content: string) {
  return content
    .replace(/\[CREATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[노트 생성]")
    .replace(/\[UPDATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[노트 수정]")
    .replace(/\[GENERATE_MOCKUP:[\s\S]*?\]/g, "이전 액션: mockup generation requested.")
    .replace(/\[EDIT_MOCKUP:[\s\S]*?\]/g, "이전 액션: mockup edit requested.")
    .replace(/```presentation\s*\n[\s\S]*?\n?\s*```/g, "이전 액션: presentation requested.")
    .replace(/\[FETCH_REFERENCES(?::[^\]]+)?\]/g, "이전 액션: reference search requested.")
    .replace(/\[WEB_SEARCHED\]/g, "이전 액션: web search completed.")
    .replace(/\[CREATE_DESIGN_SPEC:\s*\{[\s\S]*?\}\]/g, "[디자인 스타일 추가]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseManualReferencePrompt(text: string): Reference | null {
  if (!/레퍼런스(?:로|에)?\s*(?:넣|추가|등록)/i.test(text)) return null;

  const match = text.match(
    /(?:https?:\/\/|www\.)[^\s"'<>]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/,
  );
  if (!match) return null;

  const rawUrl = match[0].replace(/[),.，。]+$/g, "");
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  const isImageUrl = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(
    parsed.pathname,
  );

  return {
    id: `manual-ref-${Date.now()}`,
    title: hostname,
    description: "사용자가 직접 추가한 레퍼런스",
    tag: hostname,
    url: parsed.toString(),
    imageUrl: isImageUrl ? parsed.toString() : undefined,
  };
}

async function hydrateManualReference(reference: Reference): Promise<Reference> {
  if (reference.imageUrl) return reference;

  try {
    const res = await fetch(
      `/api/reference-metadata?url=${encodeURIComponent(reference.url ?? "")}`,
    );
    if (!res.ok) return reference;
    const data = (await res.json()) as {
      title?: string | null;
      imageUrl?: string | null;
    };
    return {
      ...reference,
      title: data.title?.trim() || reference.title,
      imageUrl: data.imageUrl || reference.imageUrl,
    };
  } catch {
    return reference;
  }
}

function formatMemoryInputWithCitations(
  text: string,
  citedReferences: Reference[],
  citedTexts: string[],
  citedElement: { artboardId: string; selector: string; outerHTML?: string } | null,
) {
  const sections = [`user input: ${text}`];
  if (citedReferences.length > 0) {
    sections.push(
      [
        `cited references (${citedReferences.length}):`,
        ...citedReferences.map((reference, index) =>
          [
            `${index + 1}. ${reference.title}`,
            reference.tag ? `tag: ${reference.tag}` : "",
            reference.url ? `url: ${reference.url}` : "",
            reference.imageUrl ? `imageUrl: ${reference.imageUrl}` : "",
            reference.description
              ? `description: ${reference.description}`
              : "",
          ]
            .filter(Boolean)
            .join(" / "),
        ),
      ].join("\n"),
    );
  }
  if (citedTexts.length > 0) {
    sections.push(
      [
        `cited text snippets (${citedTexts.length}):`,
        ...citedTexts.map((snippet, index) => `${index + 1}. ${snippet}`),
      ].join("\n"),
    );
  }
  if (citedElement) {
    sections.push(
      [
        "cited design element:",
        `artboardId: ${citedElement.artboardId}`,
        `selector: ${citedElement.selector}`,
        citedElement.outerHTML
          ? `outerHTML: ${citedElement.outerHTML.slice(0, 1200)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return sections.join("\n\n");
}

function CodeChip({
  chipKey,
  chip,
  expanded,
  onToggle,
}: {
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
        {hasCode &&
          (expanded ? (
            <CaretUpIcon size={12} className="text-slate-400" />
          ) : (
            <CaretDownIcon size={12} className="text-slate-400" />
          ))}
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

function activeDesignStyle(idea?: Idea | null) {
  return idea?.designStyle ?? null;
}

function buildMockupPrompt(basePrompt: string, idea?: Idea | null, appliedStyle?: DesignStyle | null) {
  const parts: string[] = [basePrompt];
  if (appliedStyle?.content.trim()) {
    parts.push(
      "",
      `Design style "${appliedStyle.title}" for this note (stable style reference — always follow these constraints):`,
      appliedStyle.content.slice(0, 4000),
    );
  }
  if (idea?.description?.trim()) {
    parts.push(
      "",
      "Use the following active note as the current idea brief. It describes what to build for this specific 시안.",
      `Note title: ${idea.title}`,
      `Note content:\n${idea.description.slice(0, 8000)}`,
    );
  }
  return parts.join("\n");
}

function nextDraftTitle(ideas: Idea[]) {
  const usedNumbers = ideas
    .map((idea) => idea.title.match(/^시안\s*(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const maxNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) : ideas.length;
  return `시안 ${maxNumber + 1}`;
}

const HEX_COLOR_RE = /(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/g;

function parseColorTokens(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  HEX_COLOR_RE.lastIndex = 0;
  while ((match = HEX_COLOR_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const hex = match[1];
    parts.push(
      <span key={match.index} className="inline-flex items-center gap-1 align-middle">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
          style={{ backgroundColor: hex }}
        />
        <code className="font-mono text-[10px] text-indigo-700">{hex}</code>
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function withColorTokens(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") return parseColorTokens(children);
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === "string"
        ? parseColorTokens(child).map((node, nodeIndex) =>
            typeof node === "string"
              ? node
              : React.cloneElement(node as React.ReactElement, {
                  key: `${index}-${nodeIndex}`,
                }),
          )
        : child,
    );
  }
  return children;
}

function isExplicitNewMockupRequest(text: string) {
  return /아예\s*(새|새로운|다른)|새(로운|로)?\s*(목업|디자인|버전|시안|화면|캔버스|레이아웃|구조|컨셉|콘셉트)|새\s*레이아웃|다른\s*(목업|디자인|버전|시안|화면|캔버스|레이아웃|구조|컨셉|콘셉트)|처음부터|다시\s*(만들|생성)|완전(히)?\s*(새|다른)|another\s+(mockup|version|design|layout|concept)|new\s+(mockup|version|design|layout|concept)|fresh\s+(mockup|canvas|design|layout|concept)/i.test(
    text,
  );
}

function isReferenceSearchRequest(text: string) {
  const explicitReference =
    /(레퍼런스|참고\s*(자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?\s*(찾|검색|추천|보여|골라|추가|줘)|(?:찾|검색|추천|보여|골라|추가).{0,12}(레퍼런스|참고\s*(자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?/i.test(
      text,
    );
  if (explicitReference) return true;

  const asksForExamples =
    /(추천|찾|검색|보여|골라|알려|제안|뽑아|추려|recommend|suggest|find|show)/i.test(
      text,
    );
  const externalDesignTarget =
    /(사이트|웹\s*사이트|웹사이트|website|web\s*site|개인\s*웹|포트폴리오|portfolio|랜딩\s*페이지|landing\s*page|앱|app|서비스|service|프로덕트|product|브랜드|brand|ui|화면|screen|interface)/i.test(
      text,
    );
  const inspirationQualifier =
    /(영감|inspiration|inspo|잘\s*만들|좋은|멋진|괜찮은|유명한|사례|case|example|best|great|good|nice)/i.test(
      text,
    );

  return asksForExamples && externalDesignTarget && inspirationQualifier;
}

function cleanSearchText(text: string) {
  return text
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReferenceSearchQuery(
  baseQuery: string | null | undefined,
  missionTitle: string | undefined,
  activeOption: MissionOption | null,
  targetDevice: Device,
) {
  const optionContext = activeOption
    ? [
        cleanSearchText(activeOption.title),
        activeOption.description,
        activeOption.content?.slice(0, 240),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return [
    missionTitle,
    optionContext,
    targetDevice === "mobile" ? "mobile app UI" : "desktop website UI",
    baseQuery,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAs"); // admin: view another user's session
  const isOnboardingMission = missionId === ONBOARDING_MISSION_ID;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isGeneratingPresentation, setIsGeneratingPresentation] =
    useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEvent[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isDesignSpecOpen, setIsDesignSpecOpen] = useState(false);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<Reference[]>([]);
  const [citedTexts, setCitedTexts] = useState<string[]>([]);
  const missionPanelRef = useRef<HTMLElement>(null);
  const citeMenuRef = useRef<HTMLDivElement>(null);
  const pendingCiteTextRef = useRef<string>("");
  const sessionRefFor = useCallback(
    (uid: string) => doc(db, "sessions", uid, "missions", missionId),
    [missionId],
  );
  const [memoryContext, setMemoryContext] = useState<MemoryContext>({
    episodic: [],
    semantic: [],
  });
  const [isCompletingSession, setIsCompletingSession] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [showLobbyWarning, setShowLobbyWarning] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [missionTitle, setMissionTitle] = useState("");
  const [missionBrief, setMissionBrief] = useState("");
  const [isMissionContextReady, setIsMissionContextReady] = useState(false);
  const [parentMissionTitle, setParentMissionTitle] = useState("");
  const [parentMissionBrief, setParentMissionBrief] = useState("");
  const [missionOptions, setMissionOptions] = useState<MissionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [missionDurationMinutes, setMissionDurationMinutes] = useState<
    number | null
  >(null);
  const [activeOptionPreviewId, setActiveOptionPreviewId] = useState<
    string | null
  >(null);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerEndedAt, setTimerEndedAt] = useState<number | null>(null);
  const [timerDisplay, setTimerDisplay] = useState<string>("");
  const [activeIdeaTab, setActiveIdeaTab] = useState("idea");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [isIdeaExpanded, setIsIdeaExpanded] = useState(false);
  const [isOptionExpanded, setIsOptionExpanded] = useState(true);
  const [activePresentationId, setActivePresentationId] = useState<
    string | null
  >(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isFetchingRefs, setIsFetchingRefs] = useState(false);
  const [referenceSearchError, setReferenceSearchError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  const [stitchProjectId, setStitchProjectId] = useState<string>("");
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false);
  const [mockupOperation, setMockupOperation] = useState<
    "generate" | "edit" | null
  >(null);
  const [generatingMockupIdeaId, setGeneratingMockupIdeaId] = useState<
    string | null
  >(null);
  const [isMockupExpanded, setIsMockupExpanded] = useState(false);
  const [designContextMenu, setDesignContextMenu] = useState<{
    artboardId: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingArtboardSkeleton, setPendingArtboardSkeleton] = useState<{
    ideaId: string;
    label: string;
    x: number;
    y: number;
    device: Device;
  } | null>(null);
  const [mockupProgress, setMockupProgress] = useState<{
    percent: number;
    label: string;
  } | null>(null);

  const isReadOnly = !!(viewAs && isAdmin);

  const activeOption =
    missionOptions.find((option) => option.id === selectedOptionId) ??
    (missionOptions.length === 1 ? missionOptions[0] : null);
  const appendActivityLog = useCallback((event: Omit<ActivityLogEvent, "id" | "createdAt">) => {
    setActivityLog((prev) => [
      ...prev,
      { id: crypto.randomUUID(), createdAt: Date.now(), ...event },
    ].slice(-500));
  }, []);

  const encodeMemoryDraft = useCallback(
    async (interactionId: string, input: string, output: string, timestamp: number) => {
      if (isReadOnly || !missionId || !input.trim() || !output.trim()) return;
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return;
      try {
        const token = await getIdToken(currentUser);
        await fetch("/api/memory/drafts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            missionId,
            interactionId,
            input,
            output,
            timestamp,
          }),
        });
      } catch (error) {
        console.warn("Unable to encode memory draft", error);
      }
    },
    [isReadOnly, missionId],
  );
  const retrieveMemoryForQuery = useCallback(
    async (query: string) => {
      if (isReadOnly || !missionId || !query.trim()) return null;
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return null;
      try {
        const token = await getIdToken(currentUser);
        const res = await fetch("/api/memory/retrieve", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            missionId,
            limit: 5,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as MemoryRetrievalResponse;
        const retrieved = Array.isArray(data.retrieved) ? data.retrieved : [];
        if (retrieved.length === 0) return null;
        return retrieved;
      } catch (error) {
        console.warn("Unable to retrieve memory", error);
        return null;
      }
    },
    [isReadOnly, missionId],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const ideaSectionRef = useRef<HTMLElement>(null);
  const styleSectionRef = useRef<HTMLElement>(null);
  const mockupSectionRef = useRef<HTMLElement>(null);
  const presentationSectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasWorldRef = useRef<HTMLDivElement>(null);
  const canvasViewCommitTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const canvasOffsetRef = useRef({ x: 40, y: 40 });
  const canvasScaleRef = useRef(0.5);
  const gestureStartScaleRef = useRef(0.5);
  const artboardHeightsRef = useRef<Record<string, number>>({});
  const artboardsRef = useRef<Artboard[]>([]);
  const activeIdeaIdRef = useRef<string | null>(null);
  const selectedOptionIdRef = useRef<string | null>(null);
  const missionOptionsRef = useRef<MissionOption[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stitchAbortControllerRef = useRef<AbortController | null>(null);
  const stitchCancelRequestedRef = useRef(false);

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [artboardHeights, setArtboardHeights] = useState<
    Record<string, number>
  >({});
  const [isDragging, setIsDragging] = useState(false);
  const [expandedChips, setExpandedChips] = useState<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => {
    canvasOffsetRef.current = canvasOffset;
  }, [canvasOffset]);
  useEffect(() => {
    canvasScaleRef.current = canvasScale;
  }, [canvasScale]);
  useEffect(() => {
    artboardHeightsRef.current = artboardHeights;
  }, [artboardHeights]);
  useEffect(() => {
    artboardsRef.current = artboards;
  }, [artboards]);
  useEffect(() => {
    activeIdeaIdRef.current = activeIdeaId;
  }, [activeIdeaId]);
  useEffect(() => {
    selectedOptionIdRef.current = selectedOptionId;
  }, [selectedOptionId]);
  useEffect(() => {
    missionOptionsRef.current = missionOptions;
  }, [missionOptions]);

  useEffect(() => {
    if (!designContextMenu) return;
    const closeMenu = () => setDesignContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [designContextMenu]);

  useEffect(() => {
    const panel = missionPanelRef.current;
    if (!panel) return;

    const showCiteMenu = (x: number, y: number, text: string) => {
      const el = citeMenuRef.current;
      if (!el) return;
      pendingCiteTextRef.current = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.display = "block";
    };

    const hideCiteMenu = () => {
      const el = citeMenuRef.current;
      if (el) el.style.display = "none";
      pendingCiteTextRef.current = "";
    };

    const handleMouseUp = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-cite-menu]")) return;
      if (!panel.contains(e.target as Node)) { hideCiteMenu(); return; }
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length < 2) { hideCiteMenu(); return; }
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        showCiteMenu(rect.left + rect.width / 2, rect.top, text);
      });
    };

    const handleSelectionChange = () => {
      const text = window.getSelection()?.toString().trim();
      if (!text) hideCiteMenu();
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const applyCanvasViewDirectly = useCallback(
    (scale: number, offset: { x: number; y: number }) => {
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
    },
    [],
  );

  const commitCanvasViewSoon = useCallback(
    (scale: number, offset: { x: number; y: number }) => {
      if (canvasViewCommitTimerRef.current !== null) {
        window.clearTimeout(canvasViewCommitTimerRef.current);
      }
      canvasViewCommitTimerRef.current = window.setTimeout(() => {
        canvasViewCommitTimerRef.current = null;
        setCanvasScale(scale);
        setCanvasOffset(offset);
      }, 120);
    },
    [],
  );

  useEffect(
    () => () => {
      if (canvasViewCommitTimerRef.current !== null) {
        window.clearTimeout(canvasViewCommitTimerRef.current);
      }
    },
    [],
  );

  // Auth state
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      setUserId(user?.uid ?? null);
      setIsAdmin(isAdminEmail(user?.email));
      if (!user) return;
      getIdToken(user)
        .then((token) =>
          fetch("/api/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .then((res) => (res.ok ? res.json() : null))
        .then((profile) => {
          if (isOnboardingMission) return;
          if (profile?.onboardingCompleted === true) {
            window.localStorage.setItem(
              `vda:onboarding-completed:${user.uid}`,
              "true",
            );
            window.localStorage.removeItem(`vda:onboarding-required:${user.uid}`);
            return;
          }
          window.localStorage.removeItem(`vda:onboarding-completed:${user.uid}`);
          router.replace(`/main/${ONBOARDING_MISSION_ID}`);
        })
        .catch(() => {
          const localOnboardingCompleted =
            window.localStorage.getItem(
              `vda:onboarding-completed:${user.uid}`,
            ) === "true";
          if (!localOnboardingCompleted) {
            router.replace(`/main/${ONBOARDING_MISSION_ID}`);
          }
        });
      getIdToken(user)
        .then((token) =>
          fetch("/api/memory/bootstrap", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .then((res) => (res.ok ? res.json() : null))
        .then((memory) => {
          if (!memory) return;
          setMemoryContext({
            episodic: Array.isArray(memory.episodic) ? memory.episodic : [],
            semantic: Array.isArray(memory.semantic) ? memory.semantic : [],
          });
        })
        .catch(() => {});
    });
  }, [isOnboardingMission, router]);

  // Load session from Firestore + fallback to global mission data
  useEffect(() => {
    if (!userId || !missionId) return;

    const targetUserId = viewAs && isAdmin ? viewAs : userId;
    const sessionRef = sessionRefFor(targetUserId);
    const missionRef = doc(db, "missions", missionId);
    setIsMissionContextReady(false);

    // Register current user as participant (skip if viewing as someone else)
    if (!viewAs && !isOnboardingMission) {
      const user = firebaseAuth.currentUser;
      setDoc(
        doc(db, "missions", missionId, "participants", userId),
        {
          displayName: user?.displayName ?? null,
          email: user?.email ?? null,
          photoURL: user?.photoURL ?? null,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }

    // If viewAs, fetch participant display name
    if (viewAs && isAdmin && !isOnboardingMission) {
      getDoc(doc(db, "missions", missionId, "participants", viewAs))
        .then((snap) => {
          if (snap.exists())
            setViewAsName(
              snap.data().displayName ?? snap.data().email ?? viewAs,
            );
          else setViewAsName(viewAs);
        })
        .catch(() => setViewAsName(viewAs));
    }

    // Session: load once; Mission: real-time listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionData: Record<string, any> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyMission = (missionData: Record<string, any> | null) => {
      const session = sessionData;
      const normalizedOptions = normalizeMissionOptions(
        missionData as {
          title?: string;
          description?: string;
          options?: MissionOption[];
        } | null,
      );

      const pTitle = missionData?.title || "";
      const pBrief = missionData?.description || "";
      setParentMissionTitle(pTitle);
      setParentMissionBrief(pBrief);

      // Use ref so re-selection by user is never overwritten
      const currentOptionId =
        selectedOptionIdRef.current ??
        (session?.selectedOptionId as string | undefined);
      const selectedOption =
        normalizedOptions.find((o) => o.id === currentOptionId) ??
        (normalizedOptions.length === 1 ? normalizedOptions[0] : null);
      setMissionOptions(normalizedOptions);
      if (
        !isReadOnly &&
        !session?.selectedOptionId &&
        !selectedOptionIdRef.current &&
        normalizedOptions.length === 1
      ) {
        const option = normalizedOptions[0];
        const now = Date.now();
        selectedOptionIdRef.current = option.id;
        setSelectedOptionId(option.id);
        setTimerStartedAt(Number(session?.timerStartedAt ?? now));
        setDoc(
          sessionRef,
          {
            missionId,
            selectedOptionId: option.id,
            missionTitle: option.title,
            missionBrief: optionBrief(option),
            selectedDevice: option.device ?? missionData?.device ?? device,
            timerStartedAt: session?.timerStartedAt ?? now,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      setMissionTitle(session?.missionTitle || selectedOption?.title || pTitle);
      setMissionBrief(
        session?.missionBrief ||
          (selectedOption ? optionBrief(selectedOption) : pBrief),
      );
      const sessionDevice = session?.selectedDevice as Device | undefined;
      const optionDevice = selectedOption?.device;
      if (sessionDevice) setDevice(sessionDevice);
      else if (optionDevice) setDevice(optionDevice);
      else if (missionData?.device) setDevice(missionData.device as Device);
      if (missionData?.durationMinutes)
        setMissionDurationMinutes(Number(missionData.durationMinutes));
      setIsMissionContextReady(true);
    };

    getDoc(sessionRef).then((sessionSnap) => {
      const session = sessionSnap.exists() ? sessionSnap.data() : null;
      sessionData = session ?? null;
      setSessionCompleted(session?.status === "completed");
      setTimerEndedAt(
        session?.endedAt && session.status === "completed"
          ? Number(session.endedAt)
          : null,
      );

      if (session?.messages) setMessages(session.messages);
      // Load ideas first so we can reference their IDs
      const legacyDesignStyles = Array.isArray(session?.designSpecs)
        ? (session.designSpecs as DesignStyle[])
        : [];
      const loadedIdeas: Idea[] = (session?.ideas ?? []).map(
        (idea: Idea, index: number) => {
          const legacyIdea = idea as Idea & {
            designStyles?: DesignStyle[];
          };
          const migratedStyle =
            idea.designStyle ??
            legacyIdea.designStyles?.[0] ??
            (index === 0 ? legacyDesignStyles[0] : undefined);
          return {
            ...idea,
            designStyle: migratedStyle,
          };
        },
      );
      const firstIdeaId = loadedIdeas[0]?.id ?? "";

      if (session?.artboards && session.artboards.length > 0) {
        // Backward compat: old artboards without ideaId → assign to first idea
        const loaded: Artboard[] = session.artboards.map((a: Artboard) => ({
          ...a,
          ideaId: a.ideaId ?? firstIdeaId,
        }));
        const normalizedLoaded = normalizeArtboardPositionsByIdea(loaded);
        setArtboards(normalizedLoaded);
        const firstIdeaBoards = normalizedLoaded.filter(
          (a) => a.ideaId === firstIdeaId,
        );
        setActiveArtboardId(
          (
            firstIdeaBoards.at(-1) ??
            normalizedLoaded[normalizedLoaded.length - 1]
          )?.id ?? null,
        );
        setActiveIdeaTab("mockup");
        const pid = session.stitchProjectId;
        if (pid) {
          normalizedLoaded.forEach((a: Artboard) => {
            if (!a.stitchScreenId || a.html) return;
            fetch(
              `/api/stitch/html?projectId=${pid}&screenId=${a.stitchScreenId}`,
            )
              .then((r) => r.json())
              .then((d) => {
                if (d.html)
                  setArtboards((prev) =>
                    prev.map((p) =>
                      p.id === a.id ? { ...p, html: d.html } : p,
                    ),
                  );
              })
              .catch(() => {});
          });
        }
      } else if (session?.mockupHtml) {
        const board: Artboard = {
          id: crypto.randomUUID(),
          html: session.mockupHtml,
          label: "Design 1",
          createdAt: Date.now(),
          x: 0,
          y: 0,
          device: "desktop",
          ideaId: firstIdeaId,
        };
        setArtboards([board]);
        setActiveArtboardId(board.id);
        setActiveIdeaTab("mockup");
      }

      // Backward compat: global presentation → assign to first idea
      const ideasWithPresentation: Idea[] = loadedIdeas.map(
        (idea: Idea, idx: number) => {
          const ideaWithLegacy =
            idx === 0
              ? {
                  ...idea,
                  presentationSlides:
                    idea.presentationSlides ??
                    (session?.presentationSlides?.length
                      ? session.presentationSlides
                      : undefined),
                  presentationHtml:
                    idea.presentationHtml ??
                    session?.presentationHtml ??
                    undefined,
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
        },
      );

      if (ideasWithPresentation.length > 0) {
        setIdeas(ideasWithPresentation);
        setActiveIdeaId(ideasWithPresentation[0].id);
      }
      if (session?.references) setReferences(session.references);
      if (session?.activityLog) setActivityLog(session.activityLog);
      if (session?.stitchProjectId) setStitchProjectId(session.stitchProjectId);

      if (session?.timerStartedAt)
        setTimerStartedAt(Number(session.timerStartedAt));
      // Set selectedOptionId from session — only once at load
      if (session?.selectedOptionId) {
        setSelectedOptionId(session.selectedOptionId as string);
        selectedOptionIdRef.current = session.selectedOptionId as string;
      }
      if (isOnboardingMission) {
        fetchOnboardingMissionData()
          .then(applyMission)
          .catch(() => applyMission(null));
      }
    });

    if (isOnboardingMission) {
      return;
    }

    // Real-time mission listener — picks up admin edits immediately
    const unsubMission = onSnapshot(missionRef, (snap) => {
      applyMission(snap.exists() ? snap.data() : null);
    });

    return () => unsubMission();
  }, [userId, missionId, viewAs, isAdmin, isOnboardingMission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save session to Firestore (debounced to avoid write storms during streaming)
  useEffect(() => {
    if (isReadOnly) return;
    if (
      !userId ||
      !missionId ||
      (messages.length === 0 &&
        artboards.length === 0 &&
        references.length === 0 &&
        ideas.length === 0 &&
        activityLog.length === 0 &&
        !missionTitle &&
        !missionBrief)
    )
      return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ref = sessionRefFor(userId);
      const artboardsToSave = artboards.map((a) =>
        a.stitchScreenId ? { ...a, html: "" } : a,
      );
      // Per-idea presentation: only save Storage URLs (not base64)
      const ideasToSave = ideas.map((idea) => ({
        ...idea,
        presentations: normalizePresentations(idea).map((p) => ({
          ...p,
          slides: (p.slides ?? []).filter((s) =>
            s.imageUrl.startsWith("https://"),
          ),
          html: p.html ?? null,
        })),
        presentationSlides: (idea.presentationSlides ?? []).filter((s) =>
          s.imageUrl.startsWith("https://"),
        ),
        presentationHtml: idea.presentationHtml ?? null,
      }));
      // Strip undefined values — Firestore rejects them
      const clean = <T,>(v: T): T =>
        JSON.parse(
          JSON.stringify(v, (_, val) => (val === undefined ? null : val)),
        );
      setDoc(
        ref,
        clean({
          messages,
          missionId,
          artboards: artboardsToSave,
          references,
          activityLog: activityLog.slice(-500),
          ideas: ideasToSave,
          missionTitle,
          missionBrief,
          selectedOptionId,
          selectedDevice: device,
          stitchProjectId: stitchProjectId || null,
          startedAt: timerStartedAt ?? null,
          updatedAt: Date.now(),
        }),
        { merge: true },
      );
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    userId,
    missionId,
    sessionRefFor,
    isReadOnly,
    messages,
    artboards,
    references,
    activityLog,
    ideas,
    missionTitle,
    missionBrief,
    selectedOptionId,
    device,
    stitchProjectId,
    timerStartedAt,
  ]);

  // Countdown / count-up timer
  useEffect(() => {
    if (!timerStartedAt) {
      setTimerDisplay("");
      return;
    }
    const displayForTime = (currentTime: number) => {
      const elapsed = Math.max(0, currentTime - timerStartedAt);
      if (missionDurationMinutes && missionDurationMinutes > 0) {
        const remaining = missionDurationMinutes * 60 * 1000 - elapsed;
        if (remaining <= 0) return "시간 종료";
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    if (sessionCompleted && timerEndedAt) {
      setTimerDisplay(displayForTime(timerEndedAt));
      return;
    }
    const update = () => {
      setTimerDisplay(displayForTime(Date.now()));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timerStartedAt, timerEndedAt, sessionCompleted, missionDurationMinutes]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for element selection from iframe
  const editModeRef = useRef(false);
  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

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
        setArtboardHeights((prev) => {
          const nextHeight = Math.max(Math.ceil(height), 1);
          if (Math.abs((prev[artboardId] ?? 0) - nextHeight) < 2) return prev;
          return { ...prev, [artboardId]: nextHeight };
        });
      }
      if (e.data?.type === "vda-canvas-gesture-start") {
        gestureStartScaleRef.current = canvasScaleRef.current;
      }
      if (e.data?.type === "vda-artboard-context-menu") {
        if (isReadOnly) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const artboard = artboardsRef.current.find(
          (a) => a.id === e.data.artboardId,
        );
        if (!artboard) return;

        const rect = canvas.getBoundingClientRect();
        const scale = canvasScaleRef.current;
        const x =
          rect.left +
          canvasOffsetRef.current.x +
          (artboard.x + (e.data.clientX ?? 0)) * scale;
        const y =
          rect.top +
          canvasOffsetRef.current.y +
          (artboard.y + (e.data.clientY ?? 0)) * scale;
        setActiveArtboardId(artboard.id);
        setDesignContextMenu({ artboardId: artboard.id, x, y });
      }
      if (
        e.data?.type === "vda-canvas-wheel" ||
        e.data?.type === "vda-canvas-gesture-change"
      ) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const artboard = artboardsRef.current.find(
          (a) => a.id === e.data.artboardId,
        );
        if (!artboard) return;

        const rect = canvas.getBoundingClientRect();
        const scale = canvasScaleRef.current;
        const clientX =
          rect.left +
          canvasOffsetRef.current.x +
          (artboard.x + (e.data.clientX ?? 0)) * scale;
        const clientY =
          rect.top +
          canvasOffsetRef.current.y +
          (artboard.y + (e.data.clientY ?? 0)) * scale;
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const prevScale = canvasScaleRef.current;
        const nextScale =
          e.data.type === "vda-canvas-gesture-change"
            ? gestureStartScaleRef.current * (e.data.scale ?? 1)
            : prevScale *
              Math.exp(
                -(e.data.deltaY ?? 0) * (e.data.ctrlKey ? 0.006 : 0.0025),
              );
        const clampedScale = Math.min(
          Math.max(nextScale, MIN_CANVAS_SCALE),
          MAX_CANVAS_SCALE,
        );
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
  }, [applyCanvasViewDirectly, commitCanvasViewSoon, isReadOnly]);

  // Trackpad and mouse zoom toward cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame: number | null = null;
    let pendingScale = canvasScaleRef.current;
    let pendingOffset = canvasOffsetRef.current;

    const clampScale = (scale: number) =>
      Math.min(Math.max(scale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
    const scheduleCanvasView = (
      scale: number,
      offset: { x: number; y: number },
    ) => {
      pendingScale = scale;
      pendingOffset = offset;
      if (animationFrame !== null) return;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        applyCanvasViewDirectly(pendingScale, pendingOffset);
        commitCanvasViewSoon(pendingScale, pendingOffset);
      });
    };

    const zoomAtPoint = (
      clientX: number,
      clientY: number,
      nextScale: number,
    ) => {
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

      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
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
      zoomAtPoint(
        clientX,
        clientY,
        gestureStartScaleRef.current * (gesture.scale ?? 1),
      );
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
    canvas.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
  }, [
    artboards.length,
    activeIdeaId,
    isMockupExpanded,
    applyCanvasViewDirectly,
    commitCanvasViewSoon,
  ]);

  // Fit all artboards into canvas view
  const fitToCanvasForIdea = useCallback((ideaId: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boards = artboardsRef.current.filter((a) => a.ideaId === ideaId);
    if (boards.length === 0) return;
    const { clientWidth, clientHeight } = canvas;
    const minX = Math.min(...boards.map((a) => a.x));
    const minY = Math.min(...boards.map((a) => a.y));
    const maxX = Math.max(
      ...boards.map((a) => a.x + DEVICE_SIZE[a.device ?? "desktop"].width),
    );
    const maxY = Math.max(
      ...boards.map(
        (a) =>
          a.y +
          (artboardHeightsRef.current[a.id] ??
            DEVICE_SIZE[a.device ?? "desktop"].height),
      ),
    );
    const totalW = maxX - minX;
    const totalH = maxY - minY;
    const scale = Math.min(
      (clientWidth - 80) / totalW,
      (clientHeight - 80) / totalH,
      1,
    );
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

  const switchIdea = (ideaId: string) => {
    setActiveIdeaId(ideaId);
    setCurrentSlideIndex(0);
    setActivePresentationId(null);
    setIsIdeaExpanded(false);
    setActiveIdeaTab("idea");
    const ideaBoards = artboardsRef.current.filter((a) => a.ideaId === ideaId);
    setActiveArtboardId(ideaBoards.at(-1)?.id ?? null);
    setTimeout(() => fitToCanvasForIdea(ideaId), 0);
  };

  const deleteIdea = (ideaId: string) => {
    const target = ideas.find((i) => i.id === ideaId);
    if (!confirm("이 시안과 연결된 목업을 모두 삭제할까요?")) return;
    void encodeMemoryDraft(
      `delete-idea-${ideaId}`,
      `시안 삭제: ${target?.title ?? ideaId}`,
      `삭제된 시안 내용: ${target?.description?.slice(0, 500) ?? "(없음)"}`,
      Date.now(),
    );
    setIdeas((prev) => {
      const remaining = prev.filter((i) => i.id !== ideaId);
      const wasActive = activeIdeaId === ideaId;
      if (wasActive) {
        const next = remaining[0] ?? null;
        setActiveIdeaId(next?.id ?? null);
        if (next) setTimeout(() => fitToCanvasForIdea(next.id), 0);
      }
      return remaining;
    });
    setArtboards((prev) => prev.filter((a) => a.ideaId !== ideaId));
  };

  const updateIdea = (id: string, changes: Partial<Omit<Idea, "id">>) => {
    setIdeas((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...changes } : i)),
    );
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offsetX: canvasOffset.x,
      offsetY: canvasOffset.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    setCanvasOffset({
      x:
        dragStartRef.current.offsetX +
        (e.clientX - dragStartRef.current.mouseX),
      y:
        dragStartRef.current.offsetY +
        (e.clientY - dragStartRef.current.mouseY),
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

  const cancelMockupGeneration = useCallback(() => {
    stitchCancelRequestedRef.current = true;
    stitchAbortControllerRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !isMissionContextReady || isLoading || isGeneratingMockup)
      return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      citedElement: selectedElement
        ? {
            selector: selectedElement.selector,
            artboardId: selectedElement.artboardId,
            outerHTML: selectedElement.outerHTML,
          }
        : null,
      citedReferences:
        selectedReferences.length > 0
          ? selectedReferences.map((r) => ({
              id: r.id,
              title: r.title,
              imageUrl: r.imageUrl,
            }))
          : null,
      citedTexts: citedTexts.length > 0 ? [...citedTexts] : null,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    const manualReference = parseManualReferencePrompt(text);
    const memoryInput = formatMemoryInputWithCitations(
      text,
      selectedReferences,
      citedTexts,
      selectedElement,
    );

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSelectedReferences([]);
    setCitedTexts([]);

    if (manualReference) {
      const alreadyExists = references.some(
        (reference) => referenceMatches(reference, manualReference),
      );
      const hydratedReference = alreadyExists
        ? manualReference
        : await hydrateManualReference(manualReference);
      setReferences((prev) => {
        const exists = prev.some(
          (reference) => referenceMatches(reference, hydratedReference),
        );
        if (exists) return prev;
        return [...prev, hydratedReference];
      });
      if (!alreadyExists) {
        appendActivityLog({
          section: "reference",
          action: "add",
          input: text,
          output: hydratedReference.title,
          outputTitle: hydratedReference.title,
          link: hydratedReference.url,
          imageUrl: hydratedReference.imageUrl,
        });
      }
      const manualReferenceReply = alreadyExists
        ? `이미 레퍼런스에 있는 링크입니다: ${manualReference.url}`
        : hydratedReference.imageUrl
          ? `레퍼런스에 썸네일과 함께 추가했습니다: ${hydratedReference.url}`
          : `레퍼런스에 추가했습니다. 썸네일은 찾지 못했습니다: ${hydratedReference.url}`;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: manualReferenceReply,
              }
            : message,
        ),
      );
      void encodeMemoryDraft(
        assistantId,
        memoryInput,
        manualReferenceReply,
        userMsg.createdAt ?? Date.now(),
      );
      return;
    }

    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), 90_000);

    const currentIdeaBoards = artboards.filter(
      (a) => a.ideaId === activeIdeaId,
    );
    const activeBoard =
      currentIdeaBoards.find((a) => a.id === activeArtboardId) ??
      currentIdeaBoards.at(-1) ??
      null;
    const effectiveMissionTitle =
      parentMissionTitle && activeOption && parentMissionTitle !== activeOption.title
        ? `${parentMissionTitle} - ${activeOption.title}`
        : activeOption?.title || parentMissionTitle || missionTitle || undefined;
    const effectiveMissionBrief =
      [
        parentMissionBrief ? `[전체 미션 설명]\n${parentMissionBrief}` : "",
        activeOption
          ? `[선택된 옵션: ${activeOption.title}]\n${optionBrief(activeOption)}`
          : missionBrief,
      ]
        .filter(Boolean)
        .join("\n\n") || undefined;

    try {
      const retrievedMemory = await retrieveMemoryForQuery(
        [
          text,
          effectiveMissionTitle ? `Mission: ${effectiveMissionTitle}` : "",
          activeIdeaId
            ? `Active idea: ${ideas.find((idea) => idea.id === activeIdeaId)?.description ?? ""}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      const turnMemoryContext =
        retrievedMemory && retrievedMemory.length > 0
          ? {
              episodic: memoryContext.episodic.slice(0, 20),
              semantic: retrievedMemory,
            }
          : memoryContext;
      if (retrievedMemory && retrievedMemory.length > 0) {
        setMemoryContext((prev) => ({
          ...prev,
          semantic: retrievedMemory,
        }));
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...messages, userMsg]
            .slice(-12)
            .map(({ role, content }) => ({
              role,
              content: cleanMessageContentForModel(content),
            }))
            .filter((message) => message.content),
          mockupHtml: activeBoard?.html || undefined,
          selectedElement: selectedElement || undefined,
          citedReferences:
            selectedReferences.length > 0 ? selectedReferences : undefined,
          missionTitle: effectiveMissionTitle,
          missionBrief: effectiveMissionBrief,
          device,
          activeIdea: ideas.find((i) => i.id === activeIdeaId) ?? undefined,
          memoryContext:
            turnMemoryContext.episodic.length > 0 ||
            turnMemoryContext.semantic.length > 0
              ? turnMemoryContext
              : undefined,
          citedTexts: citedTexts.length > 0 ? citedTexts : undefined,
          designSpec: (() => {
            const idea = ideas.find((i) => i.id === activeIdeaId);
            const appliedStyle = activeDesignStyle(idea);
            return appliedStyle ? `# ${appliedStyle.title}\n${appliedStyle.content}` : undefined;
          })(),
        }),
      });

      if (!res.ok || !res.body) throw new Error("API error");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let deferredMockupCompletionText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        const normalizedText = normalizeActionBlockAliases(fullText);
        const displayText = splitPendingMockupCompletionText(normalizedText);
        deferredMockupCompletionText = displayText.completionText;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: displayText.visibleText }
              : m,
          ),
        );
      }

      fullText = normalizePresentationStatusText(fullText);
      fullText = normalizeActionBlockAliases(fullText);

      // Convert web search citation domains (domain.com) to clickable markdown links
      fullText = fullText.replace(
        /\(([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*)+(?:\/[^\s)]*)?)\)/g,
        (match, domain) =>
          /\.[a-zA-Z]{2,}/.test(domain)
            ? `([${domain}](https://${domain}))`
            : match,
      );
      const finalDisplayText = splitPendingMockupCompletionText(fullText);
      deferredMockupCompletionText = finalDisplayText.completionText;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: finalDisplayText.visibleText }
            : m,
        ),
      );
      void encodeMemoryDraft(
        assistantId,
        memoryInput,
        fullText,
        userMsg.createdAt ?? Date.now(),
      );

      // Parse special blocks from completed response
      let createdNote: Idea | null = null;
      const createNoteBlock = parseCreateNoteBlock(fullText);
      if (createNoteBlock) {
        createdNote = {
          id: crypto.randomUUID(),
          title: nextDraftTitle(ideas),
          description: createNoteBlock.description?.trim() || "",
          createdAt: Date.now(),
        };
        appendActivityLog({
          section: "note",
          action: "create",
          input: text,
          output: createdNote.description,
          outputTitle: createdNote.title,
        });
        setIdeas((prev) => [...prev, createdNote as Idea]);
        setActiveIdeaId(createdNote.id);
        setActiveArtboardId(null);
        setCurrentSlideIndex(0);
        setActivePresentationId(null);
        setIsIdeaExpanded(false);
        setActiveIdeaTab("idea");
      }

      const updateNoteBlock = parseUpdateNoteBlock(fullText);
      if (updateNoteBlock && (createdNote?.id ?? activeIdeaId)) {
        const targetNoteId = createdNote?.id ?? activeIdeaId;
        setIdeas((prev) =>
          prev.map((idea) =>
            idea.id === targetNoteId
              ? {
                  ...idea,
                  title: idea.title,
                  description:
                    updateNoteBlock.description?.trim() ?? idea.description,
                  updatedAt: Date.now(),
                }
              : idea,
          ),
        );
        appendActivityLog({
          section: "note",
          action: "update",
          input: text,
          output: updateNoteBlock.description?.trim() ?? "",
          outputTitle:
            (createdNote ?? ideas.find((idea) => idea.id === targetNoteId))
              ?.title ?? "",
        });
      }

      const designSpecBlock = parseCreateDesignSpecBlock(fullText);
      if (designSpecBlock?.content) {
        const targetIdeaId = createdNote?.id ?? activeIdeaId;
        const targetIdea =
          createdNote ?? ideas.find((idea) => idea.id === targetIdeaId);
        const newSpec: DesignStyle = {
          id: targetIdea?.designStyle?.id ?? crypto.randomUUID(),
          title: "디자인 스타일",
          content: designSpecBlock.content,
          createdAt: targetIdea?.designStyle?.createdAt ?? Date.now(),
        };
        if (targetIdeaId) {
          setIdeas((prev) =>
            prev.map((idea) =>
              idea.id === targetIdeaId
                ? {
                    ...idea,
                    designStyle: newSpec,
                  }
                : idea,
            ),
          );
        }
        setIsDesignSpecOpen(true);
      }

      const fetchRefMatch = fullText.match(
        /\[FETCH_REFERENCES(?::\s*(.*?))?\]/,
      );
      if (fetchRefMatch) {
        const customQuery = buildReferenceSearchQuery(
          fetchRefMatch[1]?.trim() || text,
          effectiveMissionTitle,
          activeOption,
          device,
        );
        fetchReferences(
          effectiveMissionTitle ?? "",
          effectiveMissionBrief ?? "",
          customQuery,
        );
      } else if (isReferenceSearchRequest(text)) {
        const fallbackReferenceQuery = buildReferenceSearchQuery(
          text,
          effectiveMissionTitle,
          activeOption,
          device,
        );
        fetchReferences(
          effectiveMissionTitle ?? "",
          effectiveMissionBrief ?? "",
          fallbackReferenceQuery || text,
        );
      }

      const generateMatch = fullText.match(/\[GENERATE_MOCKUP(?::\s*([\s\S]*?))?\]/);
      const editMatch = !generateMatch
        ? fullText.match(/\[EDIT_MOCKUP(?::\s*([\s\S]*?))?\]/)
        : null;

      if (generateMatch || editMatch) {
        const effectiveIdeas = createdNote ? [...ideas, createdNote] : ideas;
        const effectiveActiveIdeaId = createdNote?.id ?? activeIdeaId;
        const isNew = true;
        const activeIdea =
          createdNote ??
          ideas.find((i) => i.id === effectiveActiveIdeaId) ??
          null;
        const parsedPrompt = normalizeMockupActionPrompt(
          (generateMatch ?? editMatch)?.[1] ?? "",
        );
        const prompt =
          parsedPrompt ||
          (generateMatch
            ? defaultMockupPromptForIdea(activeIdea, device)
            : "Refine the current mockup according to the latest user request while preserving the existing structure.");
        const mockupIdeaId = effectiveActiveIdeaId;
        // Always use generate prompt — new artboard is always created
        const stitchPrompt = buildMockupPrompt(
          prompt,
          activeIdea,
          activeDesignStyle(activeIdea),
        );
        appendActivityLog({
          section: "mockup",
          action: "stitch_prompt",
          input: text,
          output: stitchPrompt,
          outputTitle: isNew ? "새 목업 생성 프롬프트" : "목업 수정 프롬프트",
          stitchPrompt,
        });

        if (isNew && effectiveIdeas.length === 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content +
                      "\n\n⚠️ 노트를 먼저 저장해야 목업을 생성할 수 있습니다. 노트를 정리한 후 다시 시도해 주세요.",
                  }
                : m,
            ),
          );
          return;
        }

        setIsGeneratingMockup(true);
        setMockupOperation("generate");
        setGeneratingMockupIdeaId(mockupIdeaId);
        setMockupProgress({
          percent: 8,
          label: "새 아트보드 자리 잡는 중",
        });
        {
          const ideaBoards = artboards.filter((a) => a.ideaId === (effectiveActiveIdeaId ?? ""));
          const last = ideaBoards[ideaBoards.length - 1];
          setPendingArtboardSkeleton({
            ideaId: effectiveActiveIdeaId ?? "",
            label: `Design ${ideaBoards.length + 1}`,
            x: last
              ? last.x + DEVICE_SIZE[last.device ?? "desktop"].width + ARTBOARD_GAP
              : 0,
            y: 0,
            device,
          });
        }
        try {
          const stitchController = new AbortController();
          stitchAbortControllerRef.current = stitchController;
          stitchCancelRequestedRef.current = false;
          const progressStartedAt = Date.now();
          const progressTimer = window.setInterval(() => {
            const elapsed = Date.now() - progressStartedAt;
            const estimated = Math.min(
              88,
              18 + Math.floor((elapsed / 170_000) * 70),
            );
            setMockupProgress((prev) =>
              prev
                ? {
                    percent: Math.max(prev.percent, estimated),
                    label:
                      elapsed > 70_000
                        ? "Stitch가 화면을 다듬는 중"
                        : elapsed > 30_000
                          ? "레이아웃과 비주얼 생성 중"
                          : "Stitch에 요청 전달 중",
                  }
                : prev,
            );
          }, 1000);
          const stitchTimeout = setTimeout(
            () => stitchController.abort(),
            175_000,
          );
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
                screenId: undefined,
              }),
            });
          } finally {
            window.clearInterval(progressTimer);
            clearTimeout(stitchTimeout);
          }
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(errText);
          }
          setMockupProgress({ percent: 92, label: "응답 처리 중" });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setMockupProgress({ percent: 96, label: "아트보드 배치 중" });
          if (data.projectId) setStitchProjectId(data.projectId);
          if (isNew) {
            const primaryId = crypto.randomUUID();
            // Collect extra screens Stitch created (excluding the primary one)
            const extraScreenIds: string[] = (data.allScreenIds ?? []).filter(
              (sid: string) => sid !== data.screenId,
            );

            setArtboards((prev) => {
              const existingScreenIds = new Set(
                prev.map((a) => a.stitchScreenId).filter(Boolean),
              );
              const newExtra = extraScreenIds.filter(
                (sid: string) => !existingScreenIds.has(sid),
              );
              const ideaId = effectiveActiveIdeaId ?? "";
              const ideaBoards = prev.filter((a) => a.ideaId === ideaId);
              const last = ideaBoards[ideaBoards.length - 1];
              let offsetX = last
                ? last.x +
                  DEVICE_SIZE[last.device ?? "desktop"].width +
                  ARTBOARD_GAP
                : 0;
              const primaryBoard: Artboard = {
                id: primaryId,
                html: data.html,
                label: `Design ${ideaBoards.length + 1}`,
                createdAt: Date.now(),
                x: offsetX,
                y: 0,
                device,
                stitchScreenId: data.screenId,
                ideaId,
              };
              offsetX += DEVICE_SIZE[device].width + ARTBOARD_GAP;

              const extraBoards: Artboard[] = newExtra.map(
                (sid: string, i: number) => ({
                  id: crypto.randomUUID(),
                  html: "",
                  label: `Design ${ideaBoards.length + 2 + i}`,
                  createdAt: Date.now(),
                  x: offsetX + i * (DEVICE_SIZE[device].width + ARTBOARD_GAP),
                  y: 0,
                  device,
                  stitchScreenId: sid,
                  ideaId,
                }),
              );

              return [...prev, primaryBoard, ...extraBoards];
            });
            setActiveArtboardId(primaryId);
            setTimeout(() => fitToCanvasForIdea(effectiveActiveIdeaId ?? ""), 0);

            const screensNeedingHtml = [
              ...(data.htmlPending ? [data.screenId] : []),
              ...extraScreenIds,
            ];
            // Lazy-load HTML for pending or extra screens
            screensNeedingHtml.forEach((sid: string) => {
              setMockupProgress({
                percent: 98,
                label: sid === data.screenId ? "화면 HTML 준비 대기 중" : "추가 화면 불러오는 중",
              });
              fetch(
                `/api/stitch/html?projectId=${data.projectId}&screenId=${sid}`,
              )
                .then((r) => r.json())
                .then((d) => {
                  if (d.html)
                    setArtboards((prev) =>
                      prev.map((a) =>
                        a.stitchScreenId === sid ? { ...a, html: d.html, htmlUpdatedAt: Date.now() } : a,
                      ),
                    );
                })
                .catch(() => {});
            });
          } else {
            const targetId = activeArtboardId ?? currentIdeaBoards.at(-1)?.id;
            setArtboards((prev) =>
              prev.map((a) =>
                a.id === targetId
                  ? { ...a, html: data.html, stitchScreenId: data.screenId, htmlUpdatedAt: Date.now() }
                  : a,
              ),
            );
            if (data.htmlPending && targetId) {
              fetch(
                `/api/stitch/html?projectId=${data.projectId}&screenId=${data.screenId}`,
              )
                .then((r) => r.json())
                .then((d) => {
                  if (d.html) {
                    setArtboards((prev) =>
                      prev.map((a) =>
                        a.id === targetId ? { ...a, html: d.html } : a,
                      ),
                    );
                  }
                })
                .catch(() => {});
            }
          }
          setMockupProgress({ percent: 100, label: "완료" });
          setActiveIdeaTab("mockup");
          setSelectedElement(null);
          if (deferredMockupCompletionText) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `${m.content}\n\n${deferredMockupCompletionText}`,
                    }
                  : m,
              ),
            );
          }
        } catch (err) {
          const wasCanceled = stitchCancelRequestedRef.current;
          const errMsg =
            err instanceof Error ? err.message : "Stitch 생성 실패";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content +
                      (wasCanceled
                        ? "\n\n목업 작업을 취소했습니다."
                        : `\n\n⚠️ 목업 생성 실패: ${errMsg}`),
                  }
                : m,
            ),
          );
        } finally {
          stitchAbortControllerRef.current = null;
          stitchCancelRequestedRef.current = false;
          setIsGeneratingMockup(false);
          setMockupOperation(null);
          setGeneratingMockupIdeaId(null);
          setPendingArtboardSkeleton(null);
          setMockupProgress(null);
        }
      }

      const presentationBlock = parsePresentationBlock(fullText);
      console.log(
        "[presentation] block:",
        presentationBlock
          ? presentationBlock.isJson
            ? "json"
            : "html"
          : "none",
      );
      if (presentationBlock) {
        if (currentIdeaBoards.length === 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content +
                      "\n\n⚠️ 목업이 먼저 만들어져야 프레젠테이션을 생성할 수 있습니다.",
                  }
                : m,
            ),
          );
        } else if (presentationBlock.isJson) {
          console.log(
            "[presentation] slides:",
            presentationBlock.data.slides?.length,
          );
          setIsGeneratingPresentation(true);
          try {
            const uid = firebaseAuth.currentUser?.uid ?? "anonymous";
            const presentationMockupHtml =
              activeBoard?.html || currentIdeaBoards.at(-1)?.html || "";
            const presentationMockupDevice =
              activeBoard?.device || currentIdeaBoards.at(-1)?.device || device;
            const mockupScreenshot = presentationMockupHtml
              ? await captureMockupScreenshot(
                  presentationMockupHtml,
                  presentationMockupDevice,
                )
              : null;
            const presRes = await fetch("/api/presentation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: presentationBlock.data.title,
                slides: presentationBlock.data.slides,
                uid,
                missionId: missionId,
                device: presentationMockupDevice,
                mockupHtml: presentationMockupHtml || undefined,
                mockupScreenshot: mockupScreenshot?.dataUrl || undefined,
                mockupScreenshotWidth: mockupScreenshot?.width,
                mockupScreenshotHeight: mockupScreenshot?.height,
                mockupSections: mockupScreenshot?.sections,
              }),
            });
            const presData = await presRes.json();
            console.log(
              "[presentation] api response:",
              presData.error ?? `${presData.slides?.length} slides`,
            );
            if (presData.error) throw new Error(presData.error);
            if (presData.slides) {
              const uploadedSlides: PresentationSlide[] = await Promise.all(
                (presData.slides as PresentationSlide[]).map(
                  async (slide, i) => {
                    if (!slide.imageUrl.startsWith("data:")) return slide;
                    try {
                      const imgRef = storageRef(
                        storage,
                        `presentations/${uid}/${missionId}/slide-${i}.png`,
                      );
                      await uploadString(imgRef, slide.imageUrl, "data_url");
                      const url = await getDownloadURL(imgRef);
                      console.log(`[presentation] slide ${i} uploaded`);
                      return { ...slide, imageUrl: url };
                    } catch {
                      console.info(
                        `[presentation] slide ${i} storage upload skipped; showing generated base64 image for this session.`,
                      );
                      return slide;
                    }
                  },
                ),
              );
              if (activeIdeaId) {
                const newPresentation: Presentation = {
                  id: crypto.randomUUID(),
                  title:
                    presentationBlock.data.title ||
                    uploadedSlides[0]?.title ||
                    "Presentation",
                  createdAt: Date.now(),
                  slides: uploadedSlides,
                };
                const nextIdeas = ideas.map((idea) =>
                  idea.id === activeIdeaId
                    ? {
                        ...idea,
                        presentations: [
                          ...normalizePresentations(idea),
                          newPresentation,
                        ],
                        presentationSlides: uploadedSlides,
                      }
                    : idea,
                );
                setIdeas(nextIdeas);

                const persistentSlides = uploadedSlides.filter((s) =>
                  s.imageUrl.startsWith("https://"),
                );
                if (persistentSlides.length !== uploadedSlides.length) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content:
                              m.content +
                              "\n\n⚠️ 프레젠테이션 이미지를 임시로 표시했지만 Firebase Storage 저장에 실패했습니다. 새로고침하면 사라질 수 있습니다.",
                          }
                        : m,
                    ),
                  );
                } else if (!isReadOnly && userId) {
                  const ref = sessionRefFor(userId);
                  const artboardsToSave = artboards.map((a) =>
                    a.stitchScreenId ? { ...a, html: "" } : a,
                  );
                  const ideasToSave = nextIdeas.map((idea) => ({
                    ...idea,
                    presentations: normalizePresentations(idea).map((p) => ({
                      ...p,
                      slides: (p.slides ?? []).filter((s) =>
                        s.imageUrl.startsWith("https://"),
                      ),
                      html: p.html ?? null,
                    })),
                    presentationSlides: (idea.presentationSlides ?? []).filter(
                      (s) => s.imageUrl.startsWith("https://"),
                    ),
                    presentationHtml: idea.presentationHtml ?? null,
                  }));
                  const clean = <T,>(v: T): T =>
                    JSON.parse(
                      JSON.stringify(v, (_, val) =>
                        val === undefined ? null : val,
                      ),
                    );
                  await setDoc(
                    ref,
                    clean({
                      messages,
                      missionId,
                      artboards: artboardsToSave,
                      references,
                      ideas: ideasToSave,
                      missionTitle,
                      missionBrief,
                      stitchProjectId: stitchProjectId || null,
                      updatedAt: Date.now(),
                    }),
                    { merge: true },
                  );
                }
                setActivePresentationId(newPresentation.id);
              }
              setCurrentSlideIndex(0);
              setActiveIdeaTab("presentation");
            }
          } catch (presErr) {
            const msg =
              presErr instanceof Error ? presErr.message : String(presErr);
            console.error("[presentation] error:", msg);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content + `\n\n⚠️ 프레젠테이션 이미지 생성 실패: ${msg}`,
                    }
                  : m,
              ),
            );
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
            const activeIdea = ideas.find((idea) => idea.id === activeIdeaId);
            updateIdea(activeIdeaId, {
              presentations: activeIdea
                ? [...normalizePresentations(activeIdea), newPresentation]
                : [newPresentation],
              presentationHtml: presentationBlock.html,
            });
            setActivePresentationId(newPresentation.id);
          }
          setActiveIdeaTab("presentation");
        }
      }
    } catch (err) {
      const isTimeout =
        (err as Error)?.message === "timeout" ||
        (err instanceof DOMException && err.name === "AbortError");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: isTimeout
                  ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
                  : "오류가 발생했습니다. 다시 시도해주세요.",
              }
            : m,
        ),
      );
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [
    inputText,
    isLoading,
    isMissionContextReady,
    isGeneratingMockup,
    messages,
    artboards,
    activeArtboardId,
    activeIdeaId,
    selectedElement,
    selectedReferences,
    citedTexts,
    ideas,
    references,
    device,
    stitchProjectId,
    missionTitle,
    missionBrief,
    userId,
    memoryContext,
    isReadOnly,
    isOnboardingMission,
    missionId,
    fitToCanvasForIdea,
    activeOption,
    parentMissionTitle,
    parentMissionBrief,
    appendActivityLog,
    encodeMemoryDraft,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearSelectedElement = () => setSelectedElement(null);

  const fetchReferences = useCallback(
    async (title: string, brief: string, customQuery?: string | null) => {
      if (isFetchingRefs || isReadOnly) return;
      setIsFetchingRefs(true);
      setReferenceSearchError("");
      try {
        const loggedReferenceLinks = activityLog
          .filter((event) => event.section === "reference" && event.link)
          .map((event) => ({
            url: event.link,
            imageUrl: event.imageUrl,
          }));
        const res = await fetch("/api/references", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            missionTitle: title,
            missionBrief: brief,
            customQuery,
            existingReferences: [...references, ...loggedReferenceLinks],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? "레퍼런스 검색에 실패했습니다.");
        }
        if (data.references?.length > 0) {
          const newRefs = (data.references as Reference[]).filter(
            (candidate) =>
              !references.some((reference) =>
                referenceMatches(reference, candidate),
              ) &&
              !loggedReferenceLinks.some((reference) =>
                referenceMatches(reference as Reference, candidate),
              ),
          );
          newRefs.forEach((reference: Reference) => {
            appendActivityLog({
              section: "reference",
              action: "add",
              input: customQuery ?? title ?? brief,
              output: reference.description,
              outputTitle: reference.title,
              link: reference.url,
              imageUrl: reference.imageUrl,
            });
          });
          if (newRefs.length === 0) {
            setReferenceSearchError(
              "새로 추가할 레퍼런스를 찾지 못했습니다. 이미 추가했거나 삭제한 사이트는 제외됩니다.",
            );
          } else {
            setReferences((prev) => [...prev, ...newRefs]);
          }
        } else {
          setReferenceSearchError(
            "조건에 맞는 레퍼런스를 찾지 못했습니다. 검색어를 조금 더 구체적으로 바꿔보세요.",
          );
        }
      } catch (error) {
        console.error("[references] fetch failed", error);
        setReferenceSearchError("레퍼런스 검색에 실패했습니다.");
      } finally {
        setIsFetchingRefs(false);
      }
    },
    [activityLog, isFetchingRefs, isReadOnly, references, appendActivityLog],
  );

  const ideaArtboards = artboards.filter((a) => a.ideaId === activeIdeaId);
  const activeArtboard =
    ideaArtboards.find((a) => a.id === activeArtboardId) ??
    ideaArtboards[ideaArtboards.length - 1] ??
    null;
  const deleteDesign = (artboardId: string) => {
    if (isReadOnly) return;
    const target = artboards.find((artboard) => artboard.id === artboardId);
    if (!target) return;
    if (!confirm("이 디자인을 삭제할까요?")) return;
    const ownerIdea = ideas.find((i) => i.id === target.ideaId);
    void encodeMemoryDraft(
      `delete-design-${artboardId}`,
      `목업 삭제: ${ownerIdea?.title ?? target.ideaId} 시안의 디자인`,
      `삭제된 artboardId: ${artboardId}`,
      Date.now(),
    );
    setDesignContextMenu(null);

    setArtboards((prev) => {
      const next = prev.filter((artboard) => artboard.id !== artboardId);
      if (activeArtboardId === artboardId) {
        const nextActive =
          next.filter((artboard) => artboard.ideaId === target.ideaId).at(-1) ??
          null;
        setActiveArtboardId(nextActive?.id ?? null);
      }
      return next;
    });
    setArtboardHeights((prev) => {
      const next = { ...prev };
      delete next[artboardId];
      return next;
    });
    setSelectedElement((prev) =>
      prev?.artboardId === artboardId ? null : prev,
    );
  };
  const chooseMissionOption = async (option: MissionOption) => {
    const now = Date.now();
    const nextDevice = option.device ?? device;
    setSelectedOptionId(option.id);
    setDevice(nextDevice);
    setTimerEndedAt(null);

    setMissionTitle(option.title);
    setMissionBrief(optionBrief(option));
    setTimerStartedAt(now);
    if (!isReadOnly && userId) {
      const ref = sessionRefFor(userId);
      await setDoc(
        ref,
        {
          missionId,
          selectedOptionId: option.id,
          missionTitle: option.title,
          missionBrief: optionBrief(option),
          selectedDevice: nextDevice,
          timerStartedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    }
  };
  const isGeneratingCurrentIdeaMockup =
    isGeneratingMockup && generatingMockupIdeaId === activeIdeaId;
  const completeSession = async () => {
    if (isReadOnly || isCompletingSession || sessionCompleted || !missionId) return;
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    setIsCompletingSession(true);
    try {
      const token = await getIdToken(currentUser, true);
      const res = await fetch("/api/memory/complete-session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ missionId }),
      });
      if (!res.ok) throw new Error(`Session completion failed: ${res.status}`);
      const completionData = await res.json().catch(() => null);
      const completedAt = Number(completionData?.completedAt ?? Date.now());
      if (isOnboardingMission) {
        await fetch("/api/users/me", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        if (userId) {
          window.localStorage.removeItem(`vda:onboarding-required:${userId}`);
          window.localStorage.setItem(`vda:onboarding-completed:${userId}`, "true");
        }
      }
      const memoryRes = await fetch("/api/memory/bootstrap", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (memoryRes.ok) {
        const memory = await memoryRes.json();
        setMemoryContext({
          episodic: Array.isArray(memory.episodic) ? memory.episodic : [],
          semantic: Array.isArray(memory.semantic) ? memory.semantic : [],
        });
      }
      setTimerEndedAt(completedAt);
      setSessionCompleted(true);
    } catch (error) {
      console.warn("Unable to complete session", error);
      alert("세션 종료 및 메모리 확정에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsCompletingSession(false);
    }
  };
  const exportMessageLogCsv = () => {
    const exportedAt = new Date().toISOString();
    const selectedOption = missionOptions.find(
      (option) => option.id === selectedOptionId,
    );
    const sessionMeta = {
      missionId,
      missionTitle:
        parentMissionTitle || missionTitle || selectedOption?.title || "",
      missionOptionId: selectedOptionId ?? "",
      missionOptionTitle: selectedOption?.title ?? "",
      viewedUserId: viewAs ?? userId ?? "",
      viewedUserName: viewAsName ?? "",
      device,
      stitchProjectId,
      timerStartedAt: timerStartedAt
        ? new Date(timerStartedAt).toISOString()
        : "",
      timerElapsedSeconds: timerStartedAt
        ? String(Math.max(0, Math.floor((Date.now() - timerStartedAt) / 1000)))
        : "",
      exportedAt,
    };
    const outputRows = [
      ...ideas.map((idea) => ({
        eventType: "note",
        section: "note",
        action: "snapshot",
        role: "",
        input: "",
        output: [idea.title, idea.description].filter(Boolean).join("\n\n"),
        outputType: "note",
        outputTitle: idea.title,
        link: "",
        referenceLinks: "",
        content: idea.description,
        html: "",
        imageUrl: "",
        createdAt: idea.createdAt
          ? new Date(idea.createdAt).toISOString()
          : "",
        stitchScreenId: "",
        stitchPrompt: "",
      })),
      ...references.map((reference) => ({
        eventType: "reference",
        section: "reference",
        action: "snapshot",
        role: "",
        input: "",
        output: [reference.title, reference.description, reference.url]
          .filter(Boolean)
          .join("\n"),
        outputType: "reference",
        outputTitle: reference.title,
        link: reference.url ?? "",
        referenceLinks: reference.url ?? "",
        content: reference.description,
        html: "",
        imageUrl: reference.imageUrl ?? "",
        createdAt: "",
        stitchScreenId: "",
        stitchPrompt: "",
      })),
      ...artboards.map((artboard) => ({
        eventType: "mockup",
        section: "mockup",
        action: "snapshot",
        role: "",
        input: "",
        output: artboard.html || artboard.label,
        outputType: "mockup",
        outputTitle: artboard.label,
        link: "",
        referenceLinks: "",
        content: artboard.label,
        html: artboard.html,
        imageUrl: "",
        createdAt: artboard.createdAt
          ? new Date(artboard.createdAt).toISOString()
          : "",
        stitchScreenId: artboard.stitchScreenId ?? "",
        stitchPrompt: "",
      })),
      ...ideas.flatMap((idea) =>
        normalizePresentations(idea).map((presentation) => ({
          eventType: "presentation",
          section: "presentation",
          action: "snapshot",
          role: "",
          input: "",
          output:
            presentation.html ||
            presentation.slides
              .map((slide) => `${slide.title}\n${slide.content}`)
              .join("\n\n"),
          outputType: "presentation",
          outputTitle: presentation.title,
          link: presentation.slides[0]?.imageUrl ?? "",
          referenceLinks: "",
          content: presentation.title,
          html: presentation.html ?? "",
          imageUrl: presentation.slides[0]?.imageUrl ?? "",
          createdAt: presentation.createdAt
            ? new Date(presentation.createdAt).toISOString()
            : "",
          stitchScreenId: "",
          stitchPrompt: "",
        })),
      ),
    ];
    const eventRows = [
      ...activityLog.map((event) => ({
        eventType: `${event.section}:${event.action}`,
        section: event.section,
        action: event.action,
        role: "",
        input: event.input ?? "",
        output: event.output ?? "",
        outputType: event.section,
        outputTitle: event.outputTitle ?? "",
        link: event.link ?? "",
        referenceLinks: event.section === "reference" ? event.link ?? "" : "",
        content: event.output ?? "",
        html: event.html ?? "",
        imageUrl: event.imageUrl ?? "",
        createdAt: new Date(event.createdAt).toISOString(),
        stitchScreenId: "",
        stitchPrompt: event.stitchPrompt ?? "",
        messageIndex: "",
        citedElement: "",
        citedReferences: "",
      })),
      ...messages.map((message, index) => ({
        eventType: "message",
        section: "chat",
        action: message.role,
        role: message.role,
        input: message.role === "user" ? message.content : "",
        output: message.role === "assistant" ? message.content : "",
        outputType: message.role === "assistant" ? "message" : "",
        outputTitle: "",
        link: "",
        referenceLinks: (message.citedReferences ?? [])
          .map((reference) => reference.imageUrl)
          .filter(Boolean)
          .join("; "),
        content: message.content,
        html: "",
        imageUrl: "",
        createdAt: message.createdAt
          ? new Date(message.createdAt).toISOString()
          : "",
        stitchScreenId: "",
        stitchPrompt: "",
        messageIndex: String(index + 1),
        citedElement: message.citedElement
          ? `${message.citedElement.artboardId}:${message.citedElement.selector}`
          : "",
        citedElementHtml: message.citedElement?.outerHTML ?? "",
        citedReferences: (message.citedReferences ?? [])
          .map((reference) =>
            [reference.title, reference.imageUrl].filter(Boolean).join(" - "),
          )
          .join("; "),
      })),
      ...outputRows.map((row) => ({
        ...row,
        messageIndex: "",
        citedElement: "",
        citedReferences: "",
      })),
    ];
    const csvRows = [
      [
        "event_index",
        "event_type",
        "section",
        "action",
        "role",
        "message_index",
        "input",
        "output",
        "output_type",
        "output_title",
        "link",
        "reference_links",
        "content",
        "html",
        "image_url",
        "created_at",
        "cited_element",
        "cited_references",
        "mission_id",
        "mission_title",
        "mission_option_id",
        "mission_option_title",
        "viewed_user_id",
        "viewed_user_name",
        "device",
        "stitch_project_id",
        "stitch_screen_id",
        "stitch_prompt",
        "timer_started_at",
        "timer_elapsed_seconds",
        "exported_at",
      ],
      ...eventRows.map((row, index) => [
        String(index + 1),
        row.eventType,
        row.section,
        row.action,
        row.role,
        row.messageIndex,
        row.input,
        row.output,
        row.outputType,
        row.outputTitle,
        row.link,
        row.referenceLinks,
        row.content,
        row.html,
        row.imageUrl,
        row.createdAt,
        row.citedElement,
        row.citedReferences,
        sessionMeta.missionId,
        sessionMeta.missionTitle,
        sessionMeta.missionOptionId,
        sessionMeta.missionOptionTitle,
        sessionMeta.viewedUserId,
        sessionMeta.viewedUserName,
        sessionMeta.device,
        sessionMeta.stitchProjectId,
        row.stitchScreenId,
        row.stitchPrompt,
        sessionMeta.timerStartedAt,
        sessionMeta.timerElapsedSeconds,
        sessionMeta.exportedAt,
      ]),
    ];
    const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const sessionName = safeFilenamePart(viewAsName ?? viewAs ?? userId ?? "user");
    const missionName = safeFilenamePart(missionId ?? "mission");
    link.href = url;
    link.download = `${missionName}-${sessionName}-log.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const gridSize = 20 * canvasScale;
  const getArtboardRenderHeight = (artboard: Artboard) =>
    Math.max(
      DEVICE_SIZE[artboard.device ?? "desktop"].height,
      artboardHeights[artboard.id] ?? 0,
    );
  const renderMockupCanvas = (expanded = false) => (
    <div
      ref={canvasRef}
      className={`relative w-full overflow-hidden select-none ${expanded ? "flex-1" : "h-150 rounded-2xl"}`}
      style={{
        backgroundColor: "#1a1a1a",
        backgroundImage:
          "radial-gradient(circle, #383838 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        setActiveArtboardId(null);
        setSelectedElement(null);
        setDesignContextMenu(null);
      }}
    >
      <style>{`
        @keyframes vda-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      {isGeneratingCurrentIdeaMockup && (
        <div
          className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/75 px-4 py-2 text-white shadow-lg backdrop-blur"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <p className="text-xs font-medium text-white/85">
            Stitch로 목업 {mockupOperation === "edit" ? "수정" : "생성"} 중...
          </p>
          {mockupProgress && (
            <p className="text-xs font-semibold text-white/75">
              {mockupProgress.percent}% · {mockupProgress.label}
            </p>
          )}
          {!isReadOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                cancelMockupGeneration();
              }}
              className="pointer-events-auto rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              취소
            </button>
          )}
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
        {ideaArtboards.map((artboard) => {
          const isActive = artboard.id === activeArtboardId;
          const artboardHeight = getArtboardRenderHeight(artboard);
          const artboardHtml = injectHeightReporter(
            injectNoNavigation(
              editMode
                ? injectSelectionScript(artboard.html, artboard.id)
                : artboard.html,
            ),
            artboard.id,
          );
          return (
            <div key={artboard.id}>
              <div
                style={{
                  position: "absolute",
                  left: artboard.x,
                  top: artboard.y - 22,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: isActive ? "#a5b4fc" : "#888",
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                  userSelect: "none",
                }}
              >
                <span>{artboard.label}</span>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: artboard.x,
                  top: artboard.y,
                  width: DEVICE_SIZE[artboard.device ?? "desktop"].width,
                  height: artboardHeight,
                  borderRadius: artboard.device === "mobile" ? 24 : 12,
                  overflow: "hidden",
                  outline: isActive
                    ? "2px solid #6366f1"
                    : "2px solid transparent",
                  outlineOffset: 3,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                }}
                onClick={() => setActiveArtboardId(artboard.id)}
                onContextMenu={(e) => {
                  if (isReadOnly) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveArtboardId(artboard.id);
                  setDesignContextMenu({
                    artboardId: artboard.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <iframe
                  key={`${artboard.id}-${artboard.htmlUpdatedAt ?? artboard.createdAt ?? 0}`}
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
        {pendingArtboardSkeleton?.ideaId === activeIdeaId && (
          <div>
            <div
              style={{
                position: "absolute",
                left: pendingArtboardSkeleton.x,
                top: pendingArtboardSkeleton.y - 22,
                color: "#94a3b8",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {pendingArtboardSkeleton.label}
            </div>
            <div
              style={{
                position: "absolute",
                left: pendingArtboardSkeleton.x,
                top: pendingArtboardSkeleton.y,
                width: DEVICE_SIZE[pendingArtboardSkeleton.device].width,
                height: DEVICE_SIZE[pendingArtboardSkeleton.device].height,
                borderRadius:
                  pendingArtboardSkeleton.device === "mobile" ? 24 : 12,
                overflow: "hidden",
                outline: "2px dashed rgba(148, 163, 184, 0.55)",
                outlineOffset: 3,
                boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
                background:
                  "linear-gradient(110deg, #27272a 8%, #3f3f46 18%, #27272a 33%)",
                backgroundSize: "200% 100%",
                animation: "vda-skeleton-shimmer 1.25s linear infinite",
              }}
            >
              <div
                style={{
                  display: "flex",
                  height: "100%",
                  flexDirection: "column",
                  gap: 24,
                  padding: pendingArtboardSkeleton.device === "mobile" ? 24 : 40,
                }}
              >
                <div
                  style={{
                    height: 18,
                    width: "32%",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.18)",
                  }}
                />
                <div
                  style={{
                    height:
                      pendingArtboardSkeleton.device === "mobile" ? 180 : 260,
                    borderRadius:
                      pendingArtboardSkeleton.device === "mobile" ? 20 : 24,
                    background: "rgba(255,255,255,0.14)",
                  }}
                />
                <div style={{ display: "grid", gap: 14 }}>
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      style={{
                        height: row === 0 ? 28 : 14,
                        width: row === 2 ? "56%" : row === 1 ? "82%" : "68%",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.16)",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    marginTop: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      height: 14,
                      width: 14,
                      borderRadius: 999,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "rgba(255,255,255,0.85)",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                  새 아트보드 생성 중...
                </div>
                {mockupProgress && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        height: 6,
                        overflow: "hidden",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.14)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${mockupProgress.percent}%`,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.74)",
                          transition: "width 0.35s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.58)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {mockupProgress.percent}% · {mockupProgress.label}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const contextMenuArtboard = designContextMenu
    ? artboards.find((artboard) => artboard.id === designContextMenu.artboardId)
    : null;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      <div
        ref={citeMenuRef}
        data-cite-menu="1"
        className="fixed z-50 -translate-x-1/2 -translate-y-full"
        style={{ display: "none" }}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            const text = pendingCiteTextRef.current;
            if (text) setCitedTexts((prev) => [...prev, text]);
            if (citeMenuRef.current) citeMenuRef.current.style.display = "none";
            pendingCiteTextRef.current = "";
            window.getSelection()?.removeAllRanges();
          }}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-slate-700"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 3h10M1 6h6M1 9h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          인용하기
        </button>
        <div className="mx-auto mt-1 h-1.5 w-1.5 rotate-45 bg-slate-900" />
      </div>

      {designContextMenu && contextMenuArtboard && !isReadOnly && (
        <div
          className="fixed z-50 min-w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl"
          style={{ left: designContextMenu.x, top: designContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => deleteDesign(contextMenuArtboard.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-500 transition hover:bg-red-50"
          >
            <XIcon size={14} />
            디자인 삭제
          </button>
        </div>
      )}
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          <span className="flex items-center gap-1">
            <EyeIcon size={14} /> 읽기 전용 —
            <strong>{viewAsName ?? viewAs}</strong>의 세션을 보고 있습니다
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportMessageLogCsv}
              disabled={messages.length === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/70 px-3 py-1 font-semibold text-amber-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              title="로그 CSV 내보내기"
            >
              <DownloadSimpleIcon size={14} />
              로그 CSV
            </button>
            <Link
              href={`/admin`}
              className="font-semibold underline underline-offset-2"
            >
              어드민으로 돌아가기
            </Link>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (!isReadOnly && selectedOptionId && !sessionCompleted) {
                setShowLobbyWarning(true);
              } else {
                router.push("/lobby");
              }
            }}
            className="flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            <ArrowLeftIcon size={14} />
            로비로 돌아가기
          </button>
          <h1 className="text-xl font-semibold">
            {parentMissionTitle &&
            activeOption &&
            parentMissionTitle !== activeOption.title
              ? `${parentMissionTitle} - ${activeOption.title}`
              : activeOption?.title ||
                parentMissionTitle ||
                missionTitle ||
                "미션 제목 없음"}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {timerDisplay && (
            <span
              className={`font-mono text-lg font-semibold tabular-nums ${timerDisplay === "시간 종료" ? "text-red-500" : missionDurationMinutes && timerStartedAt && missionDurationMinutes * 60 * 1000 - (Date.now() - timerStartedAt) < 60000 ? "text-red-500" : "text-slate-900"}`}
            >
              {missionDurationMinutes
                ? `⏱ ${timerDisplay}`
                : `${timerDisplay} 경과`}
            </span>
          )}
          {!isReadOnly && selectedOptionId && (
            <button
              type="button"
              onClick={completeSession}
              disabled={isCompletingSession || sessionCompleted}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500"
            >
              {sessionCompleted
                ? "세션 종료됨"
                : isCompletingSession
                  ? "메모리 확정 중..."
                  : "세션 종료"}
            </button>
          )}
        </div>
      </header>

      {missionOptions.length > 1 && !selectedOptionId ? (
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-8 py-8 space-y-6">
              {/* Mission info */}
              {(parentMissionTitle || parentMissionBrief) && (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      미션
                    </p>
                    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                      {isOnboardingMission ? (
                        <>
                          <MonitorIcon size={11} className="inline" /> PC ·{" "}
                          <DeviceMobileIcon size={11} className="inline" />{" "}
                          모바일 선택
                        </>
                      ) : device === "mobile" ? (
                        <>
                          <DeviceMobileIcon size={11} className="inline" />{" "}
                          모바일
                        </>
                      ) : (
                        <>
                          <MonitorIcon size={11} className="inline" /> PC
                        </>
                      )}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                      {missionDurationMinutes
                        ? `제한 시간 ${missionDurationMinutes}분`
                        : "시간 제한 없음"}
                    </span>
                  </div>
                  {parentMissionTitle && (
                    <h2 className="mt-2 text-lg font-semibold text-slate-900">
                      {parentMissionTitle}
                    </h2>
                  )}
                  {parentMissionBrief && (
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">
                      {parentMissionBrief}
                    </p>
                  )}
                </div>
              )}

              {/* Option tabs */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {missionOptions.map((o, i) => {
                  const isActive =
                    activeOptionPreviewId === o.id ||
                    (!activeOptionPreviewId && i === 0);
                  return (
                    <button
                      key={o.id}
                      onClick={() => setActiveOptionPreviewId(o.id)}
                      className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition ${isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {o.device === "mobile" ? (
                          <DeviceMobileIcon size={13} />
                        ) : o.device === "desktop" ? (
                          <MonitorIcon size={13} />
                        ) : null}
                        {o.title}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Option detail */}
              {(() => {
                const option =
                  missionOptions.find((o) => o.id === activeOptionPreviewId) ??
                  missionOptions[0];
                if (!option) return null;
                return (
                  <div className="space-y-6">
                    {option.description && (
                      <p className="text-base leading-relaxed text-slate-500">
                        {option.description}
                      </p>
                    )}

                    {/* Content — markdown */}
                    {option.content && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          콘텐츠
                        </p>
                        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 text-sm text-slate-700 space-y-2">
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => (
                                <h1 className="text-xl font-bold text-slate-900 mb-2 mt-4 first:mt-0">
                                  {children}
                                </h1>
                              ),
                              h2: ({ children }) => (
                                <h2 className="text-base font-semibold text-slate-900 mb-2 mt-4 first:mt-0">
                                  {children}
                                </h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className="text-sm font-semibold text-slate-800 mb-1 mt-3">
                                  {children}
                                </h3>
                              ),
                              p: ({ children }) => (
                                <p className="leading-relaxed mb-2 last:mb-0">
                                  {children}
                                </p>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc ml-5 space-y-1 mb-2">
                                  {children}
                                </ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal ml-5 space-y-1 mb-2">
                                  {children}
                                </ol>
                              ),
                              li: ({ children }) => (
                                <li className="leading-relaxed">{children}</li>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-slate-900">
                                  {children}
                                </strong>
                              ),
                              em: ({ children }) => (
                                <em className="italic text-slate-600">
                                  {children}
                                </em>
                              ),
                              code: ({ children }) => (
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                                  {children}
                                </code>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-slate-300 pl-4 italic text-slate-500 my-2">
                                  {children}
                                </blockquote>
                              ),
                              hr: () => (
                                <hr className="border-slate-200 my-4" />
                              ),
                            }}
                          >
                            {option.content}
                          </ReactMarkdown>
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
                  const option =
                    missionOptions.find(
                      (o) => o.id === activeOptionPreviewId,
                    ) ?? missionOptions[0];
                  if (option) chooseMissionOption(option);
                }}
                className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                이 옵션으로 시작{" "}
                {missionDurationMinutes ? `(${missionDurationMinutes}분)` : ""}
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex flex-1 overflow-hidden">
          {/* Left panel: content */}
          <section ref={missionPanelRef} className="flex-1 space-y-6 overflow-y-auto pb-32 pt-8 pl-10 pr-6">
            {/* Mission */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-900">Mission</p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                    {device === "mobile" ? (
                      <>
                        <DeviceMobileIcon size={12} className="inline" /> 모바일
                      </>
                    ) : (
                      <>
                        <MonitorIcon size={12} className="inline" /> PC
                      </>
                    )}
                  </span>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                <div className="space-y-3">
                  <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900">
                    {parentMissionTitle || missionTitle || (
                      <span className="font-normal text-slate-400">
                        미션 제목 없음
                      </span>
                    )}
                  </p>
                  {parentMissionBrief || (!activeOption && missionBrief) ? (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        전체 미션 브리핑
                      </p>
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-base font-bold text-slate-900 mb-1 mt-3 first:mt-0">
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-sm font-semibold text-slate-900 mb-1 mt-3 first:mt-0">
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-sm font-medium text-slate-800 mb-1 mt-2">
                              {children}
                            </h3>
                          ),
                          p: ({ children }) => (
                            <p className="leading-relaxed mb-2 last:mb-0">
                              {children}
                            </p>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc ml-4 space-y-1 mb-2">
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="list-decimal ml-4 space-y-1 mb-2">
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li className="leading-relaxed">{children}</li>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-semibold text-slate-900">
                              {children}
                            </strong>
                          ),
                          code: ({ children }) => (
                            <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
                              {children}
                            </code>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-500 my-2">
                              {children}
                            </blockquote>
                          ),
                        }}
                      >
                        {parentMissionBrief || missionBrief}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                      전체 미션 브리핑 없음
                    </p>
                  )}
                </div>

                {activeOption && (
                  <div className="border-t border-slate-100 pt-4">
                    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                      <button
                        onClick={() => setIsOptionExpanded((p) => !p)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition"
                      >
                        <span className="text-sm font-semibold text-slate-800">
                          선택된 옵션: {activeOption.title}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {isOptionExpanded ? "▲" : "▼"}
                        </span>
                      </button>
                      {isOptionExpanded && (
                        <div className="border-t border-slate-100 px-4 py-3 space-y-4">
                          {activeOption.description && (
                            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                              {activeOption.description}
                            </p>
                          )}
                          {activeOption.content && (
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-2">
                              <ReactMarkdown
                                components={{
                                  h1: ({ children }) => (
                                    <h1 className="text-base font-bold text-slate-900 mb-1 mt-3 first:mt-0">
                                      {children}
                                    </h1>
                                  ),
                                  h2: ({ children }) => (
                                    <h2 className="text-sm font-semibold text-slate-900 mb-1 mt-3 first:mt-0">
                                      {children}
                                    </h2>
                                  ),
                                  h3: ({ children }) => (
                                    <h3 className="text-sm font-medium text-slate-800 mb-1 mt-2">
                                      {children}
                                    </h3>
                                  ),
                                  p: ({ children }) => (
                                    <p className="leading-relaxed mb-2 last:mb-0">
                                      {children}
                                    </p>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="list-disc ml-4 space-y-1 mb-2">
                                      {children}
                                    </ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="list-decimal ml-4 space-y-1 mb-2">
                                      {children}
                                    </ol>
                                  ),
                                  li: ({ children }) => (
                                    <li className="leading-relaxed">
                                      {children}
                                    </li>
                                  ),
                                  strong: ({ children }) => (
                                    <strong className="font-semibold text-slate-900">
                                      {children}
                                    </strong>
                                  ),
                                  code: ({ children }) => (
                                    <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
                                      {children}
                                    </code>
                                  ),
                                  blockquote: ({ children }) => (
                                    <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-500 my-2">
                                      {children}
                                    </blockquote>
                                  ),
                                }}
                              >
                                {activeOption.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Reference */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-900">
                  Reference
                </p>
                {isFetchingRefs && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
                    레퍼런스 검색 중...
                  </span>
	                )}
	              </div>
	              {referenceSearchError && !isFetchingRefs && (
	                <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
	                  {referenceSearchError}
	                </div>
	              )}
	              {references.length === 0 && !isFetchingRefs ? (
	                referenceSearchError ? null : (
	                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
	                  {
	                    '채팅에서 "레퍼런스 찾아줘"라고 입력하면 관련 UI 이미지가 표시됩니다.'
	                  }
	                </div>
	                )
	              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {references.map((card) => {
                    const isSelected = selectedReferences.some(
                      (r) => r.id === card.id,
                    );
                    return (
                      <div
                        key={card.id}
                        onClick={() => {
                          setSelectedReferences((prev) =>
                            isSelected
                              ? prev.filter((r) => r.id !== card.id)
                              : [...prev, card],
                          );
                        }}
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
                              onError={(e) => {
                                (
                                  e.currentTarget as HTMLImageElement
                                ).style.display = "none";
                              }}
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-1 p-3">
                          <p
                            className={`text-sm font-semibold leading-snug line-clamp-2 ${isSelected ? "text-indigo-700" : "text-slate-900"}`}
                          >
                            {card.title}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-1">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                {card.tag}
                              </span>
                              {card.searchProvider && (
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                                  {card.searchProvider === "openai-web"
                                    ? "OpenAI web"
                                    : "Serper image"}
                                </span>
                              )}
                              {card.referenceMode && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                  {card.referenceMode}
                                </span>
                              )}
                            </div>
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
                                  if (!confirm("이 레퍼런스를 삭제할까요?"))
                                    return;
                                  appendActivityLog({
                                    section: "reference",
                                    action: "delete",
                                    output: card.description,
                                    outputTitle: card.title,
                                    link: card.url,
                                    imageUrl: card.imageUrl,
                                  });
                                  void encodeMemoryDraft(
                                    `delete-reference-${card.id}`,
                                    `레퍼런스 삭제: ${card.title}`,
                                    `태그: ${card.tag}, URL: ${card.url ?? ""}`,
                                    Date.now(),
                                  );
                                  setReferences((prev) =>
                                    prev.filter((r) => r.id !== card.id),
                                  );
                                  setSelectedReferences((prev) =>
                                    prev.filter((r) => r.id !== card.id),
                                  );
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
                          <div className="absolute top-2 right-2 rounded-full bg-indigo-500 text-white text-xs px-2 py-0.5">
                            인용됨
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Note / Mockup / Presentation */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6">
              {ideas.length === 0 ? (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-400">
                  <p>에이전트에게 시안을 작성해달라고 요청하세요.</p>
                </div>
              ) : (
                <>
                  {/* Top: note tabs */}
                  <div className="flex gap-2 overflow-x-auto pb-4 mb-6 border-b border-slate-100">
                    {ideas.map((idea) => (
                      <div
                        key={idea.id}
                        className={`group shrink-0 flex items-center gap-1 rounded-xl border px-3 py-2 text-sm transition ${
                          activeIdeaId === idea.id
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <button onClick={() => switchIdea(idea.id)}>
                          {idea.title}
                        </button>
                        {!isReadOnly && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteIdea(idea.id);
                            }}
                            className={`ml-1 rounded-md p-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                              activeIdeaId === idea.id
                                ? "hover:bg-white/20"
                                : "hover:bg-slate-200"
                            }`}
                            title="시안 삭제"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    {/* Sub-tab sidebar */}
                    <div className="sticky top-4 flex flex-col space-y-2 self-start text-sm text-slate-600">
                      {[
                        { id: "idea", label: "Note", ref: ideaSectionRef },
                        {
                          id: "style",
                          label: "Style",
                          ref: styleSectionRef,
                        },
                        {
                          id: "mockup",
                          label: "Mockup",
                          ref: mockupSectionRef,
                        },
                        {
                          id: "presentation",
                          label: "Presentation",
                          ref: presentationSectionRef,
                        },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setActiveIdeaTab(tab.id);
                            setTimeout(
                              () =>
                                tab.ref.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                }),
                              0,
                            );
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
                      {/* Note */}
                      {(() => {
                        const idea =
                          ideas.find((i) => i.id === activeIdeaId) ?? null;
                        if (!idea) return null;
                        return (
                          <>
                            <section
                              ref={ideaSectionRef}
                              className="space-y-4 scroll-mt-4"
                            >
                              <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    시안 노트
                                  </p>
                                  <p className="text-base font-semibold text-slate-900">
                                    {idea.title}
                                  </p>
                                </div>
                              </div>
                              <div className="relative rounded-2xl border border-slate-100 bg-white shadow-sm">
                                <div
                                  className={`space-y-2 px-5 pb-14 pt-5 text-sm text-slate-700 ${isIdeaExpanded ? "max-h-[60vh] overflow-y-auto" : "max-h-64 overflow-hidden"}`}
                                >
                                  {idea.description ? (
                                    <ReactMarkdown
                                      components={{
                                        h1: ({ children }) => (
                                          <h1 className="text-base font-bold text-slate-900 mb-1">
                                            {children}
                                          </h1>
                                        ),
                                        h2: ({ children }) => (
                                          <h2 className="text-sm font-semibold text-slate-900 mb-1 mt-3">
                                            {children}
                                          </h2>
                                        ),
                                        h3: ({ children }) => (
                                          <h3 className="text-sm font-medium text-slate-800 mb-1 mt-2">
                                            {children}
                                          </h3>
                                        ),
                                        p: ({ children }) => (
                                          <p className="leading-relaxed mb-2 last:mb-0">
                                            {children}
                                          </p>
                                        ),
                                        ul: ({ children }) => (
                                          <ul className="list-disc ml-4 space-y-1 mb-2">
                                            {children}
                                          </ul>
                                        ),
                                        ol: ({ children }) => (
                                          <ol className="list-decimal ml-4 space-y-1 mb-2">
                                            {children}
                                          </ol>
                                        ),
                                        li: ({ children }) => (
                                          <li className="leading-relaxed">
                                            {children}
                                          </li>
                                        ),
                                        strong: ({ children }) => (
                                          <strong className="font-semibold text-slate-900">
                                            {children}
                                          </strong>
                                        ),
                                        em: ({ children }) => (
                                          <em className="italic text-slate-600">
                                            {children}
                                          </em>
                                        ),
                                        code: ({ children }) => (
                                          <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
                                            {children}
                                          </code>
                                        ),
                                        blockquote: ({ children }) => (
                                          <blockquote className="border-l-2 border-slate-300 pl-3 italic text-slate-500 my-2">
                                            {children}
                                          </blockquote>
                                        ),
                                        hr: () => (
                                          <hr className="border-slate-200 my-3" />
                                        ),
                                        a: ({ href, children }) => (
                                          <a
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700"
                                          >
                                            {children}
                                          </a>
                                        ),
                                      }}
                                    >
                                      {idea.description}
                                    </ReactMarkdown>
                                  ) : (
                                    <p className="text-slate-400">
                                      에이전트가 아직 노트 내용을 작성하지 않았습니다.
                                    </p>
                                  )}
                                </div>
                                {!isIdeaExpanded && (
                                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-white via-white to-transparent" />
                                )}
                                <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
                                  <button
                                    onClick={() => setIsIdeaExpanded((p) => !p)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm transition hover:bg-slate-50"
                                  >
                                    {isIdeaExpanded ? (
                                      <CaretUpIcon size={12} />
                                    ) : (
                                      <CaretDownIcon size={12} />
                                    )}
                                    {isIdeaExpanded ? "접기" : "펼치기"}
                                  </button>
                                </div>
                              </div>
                            </section>

                            <section
                              ref={styleSectionRef}
                              className="space-y-3 scroll-mt-4"
                            >
                              <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-indigo-50/40">
                              <button
                                type="button"
                                onClick={() => setIsDesignSpecOpen((open) => !open)}
                                className="flex w-full items-center justify-between px-4 py-3 text-left"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-100 bg-white text-xs font-semibold text-indigo-600">
                                    Aa
                                  </span>
                                  <span className="space-y-0.5">
                                    <span className="block text-xs font-semibold text-slate-800">
                                      디자인 스타일
                                    </span>
                                    <span className="block text-[11px] text-slate-500">
                                      {idea.designStyle ? "현재 시안의 시각 규칙" : "아직 정의되지 않음"}
                                    </span>
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 text-xs text-slate-500">
                                  <span className={`rounded-full px-2 py-0.5 font-semibold ${
                                    idea.designStyle
                                      ? "bg-indigo-100 text-indigo-700"
                                      : "bg-white text-slate-400"
                                  }`}>
                                    {idea.designStyle ? "설정됨" : "미정의"}
                                  </span>
                                  {isDesignSpecOpen ? "접기" : "펼치기"}
                                </span>
                              </button>
                              {isDesignSpecOpen && (
                                <div className="space-y-3 border-t border-indigo-100 px-4 py-3">
                                  {!idea.designStyle ? (
                                    <p className="text-xs text-slate-500">
                                      에이전트에게 이 시안의 디자인 스타일을 정의해달라고 요청하세요.
                                    </p>
                                  ) : (
                                    (() => {
                                      const style = idea.designStyle;
                                      return (
                                        <div className="space-y-3">
                                          <div className="max-h-56 overflow-y-auto rounded-xl border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-600">
                                            <ReactMarkdown
                                              components={{
                                                h1: ({ children }) => (
                                                  <h1 className="mb-2 mt-3 text-sm font-bold text-slate-900 first:mt-0">
                                                    {children}
                                                  </h1>
                                                ),
                                                h2: ({ children }) => (
                                                  <h2 className="mb-1.5 mt-3 text-xs font-semibold uppercase text-slate-800 first:mt-0">
                                                    {children}
                                                  </h2>
                                                ),
                                                h3: ({ children }) => (
                                                  <h3 className="mb-1 mt-2 text-xs font-semibold text-slate-700">
                                                    {children}
                                                  </h3>
                                                ),
                                                p: ({ children }) => (
                                                  <p className="mb-1.5 leading-relaxed last:mb-0">
                                                    {withColorTokens(children)}
                                                  </p>
                                                ),
                                                ul: ({ children }) => (
                                                  <ul className="mb-1.5 ml-4 list-disc space-y-0.5">
                                                    {children}
                                                  </ul>
                                                ),
                                                ol: ({ children }) => (
                                                  <ol className="mb-1.5 ml-4 list-decimal space-y-0.5">
                                                    {children}
                                                  </ol>
                                                ),
                                                li: ({ children }) => (
                                                  <li className="leading-relaxed">
                                                    {withColorTokens(children)}
                                                  </li>
                                                ),
                                                strong: ({ children }) => (
                                                  <strong className="font-semibold text-slate-900">
                                                    {children}
                                                  </strong>
                                                ),
                                                em: ({ children }) => (
                                                  <em className="italic text-slate-600">
                                                    {children}
                                                  </em>
                                                ),
                                                code: ({ children }) => {
                                                  const text = String(children ?? "");
                                                  const trimmed = text.trim();
                                                  const isHex =
                                                    /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(trimmed);
                                                  return (
                                                    <span className="inline-flex items-center gap-1 align-middle">
                                                      {isHex && (
                                                        <span
                                                          className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
                                                          style={{ backgroundColor: trimmed }}
                                                        />
                                                      )}
                                                      <code className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700">
                                                        {text}
                                                      </code>
                                                    </span>
                                                  );
                                                },
                                                blockquote: ({ children }) => (
                                                  <blockquote className="my-2 border-l-2 border-indigo-200 pl-3 italic text-slate-500">
                                                    {children}
                                                  </blockquote>
                                                ),
                                                hr: () => (
                                                  <hr className="my-2 border-indigo-100" />
                                                ),
                                                a: ({ href, children }) => (
                                                  <a
                                                    href={href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                                                  >
                                                    {children}
                                                  </a>
                                                ),
                                              }}
                                            >
                                              {style.content}
                                            </ReactMarkdown>
                                          </div>
                                        </div>
                                      );
                                    })()
                                  )}
                                </div>
                              )}
                              </div>
                            </section>
                          </>
                        );
                      })()}

                      {/* Mockup */}
                      <section
                        ref={mockupSectionRef}
                        className="space-y-3 scroll-mt-4"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-base font-semibold text-slate-900">
                            Mockup
                          </p>
                          {ideaArtboards.length > 0 && (
                            <div className="flex items-center gap-2">
                              {editMode && selectedElement && (
                                <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                  {selectedElement.selector} 선택됨
                                  <button
                                    onClick={clearSelectedElement}
                                    className="ml-1 text-indigo-400 hover:text-indigo-600"
                                  >
                                    <XIcon size={12} />
                                  </button>
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setEditMode((p) => {
                                    if (p) setSelectedElement(null);
                                    return !p;
                                  });
                                }}
                                className={`rounded border px-2 py-1 text-xs font-semibold transition ${editMode ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                              >
                                {editMode ? "편집 중" : "편집"}
                              </button>
                              <button
                                onClick={fitToCanvas}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                              >
                                Fit
                              </button>
                              <button
                                onClick={() =>
                                  setCanvasScale((s) =>
                                    Math.min(s * 1.2, MAX_CANVAS_SCALE),
                                  )
                                }
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                +
                              </button>
                              <button
                                onClick={() =>
                                  setCanvasScale((s) =>
                                    Math.max(s * 0.8, MIN_CANVAS_SCALE),
                                  )
                                }
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                −
                              </button>
                              <span className="w-10 text-center text-xs text-slate-400">
                                {Math.round(canvasScale * 100)}%
                              </span>
                              <button
                                onClick={() => {
                                  const html = activeArtboard?.html;
                                  if (!html) return;
                                  const blob = new Blob([html], {
                                    type: "text/html",
                                  });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `${activeArtboard?.label ?? "mockup"}.html`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                              >
                                Export
                              </button>
                              <button
                                onClick={() => setIsMockupExpanded(true)}
                                className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
                                title="확대"
                              >
                                <ArrowsOutIcon size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                        {ideaArtboards.length > 0 ? (
                          isMockupExpanded ? (
                            <div className="flex h-64 items-center justify-center rounded-2xl bg-[#1a1a1a] text-xs text-white/40">
                              확대 보기 중...
                            </div>
                          ) : (
                            renderMockupCanvas()
                          )
                        ) : (
                          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                            {isGeneratingCurrentIdeaMockup ? (
                              <>
                                <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                                <p className="text-slate-500">
                                  Stitch로 목업{" "}
                                  {mockupOperation === "edit" ? "수정" : "생성"}{" "}
                                  중...
                                </p>
                                {!isReadOnly && (
                                  <button
                                    onClick={cancelMockupGeneration}
                                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
                                  >
                                    취소
                                  </button>
                                )}
                              </>
                            ) : (
                              <p>
                                {
                                  '에이전트에게 "목업 만들어줘"라고 말하면 여기에 표시됩니다.'
                                }
                              </p>
                            )}
                          </div>
                        )}
                      </section>

                      {/* Presentation — per-idea */}
                      {(() => {
                        const activeIdea = ideas.find(
                          (i) => i.id === activeIdeaId,
                        );
                        const presentations = activeIdea
                          ? normalizePresentations(activeIdea)
                          : [];
                        const selectedPresentation =
                          presentations.find(
                            (p) => p.id === activePresentationId,
                          ) ??
                          presentations.at(-1) ??
                          null;
                        const deletePresentation = (presentationId: string) => {
                          if (!activeIdea) return;
                          const nextPresentations = normalizePresentations(
                            activeIdea,
                          ).filter((p) => p.id !== presentationId);
                          updateIdea(activeIdea.id, {
                            presentations: nextPresentations,
                            presentationSlides:
                              nextPresentations.at(-1)?.slides ?? [],
                            presentationHtml: nextPresentations.at(-1)?.html,
                          });
                          if (activePresentationId === presentationId) {
                            setActivePresentationId(
                              nextPresentations.at(-1)?.id ?? null,
                            );
                          }
                        };
                        return (
                          <section
                            ref={presentationSectionRef}
                            className="space-y-3 scroll-mt-4"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-base font-semibold text-slate-900">
                                Presentation
                              </p>
                              {presentations.length > 0 && (
                                <span className="text-xs text-slate-400">
                                  {presentations.length}개
                                </span>
                              )}
                            </div>
                            {isGeneratingPresentation ? (
                              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                                <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                                <p className="text-slate-500">
                                  프레젠테이션 이미지 생성 중...
                                </p>
                              </div>
                            ) : presentations.length > 0 ? (
                              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
                                  <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                                    {presentations.map(
                                      (presentation, index) => {
                                        const isActive =
                                          presentation.id ===
                                          selectedPresentation?.id;
                                        return (
                                          <button
                                            key={presentation.id}
                                            onClick={() => {
                                              if (!isActive) {
                                                void encodeMemoryDraft(
                                                  `select-presentation-${presentation.id}`,
                                                  `프레젠테이션 선택: ${presentation.title || `P${index + 1}`}`,
                                                  `생성일: ${presentation.createdAt ? new Date(presentation.createdAt).toLocaleString("ko-KR") : "미상"}`,
                                                  Date.now(),
                                                );
                                              }
                                              setActivePresentationId(
                                                presentation.id,
                                              );
                                            }}
                                            className={`max-w-44 shrink-0 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                              isActive
                                                ? "bg-slate-900 text-white"
                                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                            }`}
                                            title={presentation.title}
                                          >
                                            {presentation.title ||
                                              `P${index + 1}`}
                                          </button>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                                {selectedPresentation && (
                                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold text-slate-800">
                                        {selectedPresentation.title}
                                      </p>
                                      <p className="text-xs text-slate-400">
                                        {selectedPresentation.createdAt
                                          ? new Date(
                                              selectedPresentation.createdAt,
                                            ).toLocaleString("ko-KR")
                                          : "이전 프레젠테이션"}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => {
                                        if (
                                          confirm(
                                            "이 프레젠테이션을 삭제할까요?",
                                          )
                                        ) {
                                          void encodeMemoryDraft(
                                            `delete-presentation-${selectedPresentation.id}`,
                                            `프레젠테이션 삭제: ${selectedPresentation.title}`,
                                            `생성일: ${selectedPresentation.createdAt ? new Date(selectedPresentation.createdAt).toLocaleString("ko-KR") : "미상"}`,
                                            Date.now(),
                                          );
                                          deletePresentation(
                                            selectedPresentation.id,
                                          );
                                        }
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
                                    <img
                                      src={
                                        selectedPresentation.slides[0].imageUrl
                                      }
                                      alt={selectedPresentation.slides[0].title}
                                      className="w-full object-contain"
                                    />
                                  </div>
                                ) : selectedPresentation?.html ? (
                                  <iframe
                                    srcDoc={selectedPresentation.html}
                                    sandbox="allow-scripts allow-same-origin"
                                    className="h-125 w-full bg-white"
                                    title={
                                      selectedPresentation.title ||
                                      "Presentation preview"
                                    }
                                  />
                                ) : (
                                  <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                                    이미지 생성 실패
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                                {ideaArtboards.length === 0
                                  ? "목업을 먼저 생성하면 프레젠테이션을 만들 수 있습니다."
                                  : '에이전트에게 "프레젠테이션 만들어줘"라고 말하면 여기에 표시됩니다.'}
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
                    {(ideas.length > 0
                      ? [
                          "레퍼런스 찾아줘",
                          "목업 만들어줘",
                          "이 버튼 색상 바꿔줘",
                        ]
                      : ["레퍼런스 찾아줘", "목업에 쓸 레퍼런스 찾아줘"]
                    ).map((hint) => (
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
                        {msg.citedReferences &&
                          msg.citedReferences.length > 0 && (
                            <div className="flex flex-wrap justify-end gap-1">
                              {msg.citedReferences.map((r) => (
                                <span
                                  key={r.id}
                                  className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/80"
                                >
                                  {r.imageUrl && (
                                    <img
                                      src={r.imageUrl}
                                      alt=""
                                      className="h-3.5 w-5 rounded object-cover opacity-80"
                                    />
                                  )}
                                  <span className="max-w-32 truncate">
                                    {r.title}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        {msg.citedTexts && msg.citedTexts.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {msg.citedTexts.map((t, i) => (
                              <span
                                key={i}
                                className="max-w-48 truncate rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/80"
                              >
                                &quot;{t}&quot;
                              </span>
                            ))}
                          </div>
                        )}
                        <div>{msg.content}</div>
                      </div>
                    ) : msg.content ? (
                      (() => {
                        const parts = processMessageContent(msg.content);
                        const mdComponents = {
                          p: ({ children }: { children?: React.ReactNode }) => (
                            <p className="mb-2 last:mb-0">{children}</p>
                          ),
                          ul: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <ul className="mb-2 ml-4 list-disc space-y-1">
                              {children}
                            </ul>
                          ),
                          ol: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <ol className="mb-2 ml-4 list-decimal space-y-1">
                              {children}
                            </ol>
                          ),
                          li: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => <li>{children}</li>,
                          strong: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <strong className="font-semibold">
                              {children}
                            </strong>
                          ),
                          code: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
                              {children}
                            </code>
                          ),
                          pre: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <pre className="mt-1 max-h-36 overflow-y-auto rounded-xl bg-slate-800 p-3 text-xs text-slate-100">
                              {children}
                            </pre>
                          ),
                          h1: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <h1 className="mb-1 text-base font-semibold">
                              {children}
                            </h1>
                          ),
                          h2: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <h2 className="mb-1 text-sm font-semibold">
                              {children}
                            </h2>
                          ),
                          h3: ({
                            children,
                          }: {
                            children?: React.ReactNode;
                          }) => (
                            <h3 className="mb-1 text-sm font-medium">
                              {children}
                            </h3>
                          ),
                          a: ({
                            href,
                            children,
                          }: {
                            href?: string;
                            children?: React.ReactNode;
                          }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700"
                            >
                              {children}
                            </a>
                          ),
                        };
                        const isStreamingThis =
                          isLoading && msgIdx === messages.length - 1;
                        return (
                          <div className="space-y-2">
                            {parts.map((part, i) =>
                              part.type === "text" ? (
                                <ReactMarkdown
                                  key={i}
                                  components={mdComponents}
                                >
                                  {part.content}
                                </ReactMarkdown>
                              ) : (
                                <CodeChip
                                  key={i}
                                  chipKey={`${msg.id}-${i}`}
                                  chip={part.chip}
                                  expanded={expandedChips.has(`${msg.id}-${i}`)}
                                  onToggle={(k: string) =>
                                    setExpandedChips((prev) => {
                                      const next = new Set(prev);
                                      next.has(k)
                                        ? next.delete(k)
                                        : next.add(k);
                                      return next;
                                    })
                                  }
                                />
                              ),
                            )}
                            {isStreamingThis && (
                              <span className="inline-flex items-center gap-0.5 ml-0.5">
                                <span
                                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                                  style={{ animationDelay: "0ms" }}
                                />
                                <span
                                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                                  style={{ animationDelay: "150ms" }}
                                />
                                <span
                                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                                  style={{ animationDelay: "300ms" }}
                                />
                              </span>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                          style={{ animationDelay: "300ms" }}
                        />
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
                    선택된 요소:{" "}
                    <code className="font-mono">
                      {selectedElement.selector}
                    </code>
                  </span>
                  <button
                    onClick={clearSelectedElement}
                    className="text-indigo-400 hover:text-indigo-600"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              )}
              {!isReadOnly && citedTexts.length > 0 && (
                <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-slate-600">텍스트 인용 ({citedTexts.length})</span>
                    <button onClick={() => setCitedTexts([])} className="text-slate-400 hover:text-slate-600">전체 해제</button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {citedTexts.map((t, i) => (
                      <span key={i} className="flex items-start gap-1 rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-600">
                        <span className="mt-0.5 shrink-0 text-slate-300">&quot;</span>
                        <span className="line-clamp-1 flex-1">{t}</span>
                        <button
                          onClick={() => setCitedTexts((prev) => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-slate-300 hover:text-slate-500"
                        >
                          <XIcon size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!isReadOnly && selectedReferences.length > 0 && (
                <div className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-violet-600">
                      레퍼런스 인용 ({selectedReferences.length})
                    </span>
                    <button
                      onClick={() => setSelectedReferences([])}
                      className="text-violet-400 hover:text-violet-600"
                    >
                      전체 해제
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedReferences.map((r) => (
                      <span
                        key={r.id}
                        className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-700"
                      >
                        {r.imageUrl && (
                          <img
                            src={r.imageUrl}
                            alt=""
                            className="h-3.5 w-5 rounded object-cover"
                          />
                        )}
                        <span className="max-w-32 truncate">{r.title}</span>
                        <button
                          onClick={() =>
                            setSelectedReferences((prev) =>
                              prev.filter((x) => x.id !== r.id),
                            )
                          }
                          className="ml-0.5 text-violet-400 hover:text-violet-600"
                        >
                          <XIcon size={12} />
                        </button>
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
                    disabled={!isMissionContextReady}
                    placeholder={
                      isMissionContextReady
                        ? "에이전트에게 메시지를 입력하세요..."
                        : "미션 정보를 불러오는 중입니다..."
                    }
                    className="max-h-24 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  />
                  {isGeneratingMockup ? (
                    <button
                      onClick={cancelMockupGeneration}
                      className="flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                    >
                      <span className="h-2 w-2 animate-spin rounded-full border border-white/60 border-t-transparent" />
                      {generatingMockupIdeaId === activeIdeaId
                        ? `${mockupOperation === "edit" ? "수정" : "생성"} 취소`
                        : "작업 취소"}
                    </button>
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
                      disabled={!inputText.trim() || !isMissionContextReady}
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
        <div
          className="fixed inset-y-0 left-0 right-0 z-40 flex flex-col bg-[#1a1a1a] md:right-112"
          style={{
            backgroundImage:
              "radial-gradient(circle, #383838 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        >
          {/* Overlay header */}
          <div className="flex items-center justify-between bg-slate-900/80 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              {!isReadOnly && (
                <button
                  onClick={() => {
                    setEditMode((prev) => {
                      if (prev) setSelectedElement(null);
                      return !prev;
                    });
                  }}
                  className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                    editMode
                      ? "border-indigo-300 bg-indigo-500/20 text-indigo-100"
                      : "border-white/20 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {editMode ? "편집 가능 On" : "편집 가능 Off"}
                </button>
              )}
              <button
                onClick={fitToCanvas}
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                Fit
              </button>
              <button
                onClick={() =>
                  setCanvasScale((s) => Math.min(s * 1.2, MAX_CANVAS_SCALE))
                }
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                +
              </button>
              <button
                onClick={() =>
                  setCanvasScale((s) => Math.max(s * 0.8, MIN_CANVAS_SCALE))
                }
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                −
              </button>
              <span className="text-xs text-white/40">
                {Math.round(canvasScale * 100)}%
              </span>
            </div>
            <button
              onClick={() => setIsMockupExpanded(false)}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
            >
              <ArrowsInIcon size={14} /> 축소
            </button>
          </div>

          {/* Canvas */}
          {renderMockupCanvas(true)}
        </div>
      )}

      {/* Lobby navigation warning */}
      {showLobbyWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold text-slate-900">
              세션이 아직 종료되지 않았어요
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-slate-600">
              <strong>세션 종료</strong> 버튼을 누르지 않으면 이번 세션의 메모리가 저장되지 않을 수 있습니다. 계속 나가시겠어요?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLobbyWarning(false)}
                className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => router.push("/lobby")}
                className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                그냥 나가기
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
