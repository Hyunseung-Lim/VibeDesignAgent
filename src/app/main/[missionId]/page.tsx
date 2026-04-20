'use client';

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { firebaseAuth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Reference = {
  id: string;
  title: string;
  description: string;
  tag: string;
  url?: string;
};

type Idea = {
  id: string;
  title: string;
  description: string;
};

type Artboard = {
  id: string;
  html: string;
  label: string;
  x: number;
  y: number;
};

type SelectedElement = {
  artboardId: string;
  selector: string;
  outerHTML: string;
};

function parseIdeas(text: string): Idea[] | null {
  const match = text.match(/\[IDEAS\]([\s\S]*?)\[\/IDEAS\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed.map((r: Omit<Idea, "id">, i: number) => ({
      ...r,
      id: `idea-${Date.now()}-${i}`,
    }));
  } catch {
    return null;
  }
}

function parsePresentationHtml(text: string): string | null {
  const match = text.match(/```presentation\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

function parseReferences(text: string): Reference[] | null {
  const match = text.match(/\[REFERENCES\]([\s\S]*?)\[\/REFERENCES\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed.map((r: Omit<Reference, "id">, i: number) => ({
      ...r,
      id: `ref-${Date.now()}-${i}`,
    }));
  } catch {
    return null;
  }
}

function parseMockupHtml(text: string): string | null {
  const match = text.match(/```html\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

function parseNewDesignHtml(text: string): string | null {
  const match = text.match(/\[NEW_DESIGN\]\n?```html\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

type ContentChip = { label: string; done: boolean };
type ContentPart = { type: "text"; content: string } | { type: "chip"; chip: ContentChip };

const BLOCK_RULES = [
  { complete: /\[NEW_DESIGN\]\n?```html\n[\s\S]*?\n```/, partial: /\[NEW_DESIGN\][\s\S]*$/, doneLabel: "새 목업 생성됨", pendingLabel: "새 목업 생성 중..." },
  { complete: /```html\n[\s\S]*?\n```/, partial: /```html[\s\S]*$/, doneLabel: "목업 수정됨", pendingLabel: "목업 수정 중..." },
  { complete: /```presentation\n[\s\S]*?\n```/, partial: /```presentation[\s\S]*$/, doneLabel: "피치덱 생성됨", pendingLabel: "피치덱 생성 중..." },
  { complete: /\[REFERENCES\][\s\S]*?\[\/REFERENCES\]/, partial: /\[REFERENCES\][\s\S]*$/, doneLabel: "레퍼런스 추가됨", pendingLabel: "레퍼런스 검색 중..." },
  { complete: /\[IDEAS\][\s\S]*?\[\/IDEAS\]/, partial: /\[IDEAS\][\s\S]*$/, doneLabel: "아이디어 저장됨", pendingLabel: "아이디어 정리 중..." },
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
    parts.push({ type: "chip", chip: { label: earliest.label, done: earliest.done } });
    remaining = remaining.slice(earliest.index + earliest.matchStr.length);
  }

  return parts;
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

const ARTBOARD_WIDTH = 1280;
const ARTBOARD_HEIGHT = 900;
const ARTBOARD_GAP = 120;

const ideaTabs = [
  { id: "idea", label: "Idea" },
  { id: "mockup", label: "Mockup" },
  { id: "presentation", label: "Presentation" },
];

export default function MainScreenPage() {
  const { missionId } = useParams<{ missionId: string }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [presentationHtml, setPresentationHtml] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionBrief, setMissionBrief] = useState("");
  const [activeIdeaTab, setActiveIdeaTab] = useState("idea");
  const [userId, setUserId] = useState<string | null>(null);

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);

  // Keep refs in sync
  useEffect(() => { canvasOffsetRef.current = canvasOffset; }, [canvasOffset]);
  useEffect(() => { canvasScaleRef.current = canvasScale; }, [canvasScale]);
  useEffect(() => { artboardsRef.current = artboards; }, [artboards]);

  // Auth state
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      setUserId(user?.uid ?? null);
    });
  }, []);

  // Load session from Firestore
  useEffect(() => {
    if (!userId || !missionId) return;
    const ref = doc(db, "sessions", userId, "missions", missionId);
    getDoc(ref).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.messages) setMessages(data.messages);
      if (data.artboards && data.artboards.length > 0) {
        setArtboards(data.artboards);
        setActiveArtboardId(data.artboards[data.artboards.length - 1].id);
        setActiveIdeaTab("mockup");
      } else if (data.mockupHtml) {
        // backward compat: migrate old single mockupHtml
        const board: Artboard = { id: crypto.randomUUID(), html: data.mockupHtml, label: "Design 1", x: 0, y: 0 };
        setArtboards([board]);
        setActiveArtboardId(board.id);
        setActiveIdeaTab("mockup");
      }
      if (data.presentationHtml) setPresentationHtml(data.presentationHtml);
      if (data.references) setReferences(data.references);
      if (data.ideas) setIdeas(data.ideas);
      if (data.missionTitle) setMissionTitle(data.missionTitle);
      if (data.missionBrief) setMissionBrief(data.missionBrief);
    });
  }, [userId, missionId]);

  // Save session to Firestore (debounced to avoid write storms during streaming)
  useEffect(() => {
    if (!userId || !missionId || (messages.length === 0 && artboards.length === 0 && !presentationHtml && references.length === 0 && ideas.length === 0 && !missionTitle && !missionBrief)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ref = doc(db, "sessions", userId, "missions", missionId);
      setDoc(ref, { messages, artboards, presentationHtml, references, ideas, missionTitle, missionBrief, updatedAt: Date.now() }, { merge: true });
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [userId, missionId, messages, artboards, presentationHtml, references, ideas, missionTitle, missionBrief]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for element selection from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "vda-element-selected") {
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
    const boards = artboardsRef.current;
    if (boards.length === 0) return;
    const { clientWidth, clientHeight } = canvas;
    const minX = Math.min(...boards.map(a => a.x));
    const minY = Math.min(...boards.map(a => a.y));
    const maxX = Math.max(...boards.map(a => a.x + ARTBOARD_WIDTH));
    const maxY = Math.max(...boards.map(a => a.y + ARTBOARD_HEIGHT));
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

  const sectionRefs: Record<string, React.RefObject<HTMLElement | null>> = {
    idea: ideaSectionRef,
    mockup: mockupSectionRef,
    presentation: presentationSectionRef,
  };

  const scrollToSection = (id: string) => {
    setActiveIdeaTab(id);
    setTimeout(() => sectionRefs[id]?.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
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

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsLoading(true);

    const activeBoard = artboards.find(a => a.id === activeArtboardId) ?? artboards[artboards.length - 1] ?? null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
          mockupHtml: activeBoard?.html || undefined,
          selectedElement: selectedElement || undefined,
          missionTitle: missionTitle || undefined,
          missionBrief: missionBrief || undefined,
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
      const parsedRefs = parseReferences(fullText);
      if (parsedRefs) setReferences(parsedRefs);

      const parsedIdeas = parseIdeas(fullText);
      if (parsedIdeas) {
        setIdeas((prev) => [...prev, ...parsedIdeas]);
        setActiveIdeaTab("idea");
        setTimeout(() => ideaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }

      const newDesignHtml = parseNewDesignHtml(fullText);
      const editHtml = !newDesignHtml ? parseMockupHtml(fullText) : null;

      if (newDesignHtml) {
        const newId = crypto.randomUUID();
        setArtboards(prev => {
          const last = prev[prev.length - 1];
          return [...prev, {
            id: newId,
            html: newDesignHtml,
            label: `Design ${prev.length + 1}`,
            x: last ? last.x + ARTBOARD_WIDTH + ARTBOARD_GAP : 0,
            y: 0,
          }];
        });
        setActiveArtboardId(newId);
        setActiveIdeaTab("mockup");
        setSelectedElement(null);
        setTimeout(() => mockupSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } else if (editHtml) {
        const targetId = activeArtboardId ?? artboards[artboards.length - 1]?.id;
        setArtboards(prev => prev.map(a => a.id === targetId ? { ...a, html: editHtml } : a));
        setActiveIdeaTab("mockup");
        setSelectedElement(null);
        setTimeout(() => mockupSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }

      const parsedPresentation = parsePresentationHtml(fullText);
      if (parsedPresentation) {
        setPresentationHtml(parsedPresentation);
        setActiveIdeaTab("presentation");
        setTimeout(() => presentationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "오류가 발생했습니다. 다시 시도해주세요." } : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading, messages, artboards, activeArtboardId, selectedElement, ideas]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearSelectedElement = () => setSelectedElement(null);

  const activeArtboard = artboards.find(a => a.id === activeArtboardId) ?? artboards[artboards.length - 1] ?? null;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">Week · {missionId}</p>
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
            <p className="text-xl font-semibold text-slate-900">Mission</p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={missionTitle}
                onChange={e => setMissionTitle(e.target.value)}
                placeholder="미션 제목을 입력하세요"
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              />
              <textarea
                value={missionBrief}
                onChange={e => setMissionBrief(e.target.value)}
                placeholder="미션 브리핑을 입력하세요. 목표, 대상 사용자, 주요 요구사항 등을 자유롭게 작성하면 에이전트가 참고합니다."
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              />
            </div>
          </div>

          {/* Reference */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <p className="text-xl font-semibold text-slate-900">Reference</p>
            {references.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                에이전트에게 "레퍼런스 찾아줘"라고 말하면 여기에 표시됩니다.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {references.map((card) => {
                  const domain = card.url
                    ? card.url.replace(/^https?:\/\//, "").split("/")[0]
                    : null;
                  const thumbnailSrc = domain ? `https://logo.clearbit.com/${domain}` : null;
                  return (
                    <div key={card.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                        {thumbnailSrc ? (
                          <img
                            src={thumbnailSrc}
                            alt={card.title}
                            className="h-16 w-16 object-contain"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                              (e.currentTarget.parentElement as HTMLElement).innerHTML =
                                `<span class="text-xs text-slate-400">${card.title}</span>`;
                            }}
                          />
                        ) : (
                          <span className="text-xs text-slate-400">{card.title}</span>
                        )}
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">{card.title}</p>
                      <p className="mt-2 text-xs text-slate-500">{card.description}</p>
                      <span className="mt-3 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {card.tag}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Idea / Mockup / Presentation */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex gap-4">
              {/* Tab sidebar */}
              <div className="sticky top-4 flex flex-col space-y-2 self-start text-sm text-slate-600">
                {ideaTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => scrollToSection(tab.id)}
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

              {/* Sections — always rendered, tabs scroll to them */}
              <div className="flex-1 space-y-10">
                <section ref={ideaSectionRef} className="space-y-3 scroll-mt-4">
                  <p className="text-lg font-semibold text-slate-900">Idea</p>
                  {ideas.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                      에이전트에게 "아이디어 정리해줘"라고 말하면 여기에 저장됩니다.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {ideas.map((idea) => (
                        <div key={idea.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-900">{idea.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{idea.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section ref={mockupSectionRef} className="space-y-3 scroll-mt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-lg font-semibold text-slate-900">Mockup</p>
                      {artboards.length > 0 && (
                        <div className="flex items-center gap-2">
                          {selectedElement && (
                            <span className="flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                              {selectedElement.selector} 선택됨
                              <button onClick={clearSelectedElement} className="ml-1 text-indigo-400 hover:text-indigo-600">✕</button>
                            </span>
                          )}
                          <button onClick={fitToCanvas} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Fit</button>
                          <button onClick={() => setCanvasScale(s => Math.min(s * 1.2, 4))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">+</button>
                          <button onClick={() => setCanvasScale(s => Math.max(s * 0.8, 0.1))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">−</button>
                          <span className="w-10 text-center text-xs text-slate-400">{Math.round(canvasScale * 100)}%</span>
                          <button
                            onClick={() => {
                              const html = activeArtboard?.html;
                              if (!html) return;
                              const blob = new Blob([html], { type: "text/html" });
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
                        </div>
                      )}
                    </div>

                    {artboards.length > 0 ? (
                      <div
                        ref={canvasRef}
                        className="relative h-150 w-full overflow-hidden rounded-2xl select-none"
                        style={{
                          backgroundColor: "#1a1a1a",
                          backgroundImage: "radial-gradient(circle, #383838 1px, transparent 1px)",
                          backgroundSize: "20px 20px",
                          cursor: isDragging ? "grabbing" : "grab",
                        }}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                      >
                        {artboards.map(artboard => {
                          const screenX = canvasOffset.x + artboard.x * canvasScale;
                          const screenY = canvasOffset.y + artboard.y * canvasScale;
                          const isActive = artboard.id === activeArtboardId;
                          return (
                            <div key={artboard.id} style={{ pointerEvents: isDragging ? "none" : "auto" }}>
                              {/* Label */}
                              <div
                                style={{
                                  position: "absolute",
                                  left: screenX,
                                  top: screenY - 22,
                                  color: isActive ? "#a5b4fc" : "#888",
                                  fontSize: 11,
                                  fontWeight: isActive ? 600 : 400,
                                  whiteSpace: "nowrap",
                                  userSelect: "none",
                                }}
                              >
                                {artboard.label}
                              </div>
                              {/* Artboard */}
                              <div
                                style={{
                                  position: "absolute",
                                  left: screenX,
                                  top: screenY,
                                  transform: `scale(${canvasScale})`,
                                  transformOrigin: "0 0",
                                  width: ARTBOARD_WIDTH,
                                  height: ARTBOARD_HEIGHT,
                                  borderRadius: 12,
                                  overflow: "hidden",
                                  outline: isActive ? "2px solid #6366f1" : "2px solid transparent",
                                  outlineOffset: 3,
                                  boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                                }}
                                onClick={() => setActiveArtboardId(artboard.id)}
                              >
                                <iframe
                                  srcDoc={injectSelectionScript(artboard.html, artboard.id)}
                                  sandbox="allow-scripts"
                                  style={{ width: ARTBOARD_WIDTH, height: ARTBOARD_HEIGHT, border: "none", display: "block" }}
                                  title={artboard.label}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                        에이전트에게 "목업 만들어줘"라고 말하면 여기에 표시됩니다.
                      </div>
                    )}
                  </section>

                <section ref={presentationSectionRef} className="space-y-3 scroll-mt-4">
                  <p className="text-lg font-semibold text-slate-900">Presentation</p>
                  {presentationHtml ? (
                    <iframe
                      srcDoc={presentationHtml}
                      sandbox="allow-scripts allow-same-origin"
                      className="h-125 w-full rounded-2xl border border-slate-200 bg-white"
                      title="Presentation preview"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
                      에이전트에게 "피치덱 만들어줘"라고 말하면 여기에 표시됩니다.
                    </div>
                  )}
                </section>
              </div>
            </div>
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
                  {["레퍼런스 찾아줘", "목업 만들어줘", "이 버튼 색상 바꿔줘"].map((hint) => (
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
                    msg.content
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
                            <div key={i} className="flex items-center gap-1.5 text-xs text-slate-500">
                              {part.chip.done ? (
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              ) : (
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                              )}
                              {part.chip.label}
                            </div>
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
            {selectedElement && (
              <div className="mb-2 flex items-center justify-between rounded-xl bg-indigo-50 px-3 py-2 text-xs">
                <span className="font-medium text-indigo-600">
                  선택된 요소: <code className="font-mono">{selectedElement.selector}</code>
                </span>
                <button onClick={clearSelectedElement} className="text-indigo-400 hover:text-indigo-600">✕</button>
              </div>
            )}
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
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || isLoading}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
