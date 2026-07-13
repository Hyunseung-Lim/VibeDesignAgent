"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { ZoomOutIcon, ZoomInIcon, MaximizeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { memoryClusterColor } from "@/components/memory/memory-cluster-colors";
import type {
  ClusterGraphEdge,
  MemorySource,
} from "@/components/memory/memory-cluster-types";
import {
  hasPreferenceSignal,
  preferenceSignalLabel,
  visibleMemoryActionLabels,
} from "@/components/memory/memory-action-labels";

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
  preferenceSignal?: unknown;
  sourceType?: string | null;
  weight?: number | null;
  embedding?: number[];
  timestamp: number;
  archivedAt?: number | null;
  archiveReason?: string | null;
  keyword: string[];
  keywords: string[];
  row?: {
    source?: MemorySource;
    embedding?: number[];
  };
};

type Props = {
  clusters: MemoryCluster[];
  items: ClusterableMemoryItem[];
  edges?: ClusterGraphEdge[];
  selectedClusterId: string | null;
  onSelectCluster: (clusterId: string) => void;
  onSelectMemory?: (memoryId: string) => void;
  selectedMemoryId?: string | null;
  showInlineDetail?: boolean;
  fill?: boolean;
  getMissionLabel?: (missionId: string) => string;
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
type ProjectionPoint = { x: number; y: number; hasEmbedding: boolean };

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 5;
const GRAPH_LAYOUT_ITERATIONS = 260;

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

function sourceLabel(sourceType: string | null | undefined) {
  if (sourceType === "before_session") return "세션 전";
  if (sourceType === "during_session") return "세션 중";
  return "출처 없음";
}

function sourceBadgeClass(sourceType: string | null | undefined) {
  if (sourceType === "before_session") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (sourceType === "during_session") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function defaultMissionLabel(missionId: string | null | undefined) {
  if (!missionId) return "세션 정보 없음";
  if (missionId === "onboarding") return "온보딩";
  return `미션 ${missionId.slice(0, 10)}`;
}

function beforeSessionSourceText(item: ClusterableMemoryItem) {
  return (item.row?.source?.sourceText ?? "").trim();
}

function userInputText(item: ClusterableMemoryItem) {
  const sourceText = beforeSessionSourceText(item);
  if (sourceText) return sourceText;
  const raw = (item.input || "").trim().replace(/^user input:\s*/i, "").trim();
  return raw || item.episodic || item.episode || item.semantic || item.id;
}

function isInactiveGraphItem(item: ClusterableMemoryItem) {
  if (item.archivedAt) return true;
  if (item.weight != null && item.weight <= 0) return true;
  return item.action?.split(" / ").includes("archived") ?? false;
}

function originalInputText(item: ClusterableMemoryItem) {
  const sourceText = beforeSessionSourceText(item);
  if (sourceText) return sourceText;
  return (item.input || "").trim().replace(/^user input:\s*/i, "").trim();
}

function isFinalDesignSelection(item: ClusterableMemoryItem) {
  return (
    item.action?.split(" / ").includes("final_design_select") ||
    item.id.startsWith("during-session-") &&
      item.id.includes("final-design-selection-") ||
    item.memoryId.includes("final-design-selection-")
  );
}

function finalDesignHeadline(item: ClusterableMemoryItem) {
  const firstLine = userInputText(item)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "최종디자인 시안 확정";
  return firstLine
    .replace(/^최종\s+디자인\s+확정\s*:/, "최종디자인 시안 확정:")
    .replace(/\s+[·•]\s+/g, " * ");
}

function memoryHeadlineText(item: ClusterableMemoryItem) {
  return isFinalDesignSelection(item) ? finalDesignHeadline(item) : userInputText(item);
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

function normalizeProjection(
  projection: Map<string, ProjectionPoint>,
  items: ClusterableMemoryItem[],
) {
  const xs = items.map((item) => projection.get(item.id)?.x ?? 0);
  const ys = items.map((item) => projection.get(item.id)?.y ?? 0);
  const minX = Math.min(...xs, -1);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, -1);
  const maxY = Math.max(...ys, 1);
  const rangeX = maxX === minX ? 1 : maxX - minX;
  const rangeY = maxY === minY ? 1 : maxY - minY;

  return items.map((item) => {
    const point = projection.get(item.id) ?? {
      x: hashNumber(`${item.id}:${item.semantic}`, 11),
      y: hashNumber(`${item.id}:${item.episodic}:${item.input}`, 29),
      hasEmbedding: false,
    };
    return {
      x: ((point.x - minX) / rangeX) * 2 - 1,
      y: ((point.y - minY) / rangeY) * 2 - 1,
      hasEmbedding: point.hasEmbedding,
    };
  });
}

function projectSimilarityGraph(
  items: ClusterableMemoryItem[],
  clusters: MemoryCluster[],
  edges: ClusterGraphEdge[],
) {
  const baseProjection = projectEmbeddings(items);
  const validEdges = edges.filter(
    (edge) =>
      edge.sourceId &&
      edge.targetId &&
      edge.sourceId !== edge.targetId &&
      Number.isFinite(edge.weight),
  );
  if (items.length < 2 || validEdges.length === 0) return baseProjection;

  const indexById = new Map(items.map((item, index) => [item.id, index] as const));
  const clusterByItemId = new Map<string, string>();
  clusters.forEach((cluster) => {
    cluster.itemIds.forEach((itemId) => clusterByItemId.set(itemId, cluster.id));
  });
  const nodes = normalizeProjection(baseProjection, items).map((point, index) => ({
    ...point,
    vx: 0,
    vy: 0,
    clusterId: clusterByItemId.get(items[index].id) ?? "unclustered",
  }));
  const layoutEdges = validEdges
    .map((edge) => ({
      source: indexById.get(edge.sourceId),
      target: indexById.get(edge.targetId),
      weight: clamp(edge.weight, 0, 1),
    }))
    .filter(
      (edge): edge is { source: number; target: number; weight: number } =>
        edge.source != null && edge.target != null,
    );

  for (let iteration = 0; iteration < GRAPH_LAYOUT_ITERATIONS; iteration += 1) {
    const progress = iteration / GRAPH_LAYOUT_ITERATIONS;
    const cooling = 1 - progress * 0.72;

    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const dx = nodes[b].x - nodes[a].x;
        const dy = nodes[b].y - nodes[a].y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 0.008);
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(0.018, 0.0048 / distanceSquared) * cooling;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        nodes[a].vx -= fx;
        nodes[a].vy -= fy;
        nodes[b].vx += fx;
        nodes[b].vy += fy;
      }
    }

    layoutEdges.forEach((edge) => {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
      const normalizedWeight = clamp((edge.weight - 0.58) / 0.28, 0, 1);
      const targetDistance = 0.22 + (1 - normalizedWeight) * 0.58;
      const force = (distance - targetDistance) * (0.026 + normalizedWeight * 0.028) * cooling;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    const clusterSums = new Map<string, { x: number; y: number; count: number }>();
    nodes.forEach((node) => {
      const current = clusterSums.get(node.clusterId) ?? { x: 0, y: 0, count: 0 };
      current.x += node.x;
      current.y += node.y;
      current.count += 1;
      clusterSums.set(node.clusterId, current);
    });
    nodes.forEach((node) => {
      const cluster = clusterSums.get(node.clusterId);
      if (cluster && cluster.count > 1) {
        node.vx += ((cluster.x / cluster.count) - node.x) * 0.0025 * cooling;
        node.vy += ((cluster.y / cluster.count) - node.y) * 0.0025 * cooling;
      }
      node.vx += -node.x * 0.0012 * cooling;
      node.vy += -node.y * 0.0012 * cooling;
      node.x = clamp(node.x + node.vx, -2.2, 2.2);
      node.y = clamp(node.y + node.vy, -2.2, 2.2);
      node.vx *= 0.82;
      node.vy *= 0.82;
    });
  }

  return new Map(
    items.map((item, index) => [
      item.id,
      {
        x: nodes[index].x,
        y: nodes[index].y,
        hasEmbedding: nodes[index].hasEmbedding,
      },
    ]),
  );
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

function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  edges: ClusterGraphEdge[],
  pointById: Map<string, ProjectedPoint>,
  selectedClusterId: string | null,
  selectedPointId: string | null,
  transformPoint: (point: HullPoint) => HullPoint,
) {
  if (edges.length === 0) return;
  const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);
  ctx.save();
  ctx.lineCap = "round";

  sortedEdges.forEach((edge) => {
    const source = pointById.get(edge.sourceId);
    const target = pointById.get(edge.targetId);
    if (!source || !target) return;
    const sourceScreen = transformPoint(source);
    const targetScreen = transformPoint(target);
    const sameSelectedCluster =
      Boolean(selectedClusterId) &&
      source.clusterId === selectedClusterId &&
      target.clusterId === selectedClusterId;
    const touchesSelectedPoint =
      Boolean(selectedPointId) &&
      (source.id === selectedPointId || target.id === selectedPointId);
    const crossCluster = source.clusterId !== target.clusterId;
    const normalized = clamp((edge.weight - 0.58) / 0.28, 0, 1);
    const alpha = touchesSelectedPoint
      ? 0.48
      : sameSelectedCluster
        ? 0.34
        : selectedClusterId
          ? 0.08
          : 0.14 + normalized * 0.08;

    ctx.globalAlpha = alpha;
    ctx.lineWidth = touchesSelectedPoint
      ? 2.2
      : sameSelectedCluster
        ? 1.7
        : 0.8 + normalized * 1.1;
    ctx.strokeStyle = crossCluster ? "#94a3b8" : source.color;
    ctx.beginPath();
    ctx.moveTo(sourceScreen.x, sourceScreen.y);
    ctx.lineTo(targetScreen.x, targetScreen.y);
    ctx.stroke();
  });

  ctx.restore();
}

export default function MemoryClusterGraph({
  clusters,
  items,
  edges = [],
  selectedClusterId,
  onSelectCluster,
  onSelectMemory,
  selectedMemoryId,
  showInlineDetail = true,
  fill = false,
  getMissionLabel = defaultMissionLabel,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
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
    const projection = projectSimilarityGraph(items, clusters, edges);
    const layoutLabel = edges.length > 0
      ? "Similarity graph layout"
      : "PCA 2D projection";
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
        label:
          item.semantic || item.episode || item.episodic || item.input || item.id,
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
      layoutLabel,
    };
  }, [clusters, edges, items, size.height, size.width]);

  const clusterPointGroups = useMemo(() => {
    const groups = new Map<string, ProjectedPoint[]>();
    pointData.points.forEach((point) => {
      const group = groups.get(point.clusterId) ?? [];
      group.push(point);
      groups.set(point.clusterId, group);
    });
    return groups;
  }, [pointData.points]);

  const pointById = useMemo(
    () => new Map(pointData.points.map((point) => [point.id, point] as const)),
    [pointData.points],
  );

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
    drawGraphEdges(ctx, edges, pointById, selectedClusterId, selectedPointId, toScreen);

    pointData.points.forEach((point) => {
      const screenPoint = toScreen(point);
      const selectedCluster = selectedClusterId && point.clusterId === selectedClusterId;
      const selected = selectedPointId === point.id;
      const hovered = hoveredPointId === point.id;
      const dimmed = selectedClusterId && !selectedCluster && !selected;
      const inactive = isInactiveGraphItem(point.item);
      const radius = point.radius * Math.sqrt(view.zoom);
      const nodeRadius = Math.max(3.2, radius + (selected || hovered ? 2.5 : 0));
      // Memories newly created in the selected mission/session are drawn as a
      // diamond instead of a circle, so they read as "new" regardless of cluster
      // color. The "promoted" token is only set in the session-diff / cumulative
      // views; admin/agent action values never carry it.
      const isNewNode =
        point.item.action?.split(" / ").includes("promoted") ?? false;
      ctx.save();
      ctx.globalAlpha = selected || hovered ? 1 : inactive ? 0.34 : dimmed ? 0.3 : 1;
      ctx.beginPath();
      if (isNewNode) {
        const half = nodeRadius * 1.25;
        ctx.moveTo(screenPoint.x, screenPoint.y - half);
        ctx.lineTo(screenPoint.x + half, screenPoint.y);
        ctx.lineTo(screenPoint.x, screenPoint.y + half);
        ctx.lineTo(screenPoint.x - half, screenPoint.y);
        ctx.closePath();
      } else {
        ctx.arc(screenPoint.x, screenPoint.y, nodeRadius, 0, Math.PI * 2);
      }
      ctx.fillStyle = inactive ? "#cbd5e1" : point.color;
      ctx.fill();
      if (isNewNode) {
        // Thin light edge so the diamond stays crisp over cluster fill areas.
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }

      ctx.restore();
    });
  }, [
    clusterPointGroups,
    clusters,
    edges,
    hoveredPointId,
    pointById,
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
  const selectedPointActionLabels = visibleMemoryActionLabels(
    selectedPoint?.item.action,
  );
  const selectedPointHasPreferenceSignal = hasPreferenceSignal(
    selectedPoint?.item.action,
    selectedPoint?.item.preferenceSignal,
  );
  const selectedPointInput = selectedPoint
    ? originalInputText(selectedPoint.item)
    : "";
  const hoveredPoint = hoveredPointId ? pointById.get(hoveredPointId) : null;
  const hoverCardLeft = clamp(
    hoverPosition.x + 14,
    12,
    Math.max(12, size.width - 300),
  );
  const hoverCardTop = clamp(
    hoverPosition.y + 14,
    12,
    Math.max(12, size.height - 240),
  );
  // Only show the shape legend when diamond (new) nodes are actually present, so
  // it never appears on views that don't distinguish new vs existing memories.
  const hasNewNodes = items.some((item) =>
    item.action?.split(" / ").includes("promoted"),
  );

  return (
    <div
      className={`relative overflow-hidden bg-white ${
        fill
          ? "h-full min-h-0"
          : "h-112 min-h-96 rounded-2xl border border-slate-100 shadow-sm"
      }`}
    >
      {hasNewNodes && (
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-slate-100">
          <span className="flex items-center gap-1.5">
            <span className="text-slate-500">◆</span> 새로 생긴 기억
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-slate-500">●</span> 기존 기억
          </span>
        </div>
      )}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-slate-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 cursor-pointer rounded-full text-slate-500"
          onClick={() => zoomAt(size.width / 2, size.height / 2, view.zoom * 1.25)}
          aria-label="Zoom in graph"
          title="Zoom in"
        >
          <ZoomInIcon size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 cursor-pointer rounded-full text-slate-500"
          onClick={() => zoomAt(size.width / 2, size.height / 2, view.zoom / 1.25)}
          aria-label="Zoom out graph"
          title="Zoom out"
        >
          <ZoomOutIcon size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 cursor-pointer rounded-full text-slate-500"
          onClick={resetView}
          aria-label="Fit graph view"
          title="Fit"
        >
          <MaximizeIcon size={14} />
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
          className={`h-full w-full ${
            dragState
              ? "cursor-grabbing"
              : hoveredPointId
                ? "cursor-pointer"
                : "cursor-grab"
          }`}
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
            setHoverPosition({
              x: event.clientX - event.currentTarget.getBoundingClientRect().left,
              y: event.clientY - event.currentTarget.getBoundingClientRect().top,
            });
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

      {hoveredPoint && !dragState ? (
        <div
          className="pointer-events-none absolute z-20 w-[min(20rem,calc(100%-1.5rem))] rounded-lg border border-border bg-background p-3 text-left text-xs shadow-xl backdrop-blur"
          style={{ left: hoverCardLeft, top: hoverCardTop }}
        >
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate font-medium text-slate-500">
              {hoveredPoint.item.row?.source?.missionId
                ? getMissionLabel(hoveredPoint.item.row.source.missionId)
                : "세션 정보 없음"}
            </span>
            {hoveredPoint.item.timestamp ? (
              <span className="shrink-0 tabular-nums">
                {itemDate(hoveredPoint.item.timestamp)}
              </span>
            ) : null}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className={`rounded-full ${sourceBadgeClass(hoveredPoint.item.sourceType)}`}
            >
              {sourceLabel(hoveredPoint.item.sourceType)}
            </Badge>
            {visibleMemoryActionLabels(hoveredPoint.item.action).map((label) => (
              <Badge
                key={label}
                variant="warning"
                className="rounded-full border-amber-200 bg-amber-50"
              >
                {label}
              </Badge>
            ))}
            {hasPreferenceSignal(
              hoveredPoint.item.action,
              hoveredPoint.item.preferenceSignal,
            ) ? (
              <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">
                {preferenceSignalLabel}
              </Badge>
            ) : null}
          </div>
          <div className="flex gap-2">
            <span
              className="mt-0.5 w-1 shrink-0 rounded-full bg-transparent"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-foreground">
                {memoryHeadlineText(hoveredPoint.item)}
              </p>
            </div>
          </div>
        </div>
      ) : null}

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
                {selectedPoint.item.semantic
                  ? "Semantic memory"
                  : selectedPoint.item.episode || selectedPoint.item.episodic
                    ? "Episodic memory"
                    : selectedPointInput
                      ? "User input"
                      : "Memory node"}
              </p>
              <h4 className="mt-1 text-sm font-semibold leading-snug text-slate-900">
                {selectedPoint.label}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPoint(null)}
              className="cursor-pointer rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
              {selectedPointActionLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                >
                  {label}
                </span>
              ))}
              {selectedPointHasPreferenceSignal ? (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200">
                  {preferenceSignalLabel}
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
            {selectedPointInput ? (
              <p className="wrap-anywhere rounded-lg bg-slate-50 px-3 py-2 leading-relaxed text-slate-500">
                Input: {selectedPointInput}
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
