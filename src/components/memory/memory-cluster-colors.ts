export const MEMORY_CLUSTER_COLORS = [
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

export function memoryClusterColor(index: number) {
  return MEMORY_CLUSTER_COLORS[index % MEMORY_CLUSTER_COLORS.length];
}

export function memoryClusterStableColor(
  cluster: { colorIndex?: number | null },
  fallbackIndex: number,
) {
  const colorIndex =
    typeof cluster.colorIndex === "number" && Number.isFinite(cluster.colorIndex)
      ? Math.max(0, Math.floor(cluster.colorIndex))
      : fallbackIndex;
  return memoryClusterColor(colorIndex);
}
