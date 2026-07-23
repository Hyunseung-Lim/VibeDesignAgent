"use client";

import { type ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";

interface SessionMemoryDiffProps {
  /** Right-aligned header controls (e.g. cluster variant tabs). */
  headerActions?: ReactNode;
  /** Sub-bar rendered below the header, mirroring /agent's filter bar position. */
  toolbar?: ReactNode;
  onClose: () => void;
  /** Diff body: cluster list + graph + detail panel (mirrors the /agent layout). */
  children: ReactNode;
}

/** Full-screen overlay comparing the memory graph before and after a session. */
export function SessionMemoryDiff({
  headerActions,
  toolbar,
  onClose,
  children,
}: SessionMemoryDiffProps) {
  // 의도적으로 ESC 닫기를 두지 않는다. 이 오버레이는 순간적인 모달이 아니라
  // 리뷰 작업 공간이고, window 전역 Escape 리스너는 답변 입력 중 IME 취소,
  // mention 모드 종료, 내부 dialog 닫기용 ESC까지 가로채 리뷰 전체를 닫아
  // 버렸다(15.332). 닫기는 헤더의 돌아가기 버튼으로만 한다.
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header — same structure as the agent page header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            <ArrowLeftIcon size={14} />
            리뷰 페이지로 돌아가기
          </button>
          <p className="text-base font-semibold text-slate-900">메모리 리뷰</p>
        </div>
        {headerActions}
      </header>
      {/* Sub-bar below the header (phase toggle), mirroring /agent's filter bar. */}
      {toolbar ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-6 py-2.5 lg:px-10">
          {toolbar}
        </div>
      ) : null}
      {/* Body — cluster list + graph + detail panel, same as the agent page */}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50 p-4">
        {children}
      </div>
    </div>
  );
}
