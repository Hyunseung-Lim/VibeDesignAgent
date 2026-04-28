'use client';

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { firebaseAuth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";

const ADMIN_EMAILS = ["03leesun@gmail.com"];

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
  presentationSlides?: PresentationSlide[];
  presentationHtml?: string;
};

type Device = "desktop" | "mobile";

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

type ContentChip = { label: string; done: boolean; code?: string };
type ContentPart = { type: "text"; content: string } | { type: "chip"; chip: ContentChip };

const BLOCK_RULES = [
  { complete: /\[GENERATE_MOCKUP:[^\]]+\]/, partial: /\[GENERATE_MOCKUP:[\s\S]*$/, doneLabel: "새 목업 생성 요청", pendingLabel: "목업 설명 작성 중..." },
  { complete: /\[EDIT_MOCKUP:[^\]]+\]/, partial: /\[EDIT_MOCKUP:[\s\S]*$/, doneLabel: "목업 수정 요청", pendingLabel: "수정 내용 작성 중..." },
  { complete: /```presentation\s*\n[\s\S]*?\n?\s*```/, partial: /```presentation[\s\S]*$/, doneLabel: "피치덱 생성됨", pendingLabel: "피치덱 생성 중..." },
  { complete: /\[FETCH_REFERENCES(?::[^\]]+)?\]/, partial: /\[FETCH_REFERENCES[\s\S]*$/, doneLabel: "레퍼런스 검색됨", pendingLabel: "레퍼런스 검색 중..." },
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
        {hasCode && <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>}
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
  const [activeIdeaTab, setActiveIdeaTab] = useState("idea");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isFetchingRefs, setIsFetchingRefs] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  const [stitchProjectId, setStitchProjectId] = useState<string>("");
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false);
  const [ideaEditMode, setIdeaEditMode] = useState(false);

  const isReadOnly = !!(viewAs && isAdmin);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const ideaSectionRef = useRef<HTMLElement>(null);
  const mockupSectionRef = useRef<HTMLElement>(null);
  const presentationSectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);
  const canvasOffsetRef = useRef({ x: 40, y: 40 });
  const canvasScaleRef = useRef(0.5);
  const artboardsRef = useRef<Artboard[]>([]);
  const activeIdeaIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedChips, setExpandedChips] = useState<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => { canvasOffsetRef.current = canvasOffset; }, [canvasOffset]);
  useEffect(() => { canvasScaleRef.current = canvasScale; }, [canvasScale]);
  useEffect(() => { artboardsRef.current = artboards; }, [artboards]);
  useEffect(() => { activeIdeaIdRef.current = activeIdeaId; }, [activeIdeaId]);

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

    Promise.all([getDoc(sessionRef), getDoc(missionRef)]).then(([sessionSnap, missionSnap]) => {
      const session = sessionSnap.exists() ? sessionSnap.data() : null;
      const mission = missionSnap.exists() ? missionSnap.data() : null;

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
        setArtboards(loaded);
        setActiveArtboardId(loaded[loaded.length - 1].id);
        setActiveIdeaTab("mockup");
        const pid = session.stitchProjectId;
        if (pid) {
          loaded.forEach((a: Artboard) => {
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
        if (idx === 0) {
          return {
            ...idea,
            presentationSlides: idea.presentationSlides ?? (session?.presentationSlides?.length ? session.presentationSlides : undefined),
            presentationHtml: idea.presentationHtml ?? session?.presentationHtml ?? undefined,
          };
        }
        return idea;
      });

      if (ideasWithPresentation.length > 0) {
        setIdeas(ideasWithPresentation);
        setActiveIdeaId(ideasWithPresentation[0].id);
      }
      if (session?.references) setReferences(session.references);
      if (session?.stitchProjectId) setStitchProjectId(session.stitchProjectId);

      // Prefer session-saved overrides; fall back to admin-set mission data
      setMissionTitle(session?.missionTitle || mission?.title || "");
      setMissionBrief(session?.missionBrief || mission?.description || "");
      if (mission?.startDate && mission?.endDate) {
        setMissionPeriod(`${mission.startDate} – ${mission.endDate}`);
      }
      if (mission?.device) setDevice(mission.device as Device);
    });
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
        presentationSlides: (idea.presentationSlides ?? []).filter(s => s.imageUrl.startsWith("https://")),
      }));
      setDoc(ref, { messages, artboards: artboardsToSave, references, ideas: ideasToSave, missionTitle, missionBrief, stitchProjectId: stitchProjectId || null, updatedAt: Date.now() }, { merge: true });
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [userId, missionId, messages, artboards, references, ideas, missionTitle, missionBrief, stitchProjectId]);

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
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Wheel zoom toward cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const prevScale = canvasScaleRef.current;
      const newScale = Math.min(Math.max(prevScale * factor, 0.1), 4);
      const prevOffset = canvasOffsetRef.current;
      setCanvasScale(newScale);
      setCanvasOffset({
        x: mouseX - (mouseX - prevOffset.x) * (newScale / prevScale),
        y: mouseY - (mouseY - prevOffset.y) * (newScale / prevScale),
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Fit all artboards into canvas view
  const fitToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boards = artboardsRef.current.filter(a => a.ideaId === activeIdeaIdRef.current);
    if (boards.length === 0) return;
    const { clientWidth, clientHeight } = canvas;
    const minX = Math.min(...boards.map(a => a.x));
    const minY = Math.min(...boards.map(a => a.y));
    const maxX = Math.max(...boards.map(a => a.x + DEVICE_SIZE[a.device ?? "desktop"].width));
    const maxY = Math.max(...boards.map(a => a.y + DEVICE_SIZE[a.device ?? "desktop"].height));
    const totalW = maxX - minX;
    const totalH = maxY - minY;
    const scale = Math.min((clientWidth - 80) / totalW, (clientHeight - 80) / totalH, 1);
    setCanvasScale(scale);
    setCanvasOffset({
      x: (clientWidth - totalW * scale) / 2 - minX * scale,
      y: (clientHeight - totalH * scale) / 2 - minY * scale,
    });
  }, []);

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
    setActiveIdeaTab("idea");
    setIdeaEditMode(true);
  };

  const switchIdea = (ideaId: string) => {
    setActiveIdeaId(ideaId);
    setCurrentSlideIndex(0);
    setActiveIdeaTab("idea");
    setIdeaEditMode(false);
    const ideaBoards = artboardsRef.current.filter(a => a.ideaId === ideaId);
    setActiveArtboardId(ideaBoards.at(-1)?.id ?? null);
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
          device,
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
        const isNew = !!generateMatch;

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

        setIsGeneratingMockup(true);
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
                prompt,
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
              const last = prev[prev.length - 1];
              let offsetX = last ? last.x + DEVICE_SIZE[last.device ?? "desktop"].width + ARTBOARD_GAP : 0;

              const ideaId = activeIdeaId ?? "";
              const primaryBoard: Artboard = {
                id: primaryId,
                html: data.html,
                label: `Design ${prev.filter(a => a.ideaId === ideaId).length + 1}`,
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
                label: `Design ${prev.filter(a => a.ideaId === ideaId).length + 2 + i}`,
                x: offsetX + i * (DEVICE_SIZE[device].width + ARTBOARD_GAP),
                y: 0,
                device,
                stitchScreenId: sid,
                ideaId,
              }));

              return [...prev, primaryBoard, ...extraBoards];
            });
            setActiveArtboardId(primaryId);

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
            const presRes = await fetch("/api/presentation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: presentationBlock.data.title, slides: presentationBlock.data.slides }),
            });
            const presData = await presRes.json();
            console.log("[presentation] api response:", presData.error ?? `${presData.slides?.length} slides`);
            if (presData.error) throw new Error(presData.error);
            if (presData.slides) {
              const uid = firebaseAuth.currentUser?.uid ?? "anonymous";
              const uploadedSlides: PresentationSlide[] = await Promise.all(
                (presData.slides as PresentationSlide[]).map(async (slide, i) => {
                  if (!slide.imageUrl.startsWith("data:")) return slide;
                  try {
                    const imgRef = storageRef(storage, `presentations/${uid}/${missionId}/slide-${i}.png`);
                    await uploadString(imgRef, slide.imageUrl, "data_url");
                    const url = await getDownloadURL(imgRef);
                    console.log(`[presentation] slide ${i} uploaded`);
                    return { ...slide, imageUrl: url };
                  } catch (uploadErr) {
                    console.warn(`[presentation] slide ${i} storage upload failed, using base64:`, uploadErr);
                    return slide;
                  }
                })
              );
              if (activeIdeaId) updateIdea(activeIdeaId, { presentationSlides: uploadedSlides });
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
          if (activeIdeaId) updateIdea(activeIdeaId, { presentationHtml: presentationBlock.html });
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
  }, [inputText, isLoading, isGeneratingMockup, messages, artboards, activeArtboardId, activeIdeaId, selectedElement, selectedReferences, ideas, device, stitchProjectId, missionTitle, missionBrief]);

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
      if (data.references?.length > 0) setReferences(data.references);
    } finally {
      setIsFetchingRefs(false);
    }
  }, [isFetchingRefs, isReadOnly]);



  const ideaArtboards = artboards.filter(a => a.ideaId === activeIdeaId);
  const activeArtboard = ideaArtboards.find(a => a.id === activeArtboardId) ?? ideaArtboards[ideaArtboards.length - 1] ?? null;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          <span>👁 읽기 전용 — <strong>{viewAsName ?? viewAs}</strong>의 세션을 보고 있습니다</span>
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
          <Link
            href="/lobby"
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            로비로 돌아가기
          </Link>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Left panel: content */}
        <section className="flex-1 space-y-6 overflow-y-auto pb-32 pt-8 pl-10 pr-6">
          {/* Mission */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Mission</p>
              <div className="flex items-center gap-2">
                {missionPeriod && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{missionPeriod}</span>
                )}
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                  {device === "mobile" ? "📱 모바일" : "💻 PC"}
                </span>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900">
                {missionTitle || <span className="font-normal text-slate-400">미션 제목 없음</span>}
              </p>
              {missionBrief ? (
                <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {missionBrief}
                </p>
              ) : (
                <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400">미션 브리핑 없음</p>
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
                          {card.url && (
                            <a
                              href={card.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
                              title="새 탭에서 열기"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          )}
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
                            <div className="prose prose-sm max-w-none rounded-xl border border-slate-100 bg-slate-50 px-5 py-4 text-slate-700">
                              {idea.description ? (
                                <ReactMarkdown>{idea.description}</ReactMarkdown>
                              ) : (
                                <p className="text-slate-400 text-sm">편집 버튼을 눌러 내용을 작성하세요.</p>
                              )}
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
                                <button onClick={clearSelectedElement} className="ml-1 text-indigo-400 hover:text-indigo-600">✕</button>
                              </span>
                            )}
                            <button onClick={() => { setEditMode(p => { if (p) setSelectedElement(null); return !p; }); }} className={`rounded border px-2 py-1 text-xs font-semibold transition ${editMode ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                              {editMode ? "편집 중" : "편집"}
                            </button>
                            <button onClick={fitToCanvas} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Fit</button>
                            <button onClick={() => setCanvasScale(s => Math.min(s * 1.2, 4))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">+</button>
                            <button onClick={() => setCanvasScale(s => Math.max(s * 0.8, 0.1))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">−</button>
                            <span className="w-10 text-center text-xs text-slate-400">{Math.round(canvasScale * 100)}%</span>
                            <button onClick={() => { const html = activeArtboard?.html; if (!html) return; const blob = new Blob([html], { type: "text/html" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${activeArtboard?.label ?? "mockup"}.html`; a.click(); URL.revokeObjectURL(url); }} className="text-xs font-semibold text-slate-600 hover:text-slate-900">Export</button>
                          </div>
                        )}
                      </div>
                      {ideaArtboards.length > 0 ? (
                        <div ref={canvasRef} className="relative h-150 w-full overflow-hidden rounded-2xl select-none" style={{ backgroundColor: "#1a1a1a", backgroundImage: "radial-gradient(circle, #383838 1px, transparent 1px)", backgroundSize: "20px 20px", cursor: isDragging ? "grabbing" : "grab" }} onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp}>
                          {isGeneratingMockup && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 rounded-2xl">
                              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              <p className="text-sm text-white/80">Stitch로 목업 생성 중...</p>
                            </div>
                          )}
                          {ideaArtboards.map(artboard => {
                            const screenX = canvasOffset.x + artboard.x * canvasScale;
                            const screenY = canvasOffset.y + artboard.y * canvasScale;
                            const isActive = artboard.id === activeArtboardId;
                            return (
                              <div key={artboard.id} style={{ pointerEvents: isDragging ? "none" : "auto" }}>
                                <div style={{ position: "absolute", left: screenX, top: screenY - 22, color: isActive ? "#a5b4fc" : "#888", fontSize: 11, fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", userSelect: "none" }}>{artboard.label}</div>
                                <div style={{ position: "absolute", left: screenX, top: screenY, transform: `scale(${canvasScale})`, transformOrigin: "0 0", width: DEVICE_SIZE[artboard.device ?? "desktop"].width, height: DEVICE_SIZE[artboard.device ?? "desktop"].height, borderRadius: artboard.device === "mobile" ? 24 : 12, overflow: "hidden", outline: isActive ? "2px solid #6366f1" : "2px solid transparent", outlineOffset: 3, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }} onClick={() => setActiveArtboardId(artboard.id)}>
                                  <iframe srcDoc={injectNoNavigation(editMode ? injectSelectionScript(artboard.html, artboard.id) : artboard.html)} sandbox="allow-scripts" style={{ width: DEVICE_SIZE[artboard.device ?? "desktop"].width, height: DEVICE_SIZE[artboard.device ?? "desktop"].height, border: "none", display: "block" }} title={artboard.label} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                          {isGeneratingMockup ? (
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
                      const slides = activeIdea?.presentationSlides ?? [];
                      const html = activeIdea?.presentationHtml ?? "";
                      return (
                        <section ref={presentationSectionRef} className="space-y-3 scroll-mt-4">
                          <p className="text-base font-semibold text-slate-900">Presentation</p>
                          {isGeneratingPresentation ? (
                            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                              <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                              <p className="text-slate-500">피치덱 이미지 생성 중...</p>
                            </div>
                          ) : slides.length > 0 ? (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black">
                              {slides[currentSlideIndex]?.imageUrl ? (
                                <img src={slides[currentSlideIndex].imageUrl} alt={slides[currentSlideIndex].title} className="w-full object-contain" />
                              ) : (
                                <div className="flex h-64 items-center justify-center text-sm text-slate-500">이미지 생성 실패</div>
                              )}
                              <div className="flex items-center justify-between bg-slate-900 px-4 py-2">
                                <button onClick={() => setCurrentSlideIndex(i => Math.max(0, i - 1))} disabled={currentSlideIndex === 0} className="rounded px-3 py-1 text-xs text-white disabled:opacity-30 hover:bg-white/10">← 이전</button>
                                <span className="text-xs text-slate-400">{slides[currentSlideIndex]?.title} ({currentSlideIndex + 1} / {slides.length})</span>
                                <button onClick={() => setCurrentSlideIndex(i => Math.min(slides.length - 1, i + 1))} disabled={currentSlideIndex === slides.length - 1} className="rounded px-3 py-1 text-xs text-white disabled:opacity-30 hover:bg-white/10">다음 →</button>
                              </div>
                            </div>
                          ) : html ? (
                            <iframe srcDoc={html} sandbox="allow-scripts allow-same-origin" className="h-125 w-full rounded-2xl border border-slate-200 bg-white" title="Presentation preview" />
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

            {messages.map((msg) => (
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
                    };
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
                <button onClick={clearSelectedElement} className="text-indigo-400 hover:text-indigo-600">✕</button>
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
                      <button onClick={() => setSelectedReferences(prev => prev.filter(x => x.id !== r.id))} className="ml-0.5 text-violet-400 hover:text-violet-600">✕</button>
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
                    Stitch 생성 중
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
    </div>
  );
}
