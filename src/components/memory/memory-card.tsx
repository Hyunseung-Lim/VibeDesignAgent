"use client";

import { cn } from "@/lib/utils";

interface MemoryCardProps {
  /** Highlighted (blue) style for memories that were referenced in-session. */
  referenced?: boolean;
  /** Status bar label, e.g. "세션 중 참고됨" / "세션 전 정보로 유지". */
  statusLabel: string;
  /** Main body text (memory summary). Used when `fields` is not provided. */
  summary: string;
  /** Optional labeled sections (e.g. Episodic / Semantic). When non-empty, these
   * render instead of `summary`. */
  fields?: Array<{ label: string; value: string }>;
  /** Pre-formatted strength label, e.g. "강함". */
  weightStrengthLabel?: string | null;
  /** Pre-formatted weight score, e.g. "0.82". */
  weightScoreLabel?: string | null;
  /** Pre-formatted weight delta, e.g. "+0.10". Positive deltas render blue. */
  weightDeltaLabel?: string | null;
  weightDeltaPositive?: boolean;
  onClick?: () => void;
}

export function MemoryCard({
  referenced = false,
  statusLabel,
  summary,
  fields,
  weightStrengthLabel,
  weightScoreLabel,
  weightDeltaLabel,
  weightDeltaPositive = false,
  onClick,
}: MemoryCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border text-left transition-[border-color,background-color]",
        referenced
          ? "border-blue-100 bg-blue-50 hover:border-blue-200 hover:bg-blue-100/60"
          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50",
      )}
    >
      {/* Status bar */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-t-xl border-b px-4 py-2",
          referenced
            ? "border-blue-100 bg-blue-100/50"
            : "border-slate-100 bg-slate-50",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            referenced ? "bg-blue-500" : "bg-sky-300",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "text-[10px] font-semibold",
            referenced ? "text-blue-600" : "text-sky-600",
          )}
        >
          {statusLabel}
        </span>
        {weightScoreLabel != null ? (
          <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-400">
            {weightStrengthLabel ? (
              <span className="text-slate-500">{weightStrengthLabel} </span>
            ) : null}
            weight {weightScoreLabel}
            {weightDeltaLabel ? (
              <span
                className={
                  weightDeltaPositive ? " text-blue-500" : " text-slate-400"
                }
              >
                {" "}
                {weightDeltaLabel}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* Card body */}
      <div className="px-4 py-3">
        {fields && fields.length > 0 ? (
          <div className="space-y-2.5">
            {fields.map((field) => (
              <div key={field.label}>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {field.label}
                </p>
                <p className="text-sm leading-relaxed text-slate-800">
                  {field.value}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-slate-800">{summary}</p>
        )}
      </div>
    </button>
  );
}
