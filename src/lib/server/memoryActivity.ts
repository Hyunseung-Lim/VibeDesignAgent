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
