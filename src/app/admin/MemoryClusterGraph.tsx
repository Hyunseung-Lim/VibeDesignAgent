"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, CornersOutIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { memoryClusterColor } from "@/components/memory/memory-cluster-colors";

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
  sourceType?: string | null;
  weight?: number | null;
  embedding?: number[];
  timestamp: number;
  keyword: string[];
  keywords: string[];
  row?: {
    source?: { missionId?: string; draftId?: string };
    embedding?: number[];
  };
};

type Props = {
  clusters: MemoryCluster[];
  items: ClusterableMemoryItem[];
  selectedClusterId: string | null;
  onSelectCluster: (clusterId: string) => void;
  onSelectMemory?: (memoryId: string) => void;
  selectedMemoryId?: string | null;
  showInlineDetail?: boolean;
  fill?: boolean;
};

type ProjectedPoint = {
  id: string;
  item: ClusterableMemoryItem;
  cluster: MemoryCluster | null;
  clusterId: string;
  color: string;
  label: string;
  rawX: number;
  rawY: number;
  x: number;
  y: number;
  radius: number;
  hasEmbedding: boolean;
};

type HullPoint = { x: number; y: number };

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 5;

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function embeddingOf(item: ClusterableMemoryItem) {
  const vector = item.embedding?.length ? item.embedding : item.row?.embedding;
  return vector?.filter((value) => Number.isFinite(value)) ?? [];
}

function hashNumber(value: string, salt: number) {
  let hash = 2166136261 + salt;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}

function dot(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function principalComponent(rows: number[][], dimension: number, seed: number) {
  let component = normalizeVector(
    Array.from({ length: dimension }, (_, index) =>
      Math.sin((index + 1) * (seed + 1.37)),
    ),
  );

  for (let iteration = 0; iteration < 28; iteration += 1) {
    const next = Array.from({ length: dimension }, () => 0);
    for (const row of rows) {
      const projection = dot(row, component);
      for (let index = 0; index < dimension; index += 1) {
        next[index] += row[index] * projection;
      }
    }
    component = normalizeVector(next);
  }

  return component;
}

function projectEmbeddings(items: ClusterableMemoryItem[]) {
  const embedded = items
    .map((item) => ({ item, vector: embeddingOf(item) }))
    .filter(({ vector }) => vector.length >= 2);

  const dimension = Math.min(...embedded.map(({ vector }) => vector.length));
  if (embedded.length < 2 || !Number.isFinite(dimension) || dimension < 2) {
    return new Map(
      items.map((item) => [
        item.id,
        {
          x: hashNumber(`${item.id}:${item.semantic}`, 11),
          y: hashNumber(`${item.id}:${item.episodic}:${item.input}`, 29),
          hasEmbedding: false,
        },
      ]),
    );
  }

  const means = Array.from({ length: dimension }, (_, index) =>
    embedded.reduce((sum, { vector }) => sum + vector[index], 0) /
    Math.max(embedded.length, 1),
  );
  const centered = embedded.map(({ vector }) =>
    Array.from({ length: dimension }, (_, index) => vector[index] - means[index]),
  );

  const pc1 = principalComponent(centered, dimension, 1);
  const residual = centered.map((row) => {
    const projection = dot(row, pc1);
    return row.map((value, index) => value - projection * pc1[index]);
  });
  const pc2 = principalComponent(residual, dimension, 7);

  const projected = new Map<string, { x: number; y: number; hasEmbedding: boolean }>();
  embedded.forEach(({ item }, index) => {
    projected.set(item.id, {
      x: dot(centered[index], pc1),
      y: dot(centered[index], pc2),
      hasEmbedding: true,
    });
  });

  for (const item of items) {
    if (projected.has(item.id)) continue;
    projected.set(item.id, {
      x: hashNumber(`${item.id}:${item.semantic}`, 11),
      y: hashNumber(`${item.id}:${item.episodic}:${item.input}`, 29),
      hasEmbedding: false,
    });
  }

  return projected;
}

function cross(origin: HullPoint, a: HullPoint, b: HullPoint) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: HullPoint[]) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: HullPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: HullPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

function drawClusterArea(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  color: string,
  selected: boolean,
  transformPoint: (point: HullPoint) => HullPoint,
  zoom: number,
) {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = selected ? 0.2 : 0.1;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2 : 1;

  if (points.length === 1) {
    const point = transformPoint(points[0]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 28 * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = selected ? 0.45 : 0.22;
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (points.length === 2) {
    const [a, b] = points.map(transformPoint);
    ctx.lineCap = "round";
    ctx.lineWidth = (selected ? 42 : 34) * zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const screenPoints = points.map(transformPoint);
  const centroid = screenPoints.reduce(
    (acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const hull = convexHull(screenPoints).map((point) => ({
    x: centroid.x + (point.x - centroid.x) * 1.14,
    y: centroid.y + (point.y - centroid.y) * 1.14,
  }));

  ctx.beginPath();
  hull.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = selected ? 0.55 : 0.22;
  ctx.stroke();
  ctx.restore();
}

export default function MemoryClusterGraph({
  clusters,
  items,
  selectedClusterId,
  onSelectCluster,
  onSelectMemory,
  selectedMemoryId,
  showInlineDetail = true,
  fill = false,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ProjectedPoint | null>(null);
  const [view, setView] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [dragState, setDragState] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const pointData = useMemo(() => {
    const clusterByItemId = new Map<string, MemoryCluster>();
    clusters.forEach((cluster) => {
      cluster.itemIds.forEach((itemId) => clusterByItemId.set(itemId, cluster));
    });
    const clusterIndexById = new Map(clusters.map((cluster, index) => [cluster.id, index] as const));
    const projection = projectEmbeddings(items);
    const weights = items
      .map((item) => item.weight)
      .filter((weight): weight is number => weight != null && Number.isFinite(weight));
    const minWeight = weights.length ? Math.min(...weights) : null;
    const maxWeight = weights.length ? Math.max(...weights) : null;
    const weightRange =
      minWeight != null && maxWeight != null ? maxWeight - minWeight : 0;
    const radiusForWeight = (weight: number | null | undefined) => {
      if (weight == null || !Number.isFinite(weight) || weightRange < 0.02 || minWeight == null) {
        return 5.5;
      }
      const normalized = (weight - minWeight) / weightRange;
      return 4.2 + Math.sqrt(Math.min(1, Math.max(0, normalized))) * 6.8;
    };
    const sourcePoints = items.map((item) => {
      const cluster = clusterByItemId.get(item.id) ?? null;
      const clusterId = cluster?.id ?? "unclustered";
      const color =
        cluster && clusterIndexById.has(cluster.id)
          ? memoryClusterColor(clusterIndexById.get(cluster.id) ?? 0)
          : "#94a3b8";
      const projected = projection.get(item.id) ?? { x: 0, y: 0, hasEmbedding: false };
      return {
        id: item.id,
        item,
        cluster,
        clusterId,
        color,
        label: item.semantic || item.episodic || item.input || item.id,
        rawX: projected.x,
        rawY: projected.y,
        x: 0,
        y: 0,
        radius: radiusForWeight(item.weight),
        hasEmbedding: projected.hasEmbedding,
      };
    });
    const rawXs = sourcePoints.map((point) => point.rawX);
    const rawYs = sourcePoints.map((point) => point.rawY);
    const minX = Math.min(...rawXs, -1);
    const maxX = Math.max(...rawXs, 1);
    const minY = Math.min(...rawYs, -1);
    const maxY = Math.max(...rawYs, 1);
    const pad = 72;
    const width = Math.max(size.width - pad * 2, 1);
    const height = Math.max(size.height - pad * 2, 1);
    const scaleX = maxX === minX ? 1 : width / (maxX - minX);
    const scaleY = maxY === minY ? 1 : height / (maxY - minY);

    const points = sourcePoints.map((point) => ({
      ...point,
      x: pad + (point.rawX - minX) * scaleX,
      y: size.height - pad - (point.rawY - minY) * scaleY,
    }));

    return {
      points,
      hasEmbedding: points.some((point) => point.hasEmbedding),
    };
  }, [clusters, items, size.height, size.width]);

  const clusterPointGroups = useMemo(() => {
    const groups = new Map<string, ProjectedPoint[]>();
    pointData.points.forEach((point) => {
      const group = groups.get(point.clusterId) ?? [];
      group.push(point);
      groups.set(point.clusterId, group);
    });
    return groups;
  }, [pointData.points]);

  const toScreen = useCallback((point: HullPoint) => ({
    x: size.width / 2 + (point.x - size.width / 2) * view.zoom + view.offsetX,
    y: size.height / 2 + (point.y - size.height / 2) * view.zoom + view.offsetY,
  }), [size.height, size.width, view.offsetX, view.offsetY, view.zoom]);

  const toWorld = useCallback((point: HullPoint) => ({
    x: (point.x - size.width / 2 - view.offsetX) / view.zoom + size.width / 2,
    y: (point.y - size.height / 2 - view.offsetY) / view.zoom + size.height / 2,
  }), [size.height, size.width, view.offsetX, view.offsetY, view.zoom]);

  const zoomAt = useCallback((screenX: number, screenY: number, nextZoom: number) => {
    setView((previous) => {
      const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const worldX = (screenX - size.width / 2 - previous.offsetX) / previous.zoom + size.width / 2;
      const worldY = (screenY - size.height / 2 - previous.offsetY) / previous.zoom + size.height / 2;
      return {
        zoom,
        offsetX: screenX - size.width / 2 - (worldX - size.width / 2) * zoom,
        offsetY: screenY - size.height / 2 - (worldY - size.height / 2) * zoom,
      };
    });
  }, [size.height, size.width]);

  const resetView = useCallback(() => {
    setView({ zoom: 1, offsetX: 0, offsetY: 0 });
    setDragState(null);
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(360, Math.floor(entry.contentRect.height)),
      });
    });
    resizeObserver.observe(wrapper);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    for (let x = 72; x < size.width - 36; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 56);
      ctx.lineTo(x, size.height - 48);
      ctx.stroke();
    }
    for (let y = 72; y < size.height - 36; y += 72) {
      ctx.beginPath();
      ctx.moveTo(48, y);
      ctx.lineTo(size.width - 48, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    clusters.forEach((cluster) => {
      const points = clusterPointGroups.get(cluster.id) ?? [];
      const color = points[0]?.color ?? "#94a3b8";
      drawClusterArea(ctx, points, color, cluster.id === selectedClusterId, toScreen, view.zoom);
    });

    const selectedPointId = selectedMemoryId ?? selectedPoint?.id ?? null;
    pointData.points.forEach((point) => {
      const screenPoint = toScreen(point);
      const selectedCluster = selectedClusterId && point.clusterId === selectedClusterId;
      const selected = selectedPointId === point.id;
      const hovered = hoveredPointId === point.id;
      const dimmed = selectedClusterId && !selectedCluster && !selected;
      const radius = point.radius * Math.sqrt(view.zoom);
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, radius + (selected || hovered ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = selected || hovered ? 3 : selectedCluster ? 2.2 : 1.4;
      ctx.strokeStyle = selected ? "#0f172a" : point.color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, Math.max(2.8, radius * 0.58), 0, Math.PI * 2);
      ctx.fillStyle = point.color;
      ctx.fill();

      if (selected || hovered) {
        const label = truncate(point.label, 42);
        ctx.font = "600 11px Pretendard, system-ui, sans-serif";
        const textWidth = ctx.measureText(label).width;
        const labelX = Math.min(screenPoint.x + 10, size.width - textWidth - 14);
        const labelY = Math.max(24, screenPoint.y - 12);
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillRect(labelX - 6, labelY - 14, textWidth + 12, 20);
        ctx.fillStyle = "#334155";
        ctx.fillText(label, labelX, labelY);
      }
      ctx.restore();
    });
  }, [
    clusterPointGroups,
    clusters,
    hoveredPointId,
    pointData.points,
    selectedClusterId,
    selectedMemoryId,
    selectedPoint,
    toScreen,
    view.offsetX,
    view.offsetY,
    view.zoom,
    size.height,
    size.width,
  ]);

  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const worldPoint = toWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return [...pointData.points]
      .reverse()
      .find((point) => Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y) <= (point.radius + 8) / Math.sqrt(view.zoom)) ?? null;
  };

  const selectedCluster =
    clusters.find((cluster) => cluster.id === selectedClusterId) ?? null;
  const embeddedCount = pointData.points.filter((point) => point.hasEmbedding).length;

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
          {embeddedCount}/{items.length} embedded points
        </span>
        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-100">
          PCA 2D projection
        </span>
      </div>

      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-slate-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-slate-500"
          onClick={() => zoomAt(size.width / 2, size.height / 2, view.zoom * 1.25)}
          aria-label="Zoom in graph"
          title="Zoom in"
        >
          <MagnifyingGlassPlusIcon size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-slate-500"
          onClick={() => zoomAt(size.width / 2, size.height / 2, view.zoom / 1.25)}
          aria-label="Zoom out graph"
          title="Zoom out"
        >
          <MagnifyingGlassMinusIcon size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-slate-500"
          onClick={resetView}
          aria-label="Fit graph view"
          title="Fit"
        >
          <CornersOutIcon size={14} />
        </Button>
        <span className="px-2 text-[10px] font-semibold tabular-nums text-slate-400">
          {Math.round(view.zoom * 100)}%
        </span>
      </div>

      {!pointData.hasEmbedding && (
        <div className="absolute right-4 top-16 z-10 max-w-72 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 shadow-sm">
          embedding vector가 없는 항목은 텍스트 기반 fallback 위치로 표시됩니다.
        </div>
      )}

      <div ref={wrapperRef} className="h-full w-full">
        <canvas
          ref={canvasRef}
          className={`h-full w-full ${dragState ? "cursor-grabbing" : "cursor-crosshair"}`}
          onWheel={(event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const nextZoom = view.zoom * (event.deltaY > 0 ? 0.88 : 1.14);
            zoomAt(event.clientX - rect.left, event.clientY - rect.top, nextZoom);
          }}
          onPointerMove={(event) => {
            if (dragState) {
              setView((previous) => ({
                ...previous,
                offsetX: dragState.offsetX + event.clientX - dragState.startX,
                offsetY: dragState.offsetY + event.clientY - dragState.startY,
              }));
              return;
            }
            const point = pointAt(event);
            setHoveredPointId(point?.id ?? null);
          }}
          onPointerLeave={() => {
            setHoveredPointId(null);
            setDragState(null);
          }}
          onPointerDown={(event) => {
            const point = pointAt(event);
            if (!point) {
              setSelectedPoint(null);
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragState({
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: view.offsetX,
                offsetY: view.offsetY,
              });
              return;
            }
            setSelectedPoint(point);
            onSelectCluster(point.clusterId);
            onSelectMemory?.(point.item.id);
          }}
          onPointerUp={(event) => {
            if (dragState?.pointerId === event.pointerId) {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDragState(null);
            }
          }}
          onPointerCancel={() => setDragState(null)}
        />
      </div>

      {showInlineDetail && selectedCluster && (
        <div className="absolute bottom-4 left-4 z-10 max-w-80 rounded-lg border border-slate-100 bg-white/95 p-3 text-xs shadow-xl backdrop-blur">
          <p className="text-[11px] font-semibold uppercase text-slate-400">
            Selected cluster
          </p>
          <p className="mt-1 font-semibold text-slate-900">
            {selectedCluster.label}
          </p>
          <p className="mt-1 line-clamp-2 leading-relaxed text-slate-500">
            {selectedCluster.summary}
          </p>
        </div>
      )}

      {showInlineDetail && selectedPoint && (
        <div className="absolute bottom-4 right-4 z-10 max-h-[75%] w-[min(22rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-slate-100 bg-white/95 p-4 text-xs shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-slate-400">
                Semantic memory
              </p>
              <h4 className="mt-1 text-sm font-semibold leading-snug text-slate-900">
                {selectedPoint.label}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPoint(null)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close graph detail"
            >
              x
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-400">
              {selectedPoint.cluster ? (
                <span
                  className="rounded-full px-2 py-0.5 font-semibold text-white"
                  style={{ backgroundColor: selectedPoint.color }}
                >
                  {selectedPoint.cluster.label}
                </span>
              ) : null}
              {selectedPoint.item.timestamp ? (
                <span>{itemDate(selectedPoint.item.timestamp)}</span>
              ) : null}
              {selectedPoint.item.action ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  {selectedPoint.item.action}
                </span>
              ) : null}
              <span>
                {selectedPoint.hasEmbedding ? "embedding" : "fallback"}
              </span>
            </div>
            {selectedPoint.item.episode || selectedPoint.item.episodic ? (
              <p className="leading-relaxed text-slate-500">
                {selectedPoint.item.episode || selectedPoint.item.episodic}
              </p>
            ) : null}
            {selectedPoint.item.input ? (
              <p className="wrap-anywhere rounded-lg bg-slate-50 px-3 py-2 leading-relaxed text-slate-500">
                Input: {selectedPoint.item.input}
              </p>
            ) : null}
            {selectedPoint.item.keywords.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedPoint.item.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
