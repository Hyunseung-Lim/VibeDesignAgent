import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_1";
const MAX_DUPLICATE_SCAN_ITEMS = 220;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.92;
const LOW_RETENTION_THRESHOLD = 0.28;
const STALE_DAYS_THRESHOLD = 14;

type SemanticItem = {
  id?: unknown;
  semantic?: unknown;
  embedding?: unknown;
  importanceScore?: unknown;
  usageScore?: unknown;
  decayScore?: unknown;
  retentionScore?: unknown;
  lastRetrievedAt?: unknown;
  retrievedCount?: unknown;
  duplicateOf?: unknown;
  archivedAt?: unknown;
  archiveReason?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type MemoryDoc = Record<string, unknown> & {
  id: string;
  semanticItems?: SemanticItem[];
};

type ForgettingCandidate = {
  id: string;
  reason: "low-retention" | "stale" | "duplicate";
  reasonLabel: string;
  memoryId: string;
  semanticItemId: string;
  semantic: string;
  retentionScore: number | null;
  importanceScore: number;
  usageScore: number;
  decayScore: number;
  retrievedCount: number;
  lastRetrievedAt: number | null;
  createdAt: number | null;
  source: unknown;
  keywords: string[];
  duplicate?: {
    memoryId: string;
    semanticItemId: string;
    semantic: string;
    similarity: number;
  };
};

type IndexedSemanticItem = ForgettingCandidate & {
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

async function requireAdmin(request: Request) {
  const admin = await verifyFirebaseIdToken(request);
  return admin && isAdminEmail(admin.email) ? admin : null;
}

async function loadMemoryDocs(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  return Promise.all(
    ids.map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${MEMORY_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...data } as MemoryDoc;
    }),
  );
}

function flattenSemanticItems(docs: MemoryDoc[]) {
  return docs.flatMap((doc) => {
    const semanticItems = Array.isArray(doc.semanticItems)
      ? doc.semanticItems
      : [];
    return semanticItems
      .map((item, index): IndexedSemanticItem | null => {
        const semantic = String(item.semantic ?? "").trim();
        if (!semantic || timestampValue(item.archivedAt)) return null;
        const semanticItemId = String(item.id ?? `semantic-${index}`);
        const retentionScore =
          typeof item.retentionScore === "number" &&
          Number.isFinite(item.retentionScore)
            ? item.retentionScore
            : null;
        return {
          id: `${doc.id}:${semanticItemId}`,
          reason: "stale",
          reasonLabel: "",
          memoryId: doc.id,
          semanticItemId,
          semantic,
          retentionScore,
          importanceScore: numberValue(item.importanceScore, 0.5),
          usageScore: numberValue(item.usageScore),
          decayScore: numberValue(item.decayScore),
          retrievedCount: numberValue(item.retrievedCount),
          lastRetrievedAt: timestampValue(item.lastRetrievedAt),
          createdAt: timestampValue(item.createdAt ?? doc.createdAt),
          source: doc.source ?? null,
          keywords: stringArray(doc.keywords),
          embedding: embeddingValue(item.embedding),
        };
      })
      .filter((item): item is IndexedSemanticItem => Boolean(item));
  });
}

function addCandidate(
  candidates: Map<string, ForgettingCandidate>,
  item: IndexedSemanticItem,
  reason: ForgettingCandidate["reason"],
  reasonLabel: string,
  duplicate?: ForgettingCandidate["duplicate"],
) {
  if (candidates.has(item.id)) return;
  const candidate: Omit<IndexedSemanticItem, "embedding"> & {
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

function buildCandidates(items: IndexedSemanticItem[]) {
  const now = Date.now();
  const staleMs = STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
  const candidates = new Map<string, ForgettingCandidate>();

  items.forEach((item) => {
    if (
      item.retentionScore != null &&
      item.retentionScore < LOW_RETENTION_THRESHOLD
    ) {
      addCandidate(
        candidates,
        item,
        "low-retention",
        `retentionScore가 ${LOW_RETENTION_THRESHOLD}보다 낮습니다.`,
      );
      return;
    }
    const referenceTime = item.lastRetrievedAt ?? item.createdAt;
    if (
      referenceTime &&
      item.retrievedCount === 0 &&
      now - referenceTime > staleMs
    ) {
      addCandidate(
        candidates,
        item,
        "stale",
        `${STALE_DAYS_THRESHOLD}일 이상 검색되지 않은 semantic입니다.`,
      );
    }
  });

  const duplicateScanItems = items
    .filter((item) => item.embedding.length > 0)
    .slice(0, MAX_DUPLICATE_SCAN_ITEMS);

  for (let leftIndex = 0; leftIndex < duplicateScanItems.length; leftIndex += 1) {
    const left = duplicateScanItems[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < duplicateScanItems.length;
      rightIndex += 1
    ) {
      const right = duplicateScanItems[rightIndex];
      const similarity = cosineSimilarity(left.embedding, right.embedding);
      if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) continue;
      const leftScore = left.retentionScore ?? 0.5;
      const rightScore = right.retentionScore ?? 0.5;
      const archiveTarget =
        leftScore < rightScore ||
        (leftScore === rightScore &&
          left.retrievedCount <= right.retrievedCount)
          ? left
          : right;
      const keepTarget = archiveTarget === left ? right : left;
      addCandidate(
        candidates,
        archiveTarget,
        "duplicate",
        `semantic vector similarity가 ${DUPLICATE_SIMILARITY_THRESHOLD} 이상입니다.`,
        {
          memoryId: keepTarget.memoryId,
          semanticItemId: keepTarget.semanticItemId,
          semantic: keepTarget.semantic,
          similarity,
        },
      );
    }
  }

  return Array.from(candidates.values()).sort((a, b) => {
    const reasonOrder = { duplicate: 0, "low-retention": 1, stale: 2 };
    const reasonDiff = reasonOrder[a.reason] - reasonOrder[b.reason];
    if (reasonDiff !== 0) return reasonDiff;
    return (a.retentionScore ?? 1) - (b.retentionScore ?? 1);
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { uid } = await params;
  const token = await getFirebaseAccessToken();
  const docs = await loadMemoryDocs(uid, token);
  const items = flattenSemanticItems(docs);

  return Response.json({
    candidates: buildCandidates(items),
    thresholds: {
      duplicateSimilarity: DUPLICATE_SIMILARITY_THRESHOLD,
      lowRetention: LOW_RETENTION_THRESHOLD,
      staleDays: STALE_DAYS_THRESHOLD,
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { uid } = await params;
  const body = (await request.json().catch(() => null)) as {
    memoryId?: unknown;
    semanticItemId?: unknown;
    reason?: unknown;
    duplicateOf?: unknown;
  } | null;
  const memoryId = String(body?.memoryId ?? "");
  const semanticItemId = String(body?.semanticItemId ?? "");
  if (!memoryId || !semanticItemId) {
    return Response.json({ error: "missing memory item" }, { status: 400 });
  }

  const token = await getFirebaseAccessToken();
  const path = `users/${uid}/${MEMORY_COLLECTION}/${memoryId}`;
  const data =
    ((await getFirestoreDocument(path, token)) ?? {}) as Record<string, unknown>;
  const semanticItems = Array.isArray(data.semanticItems)
    ? [...data.semanticItems]
    : [];
  const index = semanticItems.findIndex(
    (item) =>
      String((item as SemanticItem).id ?? "") === semanticItemId,
  );
  if (index < 0) {
    return Response.json({ error: "semantic item not found" }, { status: 404 });
  }

  const now = Date.now();
  semanticItems[index] = {
    ...(semanticItems[index] as Record<string, unknown>),
    archivedAt: now,
    archiveReason: String(body?.reason ?? "manual-forgetting"),
    duplicateOf: body?.duplicateOf ?? null,
    updatedAt: now,
  };

  await patchFirestoreDocument(path, { semanticItems }, token);
  return Response.json({ ok: true, archivedAt: now });
}
