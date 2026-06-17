import ReactMarkdown from "react-markdown";
import type { ComponentProps } from "react";
import { Brain, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { ToolActionChip, type ToolActionChipData } from "./tool-action-chip";
import { RetrievedMemoryBadge } from "@/components/memory/retrieved-memory-badge";
import { Spinner } from "@/components/ui/spinner";

export type ChatBubbleMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citedElement?: {
    selector: string;
  } | null;
  citedReferences?: { id: string; title: string; imageUrl?: string }[] | null;
  citedTexts?: string[] | null;
  styleImage?: { dataUrl: string; name?: string } | null;
  error?: string;
};

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
  adminMemoryCount: number;
  hasTurnMemory: boolean;
  hasRawPrompt: boolean;
  isReferenceLoading?: boolean;
  onToggleChatPhases: () => void;
  onToggleChip: (key: string) => void;
  onShowRetrievedMemory: () => void;
  onToggleTurnMemory: () => void;
  onShowRawPrompt: () => void;
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
  adminMemoryCount,
  hasTurnMemory,
  hasRawPrompt,
  isReferenceLoading = false,
  onToggleChatPhases,
  onToggleChip,
  onShowRetrievedMemory,
  onToggleTurnMemory,
  onShowRawPrompt,
}: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 max-w-[85%] overflow-hidden rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-slate-900 text-white"
            : isTurnSelected
              ? "border border-violet-200 bg-violet-50 text-slate-700"
              : "border border-slate-100 bg-slate-50 text-slate-700"
        }`}
      >
        {isUser ? (
          <div className="space-y-1.5">
            {message.styleImage && (
              <div className="flex justify-end">
                <img
                  src={message.styleImage.dataUrl}
                  alt={message.styleImage.name || "첨부 이미지"}
                  className="max-h-44 max-w-full rounded-lg object-contain"
                />
              </div>
            )}
            {message.citedElement && (
              <div className="flex justify-end">
                <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs text-white/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                  {message.citedElement.selector}
                </span>
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
              <div className="border-b border-slate-200 pb-2 text-xs">
                <button
                  type="button"
                  onClick={onToggleChatPhases}
                  className="flex items-center gap-1.5 font-medium text-slate-400 transition hover:text-slate-600"
                >
                  {isChatPhaseExpanded ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  처리 과정 {visibleChatPhases.length}개
                </button>
                {isChatPhaseExpanded && (
                  <div className="mt-2 space-y-1">
                    {visibleChatPhases.map((phase, phaseIndex, phases) => {
                      const isActive =
                        isStreaming && phaseIndex === phases.length - 1;
                      return (
                        <div
                          key={`${message.id}-${phase}`}
                          className={`flex items-center gap-1.5 ${
                            isActive
                              ? "font-medium text-slate-500"
                              : "text-slate-400"
                          }`}
                        >
                          <span
                            className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full ${
                              isActive ? "bg-slate-300" : "bg-slate-200"
                            }`}
                          >
                            {isActive ? (
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-600" />
                            ) : (
                              <span className="text-[8px] leading-none text-slate-500">
                                ✓
                              </span>
                            )}
                          </span>
                          {phase}
                        </div>
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

        {!isUser && adminMemoryCount > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <RetrievedMemoryBadge
              count={adminMemoryCount}
              onClick={onShowRetrievedMemory}
            />
          </div>
        )}

        {!isUser && hasTurnMemory && (
          <button
            type="button"
            onClick={onToggleTurnMemory}
            className={`mt-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
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

        {!isUser && hasRawPrompt && (
          <button
            type="button"
            onClick={onShowRawPrompt}
            className="mt-3 w-full rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-600 transition hover:border-indigo-200 hover:bg-indigo-100"
          >
            Raw prompt 보기
          </button>
        )}
      </div>
    </div>
  );
}
