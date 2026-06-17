import { BrainIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type TimelineActivityEventCardProps = {
  label: string;
  detail: string;
};

type TimelineMemoryEventCardProps = TimelineActivityEventCardProps & {
  selected: boolean;
  onToggle: () => void;
};

export function TimelineActivityEventCard({
  label,
  detail,
}: TimelineActivityEventCardProps) {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[85%] rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
        <div className="min-w-0">
          <p className="font-semibold text-foreground/75">{label}</p>
          <p className="mt-1 line-clamp-2 text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}

export function TimelineMemoryEventCard({
  label,
  detail,
  selected,
  onToggle,
}: TimelineMemoryEventCardProps) {
  return (
    <div className="flex justify-center">
      <div
        className={`w-full max-w-[85%] rounded-lg border px-3 py-2.5 text-xs ${
          selected
            ? "border-violet-200 bg-violet-50"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground/75">{label}</p>
            <p className="mt-1 line-clamp-2 text-muted-foreground">{detail}</p>
          </div>
          <Button
            type="button"
            variant={selected ? "secondary" : "outline"}
            size="sm"
            onClick={onToggle}
            className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] ${
              selected ? "border-violet-200 bg-violet-100 text-violet-700" : ""
            }`}
            title="이 이벤트에서 생성된 기억"
          >
            <BrainIcon size={12} />
            기억 보기
          </Button>
        </div>
      </div>
    </div>
  );
}
