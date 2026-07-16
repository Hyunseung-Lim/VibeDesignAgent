import ReactMarkdown from "react-markdown";
import type { ComponentProps } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { ToolActionChip, type ToolActionChipData } from "./tool-action-chip";
import { Spinner } from "@/components/ui/spinner";
import type {
  ChatComposerCommand,
  ChatComposerMention,
} from "@/lib/session/chat-composer";

export type ChatBubbleMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  citedElement?: {
    selector: string;
  } | null;
  citedElements?: { selector: string }[] | null;
  citedReferences?: { id: string; title: string; imageUrl?: string }[] | null;
  citedTexts?: string[] | null;
  styleImage?: { dataUrl: string; name?: string } | null;
  composerCommand?: ChatComposerCommand | null;
  composerMention?: ChatComposerMention | null;
  error?: string;
};

export type AssistantFeedbackVote = "good" | "bad";

export type ChatContentPart =
  | { type: "text"; content: string }
  | { type: "chip"; chip: ToolActionChipData };

type ChatBubbleProps = {
  message: ChatBubbleMessage;
  contentParts: ChatContentPart[];
  visibleChatPhases: string[];
  isStreaming: boolean;
  isTurnSelected: boolean;
  isChatPhaseExpanded: boolean;
  expandedChipKeys: Set<string>;
  markdownComponents: ComponentProps<typeof ReactMarkdown>["components"];
  remarkPlugins: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
  hasTurnMemory: boolean;
  hasRawPrompt: boolean;
  hasRetrievalLog: boolean;
  feedbackVote?: AssistantFeedbackVote | null;
  canGiveFeedback?: boolean;
  isReferenceLoading?: boolean;
  onToggleChatPhases: () => void;
  onToggleChip: (key: string) => void;
  onToggleTurnMemory: () => void;
  onShowRawPrompt: () => void;
  onOpenFeedback?: (vote: AssistantFeedbackVote) => void;
};

function TypingDots() {
  return (
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
  );
}

function ChatPhaseMarker({
  phase,
  active,
}: {
  phase: string;
  active: boolean;
}) {
  return (
    <div
      role={active ? "status" : undefined}
      aria-live={active ? "polite" : undefined}
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
        active
          ? "border-slate-200 bg-white text-slate-700"
          : "border-transparent bg-transparent text-slate-400"
      }`}
    >
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
          active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"
        }`}
      >
        {active ? (
          <Circle className="size-2 animate-pulse fill-current" />
        ) : (
          <Check className="size-2.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-none">
        {phase}
      </span>
    </div>
  );
}

function formatMessageTime(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestamp));
}

export function ChatBubble({
  message,
  contentParts,
  visibleChatPhases,
  isStreaming,
  isTurnSelected,
  isChatPhaseExpanded,
  expandedChipKeys,
  markdownComponents,
  remarkPlugins,
  hasTurnMemory,
  hasRawPrompt,
  hasRetrievalLog,
  feedbackVote = null,
  canGiveFeedback = false,
  isReferenceLoading = false,
  onToggleChatPhases,
  onToggleChip,
  onToggleTurnMemory,
  onShowRawPrompt,
  onOpenFeedback,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const sentTime = isUser ? formatMessageTime(message.createdAt) : "";
  const visibleComposerCommand =
    message.composerCommand?.id === "fetch_references"
      ? null
      : message.composerCommand;
  const bubbleClassName = isUser
    ? "overflow-hidden rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-sm"
    : isTurnSelected
      ? "overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/80 px-4 py-3 text-slate-700 shadow-sm"
      : message.error
        ? "overflow-hidden rounded-2xl border border-red-100 bg-red-50/30 px-4 py-3 text-slate-700"
        : "px-1 py-1 text-slate-700";

  return (
    <div
      className={`group relative flex min-w-0 flex-col ${
        isUser ? "items-end" : "items-start"
      }`}
    >
      <div
        className={`min-w-0 max-w-[85%] text-sm leading-relaxed ${bubbleClassName}`}
      >
        {isUser ? (
          <div className="space-y-1.5">
            {(visibleComposerCommand || message.composerMention) && (
              <div className="flex flex-wrap justify-end gap-1">
                {visibleComposerCommand && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white/90">
                    {visibleComposerCommand.label}
                  </span>
                )}
                {message.composerMention && (
                  <span className="rounded-full bg-indigo-300/20 px-2 py-0.5 text-xs font-medium text-indigo-100">
                    @{message.composerMention.label}
                  </span>
                )}
              </div>
            )}
            {message.styleImage && (
              <div className="flex justify-end">
                <img
                  src={message.styleImage.dataUrl}
                  alt={message.styleImage.name || "첨부 이미지"}
                  className="max-h-44 max-w-full rounded-lg object-contain"
                />
              </div>
            )}
            {(message.citedElements?.length
              ? message.citedElements
              : message.citedElement
                ? [message.citedElement]
                : []
            ).length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {(message.citedElements?.length
                  ? message.citedElements
                  : [message.citedElement!]
                ).map((element, index) => (
                  <span
                    key={`${element.selector}-${index}`}
                    className="flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs text-white/80"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                    {element.selector}
                  </span>
                ))}
              </div>
            )}
            {message.citedReferences &&
              message.citedReferences.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {message.citedReferences.map((reference) => (
                    <span
                      key={reference.id}
                      className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/80"
                    >
                      {reference.imageUrl && (
                        <img
                          src={reference.imageUrl}
                          alt=""
                          className="h-3.5 w-5 rounded object-cover opacity-80"
                        />
                      )}
                      <span className="max-w-32 truncate">
                        {reference.title}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            {message.citedTexts && message.citedTexts.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {message.citedTexts.map((text, index) => (
                  <span
                    key={index}
                    className="max-w-48 truncate rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/80"
                  >
                    &quot;{text}&quot;
                  </span>
                ))}
              </div>
            )}
            <div>{message.content}</div>
          </div>
        ) : message.content || visibleChatPhases.length > 0 || message.error ? (
          <div className="space-y-2">
            {visibleChatPhases.length > 0 && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-2 text-xs">
                <button
                  type="button"
                  onClick={onToggleChatPhases}
                  className="flex w-full items-center justify-between gap-3 text-left text-[11px] font-medium text-slate-500 transition hover:text-slate-700"
                >
                  <span className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-slate-300" />
                    처리 과정 {visibleChatPhases.length}개
                  </span>
                  {isChatPhaseExpanded ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
                {isChatPhaseExpanded && (
                  <div className="mt-2 space-y-1">
                    {visibleChatPhases.map((phase, phaseIndex, phases) => {
                      const isActive =
                        isStreaming && phaseIndex === phases.length - 1;
                      return (
                        <ChatPhaseMarker
                          key={`${message.id}-${phase}`}
                          phase={phase}
                          active={isActive}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {contentParts.map((part, index) =>
              part.type === "text" ? (
                <ReactMarkdown
                  key={index}
                  remarkPlugins={remarkPlugins}
                  components={markdownComponents}
                >
                  {part.content}
                </ReactMarkdown>
              ) : (
                <ToolActionChip
                  key={index}
                  chipKey={`${message.id}-${index}`}
                  chip={part.chip}
                  expanded={expandedChipKeys.has(`${message.id}-${index}`)}
                  onToggle={onToggleChip}
                />
              ),
            )}
            {message.error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
              >
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="flex-1">{message.error}</span>
              </div>
            )}
            {isReferenceLoading && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                <Spinner className="size-3.5" />
                레퍼런스 검색 중...
              </div>
            )}
            {isStreaming && <TypingDots />}
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-slate-400">
            <TypingDots />
          </span>
        )}

        {!isUser && (hasTurnMemory || hasRawPrompt || hasRetrievalLog) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hasTurnMemory && (
              <button
                type="button"
                onClick={onToggleTurnMemory}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  isTurnSelected
                    ? "border-violet-300 bg-violet-100 text-violet-600"
                    : "border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600"
                }`}
                title="이 인터랙션에서 생성된 기억"
              >
                <Brain className="size-3" />
                기억 보기
              </button>
            )}
            {(hasRawPrompt || hasRetrievalLog) && (
              <button
                type="button"
                onClick={onShowRawPrompt}
                className="flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:border-indigo-200 hover:bg-indigo-100"
              >
                Prompt 보기
              </button>
            )}
          </div>
        )}

        {!isUser && (canGiveFeedback || feedbackVote) && (
          <div className="mt-2 flex items-center gap-1">
            {(["good", "bad"] as const).map((vote) => {
              const active = feedbackVote === vote;
              const Icon = vote === "good" ? ThumbsUp : ThumbsDown;
              const label = vote === "good" ? "좋아요" : "싫어요";
              return (
                <button
                  key={vote}
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  title={label}
                  disabled={!canGiveFeedback}
                  onClick={() => onOpenFeedback?.(vote)}
                  className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-full border transition ${
                    active
                      ? "border-slate-700 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                  } disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-400`}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {sentTime && (
        <div className="pointer-events-none absolute right-1 top-full mt-1 px-1 text-[11px] font-medium text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {sentTime}
        </div>
      )}
    </div>
  );
}
