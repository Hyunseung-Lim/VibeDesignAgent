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
  onRegenerate?: () => void;
  mentionMode?: boolean;
  onMentionCluster?: (cluster: MemoryCluster) => void;
};

export function MemoryClusterList({
  clusters,
  selectedClusterId,
  generatedAt,
  hasStaleCache,
  isRegenerating,
  onSelectCluster,
  onRegenerate,
  mentionMode = false,
  onMentionCluster,
}: MemoryClusterListProps) {
  return (
    <aside className="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card p-3 xl:w-48">
      <div className="mb-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {clusters.length}개 클러스터
          </p>
          {generatedAt ? (
            <p className="text-[10px] text-muted-foreground/70">
              {formatDate(generatedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/60">
            클러스터 목록
          </span>
          {onRegenerate && (
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
          )}
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
            onClick={() => {
              onSelectCluster(cluster.id);
              if (mentionMode) onMentionCluster?.(cluster);
            }}
            className={`w-full rounded-md border px-2.5 py-2.5 text-left transition ${
              selected
                ? mentionMode
                  ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-100"
                  : "border-slate-300 bg-slate-100 shadow-sm"
                : mentionMode
                  ? "border-amber-100 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-50"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-background"
            }`}
          >
            <div className="space-y-1">
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 truncate text-xs font-semibold leading-5 text-foreground">
                  {cluster.label}
                </p>
              </div>
              <Badge
                variant="secondary"
                className="ml-4 rounded-full px-2 py-0 text-[10px]"
              >
                {mentionMode ? "멘션 선택" : cluster.count}
              </Badge>
            </div>
          </button>
        );
      })}
    </aside>
  );
}
