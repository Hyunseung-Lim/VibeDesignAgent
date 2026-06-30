import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
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
  const statusTone = chip.failed
    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
    : chip.done
      ? "border-emerald-100 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-50"
      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
  const indicatorTone = chip.failed
    ? "bg-rose-100 text-rose-600"
    : chip.done
      ? "bg-emerald-100 text-emerald-600"
      : "bg-slate-900 text-white";
  const StatusIcon = chip.failed
    ? TriangleAlertIcon
    : chip.done
      ? CheckIcon
      : CircleIcon;

  return (
    <div className="space-y-1 text-xs">
      <button
        type="button"
        onClick={() => hasCode && onToggle(chipKey)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
          statusTone,
          hasCode ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={hasCode ? expanded : undefined}
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full",
            indicatorTone,
          )}
        >
          <StatusIcon
            className={cn(
              "size-2.5",
              !chip.done && !chip.failed && "animate-pulse fill-current",
            )}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] font-medium leading-none",
            chip.failed && "font-semibold",
          )}
        >
          {chip.label}
        </span>
        {hasCode &&
          (expanded ? (
            <ChevronUpIcon className="size-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          ))}
      </button>
      {expanded && hasCode && (
        <pre className="max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-slate-100">
          {chip.code}
        </pre>
      )}
    </div>
  );
}
