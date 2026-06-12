"use client";

import { useEffect, type ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";

interface SessionMemoryDiffProps {
  /** before/after phase toggle control rendered in the header. */
  phaseToggle?: ReactNode;
  onClose: () => void;
  /** Diff body: cluster list + graph + detail panel (mirrors the /agent layout). */
  children: ReactNode;
}

/** Full-screen overlay comparing the memory graph before and after a session. */
export function SessionMemoryDiff({
  phaseToggle,
  onClose,
  children,
}: SessionMemoryDiffProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header — same structure as the agent page header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="메모리 변화 전체 보기 닫기"
          >
            <XIcon size={18} />
          </button>
          <div>
            <p className="text-base font-semibold text-slate-900">
              메모리 변화 전체 보기
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              세션 이전과 이후의 전체 memory node 상태를 비교합니다.
            </p>
          </div>
        </div>
        {phaseToggle}
      </header>
      {/* Body — cluster list + graph + detail panel, same as the agent page */}
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
