"use client";

interface RetrievedMemoryBadgeProps {
  count: number;
  onClick: () => void;
}

/** Pill button shown under an assistant bubble when memories were retrieved for the turn. */
export function RetrievedMemoryBadge({
  count,
  onClick,
}: RetrievedMemoryBadgeProps) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
    >
      참고 메모리 {count}개
    </button>
  );
}
