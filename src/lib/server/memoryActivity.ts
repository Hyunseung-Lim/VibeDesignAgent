export function memoryWeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function memoryArchivedAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isInactiveMemoryWeight(value: unknown) {
  const weight = memoryWeight(value);
  return weight != null && weight <= 0;
}

export function isActiveMemoryDocument(doc: Record<string, unknown>) {
  return !memoryArchivedAt(doc.archivedAt) && !isInactiveMemoryWeight(doc.weight);
}

export type MemoryInactiveReason =
  | "similar_memory"
  | "weight_zero"
  | "user_disabled";

export function memoryInactiveReason(
  doc: Record<string, unknown>,
): MemoryInactiveReason | null {
  if (doc.inactiveReason === "user_disabled") return "user_disabled";
  if (memoryArchivedAt(doc.archivedAt)) return "similar_memory";
  if (isInactiveMemoryWeight(doc.weight)) return "weight_zero";
  return null;
}
