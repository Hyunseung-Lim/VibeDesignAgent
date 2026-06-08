import { cn } from "@/lib/utils";

type MemoryScoreBarProps = {
  value: number | null | undefined;
  label: string;
  colorClass: string;
};

export function MemoryScoreBar({
  value,
  label,
  colorClass,
}: MemoryScoreBarProps) {
  if (value == null || !Number.isFinite(value)) return null;

  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
