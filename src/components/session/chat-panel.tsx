import type { ReactNode } from "react";

type ChatPanelTab = "chat" | "memory";

type ChatPanelProps = {
  showReviewTabs: boolean;
  activeTab: ChatPanelTab;
  messageCount: number;
  memoryChangeCount: number;
  showScrollToBottom: boolean;
  onTabChange: (tab: ChatPanelTab) => void;
  onScrollToBottom: () => void;
  children: ReactNode;
};

export function ChatPanel({
  showReviewTabs,
  activeTab,
  messageCount,
  memoryChangeCount,
  showScrollToBottom,
  onTabChange,
  onScrollToBottom,
  children,
}: ChatPanelProps) {
  return (
    <aside className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white">
      {showReviewTabs && (
        <div className="flex shrink-0 border-b border-slate-200">
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
          <button
            type="button"
            onClick={() => onTabChange("memory")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition ${
              activeTab === "memory"
                ? "border-b-2 border-slate-900 text-slate-900"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            메모리 변화
            <span className="text-xs text-slate-300">
              {memoryChangeCount}
            </span>
          </button>
        </div>
      )}
      {children}
      {showScrollToBottom && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-slate-700"
        >
          ↓
        </button>
      )}
    </aside>
  );
}
