import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

type ChatPanelTab = "before" | "chat";

type ChatPanelProps = {
  showReviewTabs: boolean;
  activeTab: ChatPanelTab;
  messageCount: number;
  beforeMemoryCount: number;
  showScrollToBottom: boolean;
  /** Explicit width in px (resizable). Falls back to w-full max-w-md when unset. */
  width?: number;
  onTabChange: (tab: ChatPanelTab) => void;
  onScrollToBottom: () => void;
  children: ReactNode;
};

export function ChatPanel({
  showReviewTabs,
  activeTab,
  messageCount,
  beforeMemoryCount,
  showScrollToBottom,
  width,
  onTabChange,
  onScrollToBottom,
  children,
}: ChatPanelProps) {
  return (
    <aside
      data-tour="chat-panel"
      style={width ? { width } : undefined}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white ${
        width ? "shrink-0" : "w-full max-w-md"
      }`}
    >
      {showReviewTabs && (
        <div className="shrink-0 border-b border-slate-200">
          <div className="flex">
            <button
              type="button"
              onClick={() => onTabChange("before")}
              className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition ${
                activeTab === "before"
                  ? "border-b-2 border-sky-600 text-sky-700"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              세션 이전
              <span className="text-xs text-slate-300">{beforeMemoryCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange("chat")}
              className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition ${
                activeTab === "chat"
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              채팅
              <span className="text-xs text-slate-300">{messageCount}</span>
            </button>
          </div>
        </div>
      )}
      {children}
      {/* 채팅 탭에서 스크롤이 바닥에서 떨어져 있을 때만 표시 — 세션 이전
          탭에서는 채팅 스크롤 영역이 hidden이라 버튼도 숨긴다. */}
      {showScrollToBottom && (!showReviewTabs || activeTab === "chat") && (
        <button
          type="button"
          onClick={onScrollToBottom}
          aria-label="맨 아래로 스크롤"
          className="absolute bottom-24 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_4px_14px_rgba(15,23,42,0.18)] transition hover:bg-slate-50 hover:text-slate-900"
        >
          <ChevronDownIcon size={18} aria-hidden />
        </button>
      )}
    </aside>
  );
}
