import { Badge } from "@/components/ui/badge";

type LobbySummaryProps = {
  total: number;
  waiting: number;
  active: number;
  completed: number;
  timedOut: number;
};

export function LobbySummary({
  total,
  waiting,
  active,
  completed,
  timedOut,
}: LobbySummaryProps) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-panel">
        <p className="text-xs font-semibold text-muted-foreground">전체</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {total}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-panel">
        <p className="text-xs font-semibold text-muted-foreground">대기</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {waiting}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-panel">
        <p className="text-xs font-semibold text-muted-foreground">진행중</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
          {active}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-panel">
        <p className="text-xs font-semibold text-muted-foreground">완료</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
          {completed}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">시간 초과</p>
          {timedOut > 0 && <Badge variant="destructive">확인</Badge>}
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">
          {timedOut}
        </p>
      </div>
    </section>
  );
}
