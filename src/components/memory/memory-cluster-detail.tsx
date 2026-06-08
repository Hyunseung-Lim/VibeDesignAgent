import { Badge } from "@/components/ui/badge";
import type {
  ClusterGraphItem,
  MemoryCluster,
  MemoryItem,
} from "./memory-cluster-types";

type MemoryClusterDetailProps = {
  cluster: MemoryCluster;
  items: ClusterGraphItem[];
  memories: MemoryItem[];
};

export function MemoryClusterDetail({
  cluster,
  items,
  memories,
}: MemoryClusterDetailProps) {
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain p-5">
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">
              {cluster.label}
            </h3>
            <Badge variant="secondary" className="rounded-full">
              {items.length} items
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {cluster.summary}
          </p>
          {cluster.relatedActions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
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
          ) : null}
        </div>

        {cluster.representativeItems.length > 0 ? (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Representative semantics
            </p>
            <div className="space-y-2">
              {cluster.representativeItems.map((item, index) => (
                <p
                  key={index}
                  className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800"
                >
                  {item}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Included memory items
          </p>
          <div className="space-y-3">
            {items.map((item) => {
              const mem = memories.find((memory) => memory.id === item.id);
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-border bg-card p-4 text-xs shadow-sm"
                >
                  <p className="wrap-anywhere text-sm leading-relaxed text-foreground">
                    {item.semantic || item.episodic}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {item.timestamp ? (
                      <span>
                        {new Date(item.timestamp).toLocaleString("ko-KR", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                    {item.action ? (
                      <Badge
                        variant="warning"
                        className="rounded-full border-amber-200 bg-amber-50"
                      >
                        {item.action}
                      </Badge>
                    ) : null}
                    {item.keyword.slice(0, 3).map((kw) => (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className="rounded-full"
                      >
                        {kw}
                      </Badge>
                    ))}
                    {mem?.archivedAt ? (
                      <Badge variant="secondary" className="rounded-full">
                        보관됨
                      </Badge>
                    ) : null}
                  </div>
                  {item.episodic && item.semantic ? (
                    <p className="mt-3 wrap-anywhere text-muted-foreground">
                      {item.episodic}
                    </p>
                  ) : null}
                  {item.input ? (
                    <p className="mt-3 wrap-anywhere text-muted-foreground">
                      {item.input}
                    </p>
                  ) : null}
                  {mem?.source?.missionId ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {mem.source.missionId}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
