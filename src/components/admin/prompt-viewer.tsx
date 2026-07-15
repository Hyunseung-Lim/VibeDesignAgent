"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

type PromptViewerRetrievalMemory = {
  id: string;
  similarity?: number | null;
  weight?: number | null;
  semantic?: string | null;
  episodic?: string | null;
  input?: string | null;
  output?: string | null;
  source?: { missionId?: string | null } | null;
};

export type PromptViewerRetrievalLog = {
  id: string;
  interactionId?: string | null;
  createdAt?: number | null;
  query?: string | null;
  memoryCount?: number | null;
  retrievedCount?: number | null;
  retrievedMemories?: PromptViewerRetrievalMemory[];
  includedCurrentSetupMemoryCount?: number | null;
  includedCurrentSetupMemories?: PromptViewerRetrievalMemory[];
  profileItemCount?: number | null;
};

interface PromptViewerProps {
  turnId: string;
  rawPromptActual?: unknown;
  rawPrompt: unknown;
  rawPromptSanitization?: unknown;
  rawResponseMeta?: unknown;
  retrievalLog?: PromptViewerRetrievalLog | null;
  onClose: () => void;
}

function stringifyPromptJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "null";
}

type PromptBlock = {
  label: string;
  role: string;
  content: string;
};

// Older turns were stored without labels — infer the block name from each
// prompt builder's distinctive opening text (src/lib/prompts.ts).
const SYSTEM_BLOCK_PREFIXES: Array<[string, string]> = [
  ["You are a UI/UX design agent.", "basePrompt"],
  ["Current mission context:", "mission"],
  ["The user is currently working on this design brief:", "activeIdea"],
  ["Applied 디자인 스타일", "designSpec"],
  ["Current mockup HTML exists.", "mockupHtml"],
  ["Memory retrieved for this turn.", "retrievalMemory"],
  ["The user has cited the following text excerpts", "citedTexts"],
  ["The user has selected this exact element", "selectedElement"],
  ["[Selected element", "selectedElement"],
  ["The user has cited the following reference URLs", "citedReferences"],
  ["The user is citing these references", "citedReferences"],
  ["The user explicitly mentioned an existing workspace artifact.", "mentionedArtifact"],
  ["The user explicitly selected the composer command", "requestedCommand"],
  ["The most recent user message is the current request", "currentRequest"],
];

function inferSystemBlockLabel(content: string) {
  const trimmed = content.trimStart();
  for (const [prefix, label] of SYSTEM_BLOCK_PREFIXES) {
    if (trimmed.startsWith(prefix)) return label;
  }
  if (/\bAction instruction\b|\[CREATE_NOTE|\[GENERATE_MOCKUP|Action rule/i.test(trimmed.slice(0, 400))) {
    return "actionInstruction";
  }
  return "system";
}

// The stored raw prompt is [...systemMessages, ...builtMessages]; each entry
// carries a block label (basePrompt, mission, mockupHtml, ...) since 15.263.
// Older turns have no labels — infer from content, then fall back to the role.
function promptBlocksFrom(value: unknown): PromptBlock[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const blocks: PromptBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const content = record.content;
    if (typeof content !== "string") return null;
    const role = typeof record.role === "string" ? record.role : "unknown";
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label
        : role === "system"
          ? inferSystemBlockLabel(content)
          : "conversation";
    blocks.push({ label, role, content });
  }
  return blocks;
}

const BLOCK_LABEL_STYLES: Record<string, string> = {
  basePrompt: "bg-slate-900 text-white",
  mission: "bg-emerald-100 text-emerald-700",
  activeIdea: "bg-teal-100 text-teal-700",
  designSpec: "bg-violet-100 text-violet-700",
  mockupHtml: "bg-orange-100 text-orange-700",
  retrievalMemory: "bg-sky-100 text-sky-700",
  citedTexts: "bg-amber-100 text-amber-700",
  citedReferences: "bg-amber-100 text-amber-700",
  referencePreference: "bg-amber-100 text-amber-700",
  selectedElement: "bg-indigo-100 text-indigo-700",
  mentionedArtifact: "bg-fuchsia-100 text-fuchsia-700",
  requestedCommand: "bg-fuchsia-100 text-fuchsia-700",
  actionInstruction: "bg-rose-100 text-rose-700",
  currentRequest: "bg-rose-100 text-rose-700",
  conversation: "bg-slate-100 text-slate-600",
};

function blockLabelClass(label: string) {
  const key = label.split(" ")[0];
  return BLOCK_LABEL_STYLES[key] ?? "bg-slate-100 text-slate-600";
}

function PromptBlockCard({
  block,
  index,
}: {
  block: PromptBlock;
  index: number;
}) {
  // Big blobs (mockupHtml, base prompt) start collapsed so the block list
  // stays scannable; everything expands in place.
  const [expanded, setExpanded] = useState(block.content.length <= 1200);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-2 bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
      >
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
          {index + 1}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${blockLabelClass(block.label)}`}
        >
          {block.label}
        </span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400">
          {block.content.length.toLocaleString()} chars
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {expanded ? "접기" : "펼치기"}
        </span>
      </button>
      {expanded ? (
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word bg-white px-4 py-3 text-xs leading-relaxed text-slate-700">
          {block.content}
        </pre>
      ) : (
        <p className="truncate bg-white px-4 py-2 text-xs text-slate-400">
          {block.content.slice(0, 160)}
        </p>
      )}
    </section>
  );
}

function RetrievalMemoryCard({
  memory,
  tone = "slate",
}: {
  memory: PromptViewerRetrievalMemory;
  tone?: "slate" | "sky";
}) {
  return (
    <div
      className={
        tone === "sky"
          ? "rounded-xl border border-sky-100 bg-sky-50/50 p-3"
          : "rounded-xl border border-slate-200 bg-white p-3"
      }
    >
      <div
        className={`flex flex-wrap items-center gap-2 text-xs ${
          tone === "sky" ? "text-sky-500" : "text-slate-400"
        }`}
      >
        <span className="font-mono">{memory.id}</span>
        {memory.similarity != null && <span>similarity {memory.similarity}</span>}
        {memory.weight != null && <span>weight {memory.weight}</span>}
        {memory.source?.missionId && <span>mission {memory.source.missionId}</span>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {memory.semantic ||
          memory.episodic ||
          memory.input ||
          memory.output ||
          "내용 없음"}
      </p>
    </div>
  );
}

/** Admin-only modal: prompt blocks + retrieval log for a chat turn. */
export function PromptViewer({
  turnId,
  rawPromptActual,
  rawPrompt,
  rawPromptSanitization,
  rawResponseMeta,
  retrievalLog,
  onClose,
}: PromptViewerProps) {
  const [tab, setTab] = useState<"prompt" | "retrieval">("prompt");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const promptValue = rawPromptActual ?? rawPrompt;
  const blocks = promptBlocksFrom(promptValue);
  const systemBlocks = blocks?.filter((block) => block.role === "system") ?? [];
  const conversationBlocks =
    blocks?.filter((block) => block.role !== "system") ?? [];
  const retrievedMemories = retrievalLog?.retrievedMemories ?? [];
  const setupMemories = retrievalLog?.includedCurrentSetupMemories ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/25">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Prompt</p>
              <p className="mt-0.5 text-xs text-slate-400">turn {turnId}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
              {(["prompt", "retrieval"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  disabled={key === "retrieval" && !retrievalLog}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    tab === key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                  }`}
                >
                  {key === "prompt" ? "Prompt" : "Retrieval"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="prompt 닫기"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "prompt" ? (
            <div className="space-y-4">
              {blocks ? (
                <div className="space-y-5">
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      System context · {systemBlocks.length} blocks
                    </p>
                    <div className="space-y-2">
                      {systemBlocks.map((block, index) => (
                        <PromptBlockCard
                          key={`${block.label}-${index}`}
                          block={block}
                          index={index}
                        />
                      ))}
                    </div>
                  </section>
                  {conversationBlocks.length > 0 && (
                    <section>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Conversation · {conversationBlocks.length} messages
                      </p>
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                          {conversationBlocks.map((block, index) => (
                            <div
                              key={`conversation-${index}`}
                              className="flex items-start gap-2.5 px-4 py-2.5"
                            >
                              <span
                                className={`mt-0.5 w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ${
                                  block.role === "user"
                                    ? "bg-slate-900 text-white"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {block.role}
                              </span>
                              <pre className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-slate-700">
                                {block.content}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                    Actual prompt sent to model
                  </p>
                  <pre className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                    {stringifyPromptJson(promptValue)}
                  </pre>
                </section>
              )}
              <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                  Raw JSON · sanitization · response meta
                </summary>
                <div className="mt-3 space-y-4">
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                      Actual prompt JSON
                    </p>
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                      {stringifyPromptJson(promptValue)}
                    </pre>
                  </section>
                  {rawPromptActual != null && (
                    <section>
                      <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Sanitized copy
                      </p>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-white p-4 text-xs leading-relaxed text-slate-600">
                        {stringifyPromptJson(rawPrompt)}
                      </pre>
                    </section>
                  )}
                  {rawPromptSanitization != null && (
                    <section>
                      <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Sanitization
                      </p>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-white p-4 text-xs leading-relaxed text-slate-600">
                        {stringifyPromptJson(rawPromptSanitization)}
                      </pre>
                    </section>
                  )}
                  {rawResponseMeta != null && (
                    <section>
                      <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                        Response meta
                      </p>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-white p-4 text-xs leading-relaxed text-slate-600">
                        {stringifyPromptJson(rawResponseMeta)}
                      </pre>
                    </section>
                  )}
                </div>
              </details>
            </div>
          ) : retrievalLog ? (
            <div className="space-y-4 text-sm">
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-400">
                      Retrieved
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {retrievalLog.retrievedCount ?? retrievedMemories.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-400">
                      Current setup
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {retrievalLog.includedCurrentSetupMemoryCount ??
                        setupMemories.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-400">
                      Candidates
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {retrievalLog.memoryCount ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-400">
                      Before-session
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {retrievalLog.profileItemCount ?? 0}
                    </p>
                  </div>
                </div>
                {retrievalLog.query && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-500">Query</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-700">
                      {retrievalLog.query}
                    </pre>
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Retrieved memories
                </h3>
                <div className="mt-2 space-y-2">
                  {retrievedMemories.length > 0 ? (
                    retrievedMemories.map((memory) => (
                      <RetrievalMemoryCard key={memory.id} memory={memory} />
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                      검색된 메모리가 없습니다.
                    </p>
                  )}
                </div>
              </section>

              {setupMemories.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Current before-session setup
                  </h3>
                  <div className="mt-2 space-y-2">
                    {setupMemories.map((memory) => (
                      <RetrievalMemoryCard
                        key={memory.id}
                        memory={memory}
                        tone="sky"
                      />
                    ))}
                  </div>
                </section>
              )}

              <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                  Raw retrieval log JSON
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                  {stringifyPromptJson(retrievalLog)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
              이 턴의 retrieval log가 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
