import type { ReactNode } from "react";

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
      className={`relative flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white ${
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
