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
                            <p
                              className={`min-w-0 flex-1 leading-relaxed ${
                                selected
                                  ? "wrap-anywhere font-semibold text-slate-950"
                                  : "line-clamp-2 text-foreground"
                              }`}
                            >
                              {item.semantic || item.episodic || item.input}
                            </p>
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
                        {item.action ? (
                          <Badge
                            variant="warning"
                            className="rounded-full border-amber-200 bg-amber-50"
                          >
                            {item.action}
                          </Badge>
                        ) : null}
                        {item.embedding?.length ? (
                          <Badge variant="secondary" className="rounded-full">
                            embedding
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
                          {item.episodic && item.semantic ? (
                            <p className="wrap-anywhere text-muted-foreground">
                              {item.episodic}
                            </p>
                          ) : null}
                          {item.input ? (
                            <p className="wrap-anywhere rounded-lg bg-muted/40 px-3 py-2 text-muted-foreground">
                              {item.input}
                            </p>
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
