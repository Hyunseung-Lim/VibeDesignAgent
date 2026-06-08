import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MemoryCluster } from "./memory-cluster-types";
import { memoryClusterColor } from "./memory-cluster-colors";

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type MemoryClusterListProps = {
  clusters: MemoryCluster[];
  selectedClusterId: string | null;
  generatedAt: number | null;
  hasStaleCache: boolean;
  isRegenerating: boolean;
  onSelectCluster: (id: string) => void;
  onRegenerate: () => void;
};

export function MemoryClusterList({
  clusters,
  selectedClusterId,
  generatedAt,
  hasStaleCache,
  isRegenerating,
  onSelectCluster,
  onRegenerate,
}: MemoryClusterListProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {clusters.length}개 클러스터
        </p>
        <div className="flex items-center gap-2">
          {generatedAt ? (
            <p className="text-[10px] text-muted-foreground/70">
              {formatDate(generatedAt)}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="h-7 rounded-full px-2.5 text-[11px]"
          >
            {isRegenerating ? "생성 중..." : "재생성"}
          </Button>
        </div>
      </div>
      {hasStaleCache ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
          클러스터 캐시가 현재 기억과 일치하지 않습니다. 재생성을 실행해주세요.
        </p>
      ) : null}
      {clusters.map((cluster, index) => {
        const selected = selectedClusterId === cluster.id;
        const color = memoryClusterColor(index);
        return (
          <button
            key={cluster.id}
            type="button"
            onClick={() => onSelectCluster(cluster.id)}
            className={`w-full rounded-lg border px-3 py-3 text-left transition ${
              selected
                ? "border-slate-400 bg-slate-100 shadow-sm ring-2 ring-slate-200"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-background"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <p className="min-w-0 text-sm font-semibold text-foreground">
                  {cluster.label}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {selected ? (
                  <Badge
                    variant="secondary"
                    className="rounded-full border-slate-300 bg-slate-200 text-slate-700"
                  >
                    선택됨
                  </Badge>
                ) : null}
                <Badge variant="secondary" className="rounded-full">
                  {cluster.count}
                </Badge>
              </div>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {cluster.summary}
            </p>
          </button>
        );
      })}
    </aside>
  );
}
