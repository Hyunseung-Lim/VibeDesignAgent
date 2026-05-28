"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

type ClusterableMemoryItem = {
  id: string;
  memoryId: string;
  semantic: string;
  episodic: string;
  episode?: string;
  input: string;
  output?: string;
  link?: string;
  action: string;
  timestamp: number;
  keyword: string[];
  keywords: string[];
  row?: {
    source?: { missionId?: string; draftId?: string };
  };
};

type GraphNodePayload =
  | {
      kind: "cluster";
      id: string;
      label: string;
      cluster: MemoryCluster;
      val: number;
      color: string;
    }
  | {
      kind: "memory";
      id: string;
      label: string;
      item: ClusterableMemoryItem;
      clusterId: string;
      val: number;
      color: string;
    };

type GraphLinkPayload = {
  source: string;
  target: string;
  clusterId: string;
};

type GraphNode = NodeObject<GraphNodePayload>;
type GraphLink = LinkObject<GraphNodePayload, GraphLinkPayload>;

type Props = {
  clusters: MemoryCluster[];
  items: ClusterableMemoryItem[];
  selectedClusterId: string | null;
  onSelectCluster: (clusterId: string) => void;
  fill?: boolean;
};

const CLUSTER_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#15803d",
  "#a16207",
  "#9333ea",
  "#0f766e",
];

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function itemDate(timestamp: number) {
  return timestamp
    ? new Date(timestamp).toLocaleString("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

export default function MemoryClusterGraph({
  clusters,
  items,
  selectedClusterId,
  onSelectCluster,
  fill = false,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const graphRef =
    useRef<ForceGraphMethods<GraphNodePayload, GraphLinkPayload> | undefined>(
      undefined,
    );
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    clusters.forEach((cluster, clusterIndex) => {
      const color = CLUSTER_COLORS[clusterIndex % CLUSTER_COLORS.length];
      nodes.push({
        id: `cluster:${cluster.id}`,
        kind: "cluster",
        label: cluster.label,
        cluster,
        val: Math.max(10, Math.min(28, 10 + Math.sqrt(cluster.count) * 4)),
        color,
      });

      cluster.itemIds.forEach((itemId) => {
        const item = itemById.get(itemId);
        if (!item) return;

        nodes.push({
          id: `memory:${item.id}`,
          kind: "memory",
          label: item.semantic,
          item,
          clusterId: cluster.id,
          val: 4.5,
          color,
        });

        links.push({
          source: `cluster:${cluster.id}`,
          target: `memory:${item.id}`,
          clusterId: cluster.id,
        });
      });
    });

    return { nodes, links };
  }, [clusters, itemById]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.max(320, Math.floor(entry.contentRect.width));
      const height = Math.max(360, Math.floor(entry.contentRect.height));
      setSize({ width, height });
    });

    resizeObserver.observe(wrapper);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(500, 70);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [graphData]);

  const selectedGraphId = selectedNode?.id ? String(selectedNode.id) : null;
  const selectedClusterGraphId = selectedClusterId
    ? `cluster:${selectedClusterId}`
    : null;

  const isRelatedToSelection = (node: GraphNode) => {
    if (!selectedClusterId) return true;
    if (node.kind === "cluster") return node.cluster.id === selectedClusterId;
    return node.clusterId === selectedClusterId;
  };

  return (
    <div
      className={`relative overflow-hidden bg-white ${
        fill
          ? "h-full min-h-0"
          : "h-112 min-h-96 rounded-2xl border border-slate-100 shadow-sm"
      }`}
    >
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-100">
          {clusters.length} clusters
        </span>
        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-100">
          {items.length} semantic nodes
        </span>
      </div>

      <div ref={wrapperRef} className="h-full w-full">
        <ForceGraph2D<GraphNodePayload, GraphLinkPayload>
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor="#ffffff"
          cooldownTicks={90}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.34}
          nodeId="id"
          nodeVal="val"
          nodeRelSize={3.5}
          linkDirectionalParticles={(link) =>
            link.clusterId === selectedClusterId ? 1 : 0
          }
          linkDirectionalParticleWidth={1.8}
          linkDirectionalParticleSpeed={0.005}
          linkColor={(link) =>
            link.clusterId === selectedClusterId ? "#64748b" : "#d7dee8"
          }
          linkWidth={(link) => (link.clusterId === selectedClusterId ? 1.3 : 0.8)}
          onNodeHover={(node) =>
            setHoveredNodeId(node?.id ? String(node.id) : null)
          }
          onNodeClick={(node) => {
            setSelectedNode(node);
            if (node.kind === "cluster") {
              onSelectCluster(node.cluster.id);
            } else {
              onSelectCluster(node.clusterId);
            }
          }}
          onBackgroundClick={() => setSelectedNode(null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const isCluster = node.kind === "cluster";
            const related = isRelatedToSelection(node);
            const isSelected =
              selectedGraphId === node.id || selectedClusterGraphId === node.id;
            const isHovered = hoveredNodeId === node.id;
            const radius = isCluster
              ? Math.max(18, Math.sqrt(node.val ?? 12) * 4.2)
              : Math.max(5, Math.sqrt(node.val ?? 4) * 2.8);

            ctx.save();
            ctx.globalAlpha = related || isSelected ? 1 : 0.28;

            if (isCluster) {
              ctx.beginPath();
              ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
              ctx.fillStyle = `${node.color}16`;
              ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isCluster ? node.color : "#ffffff";
            ctx.fill();
            ctx.lineWidth = isSelected || isHovered ? 3 : isCluster ? 2 : 1.5;
            ctx.strokeStyle = isSelected
              ? "#0f172a"
              : isCluster
                ? "#ffffff"
                : node.color;
            ctx.stroke();

            if (!isCluster) {
              ctx.beginPath();
              ctx.arc(x, y, Math.max(2.5, radius * 0.42), 0, Math.PI * 2);
              ctx.fillStyle = node.color;
              ctx.fill();
            }

            const shouldDrawLabel =
              isCluster || isSelected || isHovered || globalScale > 1.05;
            if (shouldDrawLabel) {
              const label = truncate(node.label, isCluster ? 28 : 34);
              const fontSize = isCluster ? 12 : 10;
              ctx.font = `${isCluster ? 700 : 600} ${fontSize / globalScale}px Pretendard, system-ui, sans-serif`;
              const textWidth = ctx.measureText(label).width;
              const labelX = x + radius + 7;
              const labelY = y + fontSize / globalScale / 3;
              const padX = 5 / globalScale;
              const padY = 3 / globalScale;

              ctx.fillStyle = "rgba(255,255,255,0.86)";
              ctx.fillRect(
                labelX - padX,
                labelY - fontSize / globalScale + padY / 2,
                textWidth + padX * 2,
                fontSize / globalScale + padY * 2,
              );
              ctx.fillStyle = isCluster ? "#111827" : "#334155";
              ctx.fillText(label, labelX, labelY);
            }

            ctx.restore();
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const radius = node.kind === "cluster" ? 32 : 16;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }}
        />
      </div>

      {selectedNode && (
        <div className="absolute bottom-4 right-4 z-10 max-h-[75%] w-[min(22rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-slate-100 bg-white/95 p-4 text-xs shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-slate-400">
                {selectedNode.kind === "cluster" ? "Cluster" : "Semantic memory"}
              </p>
              <h4 className="mt-1 text-sm font-semibold leading-snug text-slate-900">
                {selectedNode.kind === "cluster"
                  ? selectedNode.cluster.label
                  : selectedNode.item.semantic}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close graph detail"
            >
              ×
            </button>
          </div>

          {selectedNode.kind === "cluster" ? (
            <div className="mt-3 space-y-3">
              <p className="leading-relaxed text-slate-600">
                {selectedNode.cluster.summary}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">
                  {selectedNode.cluster.count} items
                </span>
                {selectedNode.cluster.relatedActions.map((action) => (
                  <span
                    key={action}
                    className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                  >
                    {action}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                {selectedNode.item.timestamp ? (
                  <span>{itemDate(selectedNode.item.timestamp)}</span>
                ) : null}
                {selectedNode.item.action ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                    {selectedNode.item.action}
                  </span>
                ) : null}
                <span>{selectedNode.item.row?.source?.missionId ?? "no mission"}</span>
              </div>
              {selectedNode.item.episode && (
                <p className="leading-relaxed text-slate-500">
                  {selectedNode.item.episode}
                </p>
              )}
              {selectedNode.item.input && (
                <p className="wrap-anywhere rounded-xl bg-slate-50 px-3 py-2 leading-relaxed text-slate-500">
                  Input: {selectedNode.item.input}
                </p>
              )}
              {selectedNode.item.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.item.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
