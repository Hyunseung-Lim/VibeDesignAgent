import {
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
} from "@/lib/server/firebaseAdminRest";
import { isActiveMemoryDocument } from "@/lib/server/memoryActivity";

export const MEMORY_FORGETTING_COLLECTION = "memories_0_1_2";
export const MEMORY_DUPLICATE_SIMILARITY_THRESHOLD = 0.92;
export const MEMORY_LOW_WEIGHT_THRESHOLD = 0.28;

const MAX_DUPLICATE_SCAN_ITEMS = 220;

type MemoryDoc = Record<string, unknown> & {
  id: string;
};

export type ForgettingCandidate = {
  id: string;
  reason: "low-weight" | "duplicate";
  reasonLabel: string;
  memoryId: string;
  semanticItemId: string | null;
  episodic: string;
  semantic: string | null;
  weight: number | null;
  retrievedCount: number;
  lastRetrievedAt: number | null;
  createdAt: number | null;
  archivedAt?: number | null;
  archiveReason?: string | null;
  duplicateOf?: string | null;
  source: unknown;
  keywords: string[];
  duplicate?: {
    memoryId: string;
    semanticItemId: string | null;
    semantic: string | null;
    episodic: string;
    similarity: number;
  };
};

type IndexedMemory = ForgettingCandidate & {
  embedding: number[];
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function timestampValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function embeddingValue(value: unknown) {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function duplicateValue(value: unknown): ForgettingCandidate["duplicate"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const duplicate = value as Record<string, unknown>;
  const memoryId = String(duplicate.memoryId ?? "").trim();
  if (!memoryId) return undefined;
  return {
    memoryId,
    semanticItemId:
      duplicate.semanticItemId == null ? null : String(duplicate.semanticItemId),
    semantic:
      typeof duplicate.semantic === "string" && duplicate.semantic.trim()
        ? duplicate.semantic
        : null,
    episodic: String(duplicate.episodic ?? ""),
    similarity: numberValue(duplicate.similarity),
  };
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function loadMemoryDocs(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_FORGETTING_COLLECTION}`,
    token,
  );
  return Promise.all(
    ids.map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${MEMORY_FORGETTING_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...data } as MemoryDoc;
    }),
  );
}

export function indexedMemoriesFromDocs(docs: MemoryDoc[]) {
  return docs
    .map((doc): IndexedMemory | null => {
      const episodic = String(doc.episodic ?? doc.episode ?? doc.content ?? "").trim();
      const semantic =
        typeof doc.semantic === "string" && doc.semantic.trim()
          ? doc.semantic.trim()
          : null;
      if (!episodic || !isActiveMemoryDocument(doc)) return null;
      const weight =
        typeof doc.weight === "number" && Number.isFinite(doc.weight)
          ? doc.weight
          : null;
      return {
        id: doc.id,
        reason: "low-weight",
        reasonLabel: "",
        memoryId: doc.id,
        semanticItemId: null,
        episodic,
        semantic,
        weight,
        retrievedCount: numberValue(doc.retrievedCount),
        lastRetrievedAt: timestampValue(doc.lastRetrievedAt),
        createdAt: timestampValue(doc.createdAt),
        source: doc.source ?? null,
        keywords: stringArray(doc.keyword).length
          ? stringArray(doc.keyword)
          : stringArray(doc.keywords),
        embedding: embeddingValue(doc.embedding),
      };
    })
    .filter((item): item is IndexedMemory => Boolean(item));
}

function addCandidate(
  candidates: Map<string, ForgettingCandidate>,
  item: IndexedMemory,
  reason: ForgettingCandidate["reason"],
  reasonLabel: string,
  duplicate?: ForgettingCandidate["duplicate"],
) {
  if (candidates.has(item.id)) return;
  const candidate: Omit<IndexedMemory, "embedding"> & {
    embedding?: number[];
  } = { ...item };
  delete candidate.embedding;
  candidates.set(item.id, {
    ...candidate,
    reason,
    reasonLabel,
    duplicate,
  });
}

function sortCandidates(candidates: ForgettingCandidate[]) {
  return candidates.sort((a, b) => {
    const reasonOrder = { duplicate: 0, "low-weight": 1 };
    const reasonDiff = reasonOrder[a.reason] - reasonOrder[b.reason];
    if (reasonDiff !== 0) return reasonDiff;
    return (a.weight ?? 1) - (b.weight ?? 1);
  });
}

export function buildForgettingCandidates(items: IndexedMemory[]) {
  const candidates = new Map<string, ForgettingCandidate>();

  items.forEach((item) => {
    if (item.weight != null && item.weight < MEMORY_LOW_WEIGHT_THRESHOLD) {
      addCandidate(
        candidates,
        item,
        "low-weight",
        `weight가 ${MEMORY_LOW_WEIGHT_THRESHOLD}보다 낮습니다.`,
      );
    }
  });

  buildDuplicateCandidates(items).forEach((candidate) => {
    candidates.set(candidate.id, candidate);
  });

  return sortCandidates(Array.from(candidates.values()));
}

export function buildDuplicateCandidates(
  items: IndexedMemory[],
  targetIds?: Set<string>,
) {
  const candidates = new Map<string, ForgettingCandidate>();
  const embeddedItems = items.filter((item) => item.embedding.length > 0);
  const duplicateScanItems = targetIds
    ? [
        ...embeddedItems.filter((item) => targetIds.has(item.id)),
        ...embeddedItems
          .filter((item) => !targetIds.has(item.id))
          .slice(0, MAX_DUPLICATE_SCAN_ITEMS),
      ]
    : embeddedItems.slice(0, MAX_DUPLICATE_SCAN_ITEMS);

  for (let leftIndex = 0; leftIndex < duplicateScanItems.length; leftIndex += 1) {
    const left = duplicateScanItems[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < duplicateScanItems.length;
      rightIndex += 1
    ) {
      const right = duplicateScanItems[rightIndex];
      if (targetIds && !targetIds.has(left.id) && !targetIds.has(right.id)) continue;
      const similarity = cosineSimilarity(left.embedding, right.embedding);
      if (similarity < MEMORY_DUPLICATE_SIMILARITY_THRESHOLD) continue;
      const leftWeight = left.weight ?? 0.5;
      const rightWeight = right.weight ?? 0.5;
      const archiveTarget =
        leftWeight < rightWeight ||
        (leftWeight === rightWeight &&
          left.retrievedCount <= right.retrievedCount)
          ? left
          : right;
      const keepTarget = archiveTarget === left ? right : left;
      addCandidate(
        candidates,
        archiveTarget,
        "duplicate",
        `memory vector similarity가 ${MEMORY_DUPLICATE_SIMILARITY_THRESHOLD} 이상입니다.`,
        {
          memoryId: keepTarget.memoryId,
          semanticItemId: null,
          semantic: keepTarget.semantic,
          episodic: keepTarget.episodic,
          similarity,
        },
      );
    }
  }

  return sortCandidates(Array.from(candidates.values()));
}

export function sortArchivedItems(items: ForgettingCandidate[]) {
  return [...items].sort(
    (a, b) => Number(b.archivedAt ?? 0) - Number(a.archivedAt ?? 0),
  );
}

export function archivedItemsFromDocs(docs: MemoryDoc[]) {
  return sortArchivedItems(
    docs
      .map((doc): ForgettingCandidate | null => {
        const episodic = String(doc.episodic ?? doc.episode ?? doc.content ?? "").trim();
        const semantic =
          typeof doc.semantic === "string" && doc.semantic.trim()
            ? doc.semantic.trim()
            : null;
        const archivedAt = timestampValue(doc.archivedAt);
        if (!episodic || !archivedAt) return null;
        const archiveReason = doc.archiveReason
          ? String(doc.archiveReason)
          : "archived";
        const weight =
          typeof doc.weight === "number" && Number.isFinite(doc.weight)
            ? doc.weight
            : null;
        const duplicate = duplicateValue(doc.duplicate);
        return {
          id: doc.id,
          reason: archiveReason.includes("duplicate")
            ? "duplicate"
            : "low-weight",
          reasonLabel: `archivedAt ${new Date(archivedAt).toISOString()}`,
          memoryId: doc.id,
          semanticItemId: null,
          episodic,
          semantic,
          weight,
          retrievedCount: numberValue(doc.retrievedCount),
          lastRetrievedAt: timestampValue(doc.lastRetrievedAt),
          createdAt: timestampValue(doc.createdAt),
          archivedAt,
          archiveReason,
          duplicateOf: doc.duplicateOf
            ? String(doc.duplicateOf)
            : duplicate?.memoryId ?? null,
          source: doc.source ?? null,
          keywords: stringArray(doc.keyword).length
            ? stringArray(doc.keyword)
            : stringArray(doc.keywords),
          duplicate,
        };
      })
      .filter((item): item is ForgettingCandidate => Boolean(item)),
  );
}

export async function archiveForgettingCandidates(
  uid: string,
  candidates: ForgettingCandidate[],
  token: string,
) {
  if (candidates.length === 0) return [];
  const now = Date.now();
  await Promise.all(
    candidates.map((candidate) =>
      patchFirestoreDocument(
        `users/${uid}/${MEMORY_FORGETTING_COLLECTION}/${encodeURIComponent(candidate.memoryId)}`,
        {
          archivedAt: now,
          archiveReason: `auto-${candidate.reason}`,
          duplicateOf: candidate.duplicate
            ? candidate.duplicate.memoryId
            : null,
          duplicate: candidate.duplicate ?? null,
          updatedAt: now,
        },
        token,
      ),
    ),
  );
  return sortArchivedItems(
    candidates.map((candidate) => ({
      ...candidate,
      archivedAt: now,
      archiveReason: `auto-${candidate.reason}`,
      duplicateOf: candidate.duplicate ? candidate.duplicate.memoryId : null,
    })),
  );
}

export async function archiveDuplicateMemoriesForTargets(
  uid: string,
  targetMemoryIds: string[],
  token: string,
) {
  if (targetMemoryIds.length === 0) return [];
  const docs = await loadMemoryDocs(uid, token);
  const items = indexedMemoriesFromDocs(docs);
  const candidates = buildDuplicateCandidates(items, new Set(targetMemoryIds));
  return archiveForgettingCandidates(uid, candidates, token);
}
