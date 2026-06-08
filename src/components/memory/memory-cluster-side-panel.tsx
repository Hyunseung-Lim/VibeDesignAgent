import { Badge } from "@/components/ui/badge";
import type {
  ClusterGraphItem,
  MemoryCluster,
  MemoryItem,
} from "./memory-cluster-types";

type MemoryClusterSidePanelProps = {
  cluster: MemoryCluster | null;
  items: ClusterGraphItem[];
  memories: MemoryItem[];
  selectedMemoryId: string | null;
  onSelectMemory: (memoryId: string) => void;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWeight(weight: number | null | undefined) {
  if (weight == null || !Number.isFinite(weight)) return null;
  return `${Math.round(weight * 100)}%`;
}

function sourceLabel(sourceType: string | null | undefined) {
  if (sourceType === "profile") return "Before session";
  if (sourceType === "interaction") return "During session";
  return "Unknown source";
}

function sourceBadgeClass(sourceType: string | null | undefined) {
  if (sourceType === "profile") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (sourceType === "interaction") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function MemoryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="wrap-anywhere text-xs leading-relaxed text-foreground">
        {value}
      </p>
    </div>
  );
}

export function MemoryClusterSidePanel({
  cluster,
  items,
  memories,
  selectedMemoryId,
  onSelectMemory,
}: MemoryClusterSidePanelProps) {
  return (
    <aside className="flex w-88 shrink-0 flex-col border-l border-border bg-card xl:w-96">
      <div className="border-b border-border px-5 py-4">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          Detail panel
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {cluster?.label ?? "클러스터를 선택하세요"}
          </h2>
          {cluster ? (
            <Badge variant="secondary" className="rounded-full">
              {items.length}
            </Badge>
          ) : null}
        </div>
        {cluster ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {cluster.summary}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            왼쪽 목록이나 그래프의 점을 선택하면 상세가 여기에 표시됩니다.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
        {cluster ? (
          <div className="space-y-5">
            {cluster.relatedActions.length > 0 ? (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Related actions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cluster.relatedActions.map((action) => (
                    <Badge
                      key={action}
                      variant="warning"
                      className="rounded-full border-amber-200 bg-amber-50"
                    >
                      {action}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Included memory items
              </p>
              <div className="space-y-2">
                {items.map((item) => {
                  const selected = item.id === selectedMemoryId;
                  const memory =
                    memories.find((candidate) => candidate.id === item.id) ??
                    null;
                  const weightLabel = formatWeight(item.weight);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectMemory(item.id)}
                      className={`w-full rounded-lg border p-3 text-left text-xs transition ${
                        selected
                          ? "border-slate-400 bg-slate-100 shadow-sm ring-2 ring-slate-200"
                          : "border-border bg-background hover:border-slate-300 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex gap-2">
                        <span
                          className={`mt-0.5 w-1 shrink-0 rounded-full ${
                            selected ? "bg-slate-700" : "bg-transparent"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                {item.semantic ? (
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                                  >
                                    Semantic summary
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border-slate-200 bg-slate-50 text-[10px] text-slate-500"
                                  >
                                    No semantic summary
                                  </Badge>
                                )}
                              </div>
                              <p
                                className={`min-w-0 leading-relaxed ${
                                  selected
                                    ? "wrap-anywhere font-semibold text-slate-950"
                                    : "line-clamp-2 text-foreground"
                                }`}
                              >
                                {item.episodic || item.input || item.semantic}
                              </p>
                            </div>
                            {selected ? (
                              <Badge
                                variant="secondary"
                                className="shrink-0 rounded-full border-slate-300 bg-slate-200 text-slate-700"
                              >
                                선택됨
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {item.timestamp ? <span>{formatDate(item.timestamp)}</span> : null}
                        <Badge
                          variant="secondary"
                          className={`rounded-full ${sourceBadgeClass(item.sourceType)}`}
                        >
                          {sourceLabel(item.sourceType)}
                        </Badge>
                        {item.action ? (
                          <Badge
                            variant="warning"
                            className="rounded-full border-amber-200 bg-amber-50"
                          >
                            {item.action}
                          </Badge>
                        ) : null}
                        {!item.embedding?.length ? (
                          <Badge variant="secondary" className="rounded-full">
                            Fallback position
                          </Badge>
                        ) : null}
                        {weightLabel ? (
                          <Badge variant="secondary" className="rounded-full">
                            weight {weightLabel}
                          </Badge>
                        ) : null}
                        {memory?.archivedAt ? (
                          <Badge variant="secondary" className="rounded-full">
                            보관됨
                          </Badge>
                        ) : null}
                      </div>
                      {selected ? (
                        <div className="mt-3 space-y-3">
                          {item.semantic ? (
                            <MemoryField label="Semantic summary" value={item.semantic} />
                          ) : null}
                          {item.input ? (
                            <MemoryField label="Original input" value={item.input} />
                          ) : null}
                          {weightLabel ? (
                            <div className="rounded-lg border border-border bg-background px-3 py-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                  Weight
                                </p>
                                <p className="text-[10px] font-semibold tabular-nums text-slate-600">
                                  {weightLabel}
                                </p>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-slate-700"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, Math.round((item.weight ?? 0) * 100)))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
                          {item.keywords.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {item.keywords.map((keyword) => (
                                <Badge
                                  key={keyword}
                                  variant="secondary"
                                  className="rounded-full"
                                >
                                  {keyword}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          {memory?.source?.missionId ? (
                            <p className="text-[11px] text-muted-foreground">
                              {memory.source.missionId}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
