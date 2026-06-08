import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type ToolActionChipData = {
  label: string;
  done: boolean;
  failed?: boolean;
  code?: string;
};

type ToolActionChipProps = {
  chipKey: string;
  chip: ToolActionChipData;
  expanded: boolean;
  onToggle: (key: string) => void;
};

export function ToolActionChip({
  chipKey,
  chip,
  expanded,
  onToggle,
}: ToolActionChipProps) {
  const hasCode = !!chip.code;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/45 text-xs">
      <button
        type="button"
        onClick={() => hasCode && onToggle(chipKey)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          hasCode ? "cursor-pointer hover:bg-muted" : "cursor-default",
        )}
        aria-expanded={hasCode ? expanded : undefined}
      >
        {chip.failed ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
        ) : chip.done ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
        )}
        <span
          className={cn(
            "flex-1 text-muted-foreground",
            chip.failed && "font-semibold text-rose-600",
          )}
        >
          {chip.label}
        </span>
        {hasCode &&
          (expanded ? (
            <CaretUpIcon size={12} className="text-muted-foreground" />
          ) : (
            <CaretDownIcon size={12} className="text-muted-foreground" />
          ))}
      </button>
      {expanded && hasCode && (
        <pre className="max-h-64 overflow-y-auto border-t border-border bg-slate-950 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-slate-100">
          {chip.code}
        </pre>
      )}
    </div>
  );
}
