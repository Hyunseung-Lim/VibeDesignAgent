import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";
const MAX_DUPLICATE_SCAN_ITEMS = 220;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.92;
const LOW_WEIGHT_THRESHOLD = 0.28;

type MemoryDoc = Record<string, unknown> & {
  id: string;
};

type ForgettingCandidate = {
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

function indexedMemoriesFromDocs(docs: MemoryDoc[]) {
  return docs
    .map((doc): IndexedMemory | null => {
      const episodic = String(doc.episodic ?? doc.episode ?? doc.content ?? "").trim();
      const semantic =
        typeof doc.semantic === "string" && doc.semantic.trim()
          ? doc.semantic.trim()
          : null;
      if (!episodic || timestampValue(doc.archivedAt)) return null;
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

function buildCandidates(items: IndexedMemory[]) {
  const candidates = new Map<string, ForgettingCandidate>();

  items.forEach((item) => {
    if (item.weight != null && item.weight < LOW_WEIGHT_THRESHOLD) {
      addCandidate(
        candidates,
        item,
        "low-weight",
        `weight가 ${LOW_WEIGHT_THRESHOLD}보다 낮습니다.`,
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
        `memory vector similarity가 ${DUPLICATE_SIMILARITY_THRESHOLD} 이상입니다.`,
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

  return Array.from(candidates.values()).sort((a, b) => {
    const reasonOrder = { duplicate: 0, "low-weight": 1 };
    const reasonDiff = reasonOrder[a.reason] - reasonOrder[b.reason];
    if (reasonDiff !== 0) return reasonDiff;
    return (a.weight ?? 1) - (b.weight ?? 1);
  });
}

function sortArchivedItems(items: ForgettingCandidate[]) {
  return [...items].sort(
    (a, b) => Number(b.archivedAt ?? 0) - Number(a.archivedAt ?? 0),
  );
}

function archivedItemsFromDocs(docs: MemoryDoc[]) {
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
          duplicateOf: doc.duplicateOf ? String(doc.duplicateOf) : null,
          source: doc.source ?? null,
          keywords: stringArray(doc.keyword).length
            ? stringArray(doc.keyword)
            : stringArray(doc.keywords),
        };
      })
      .filter((item): item is ForgettingCandidate => Boolean(item)),
  );
}

async function autoArchiveCandidates(
  uid: string,
  candidates: ForgettingCandidate[],
  token: string,
) {
  if (candidates.length === 0) return [];
  const now = Date.now();
  await Promise.all(
    candidates.map((candidate) =>
      patchFirestoreDocument(
        `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(candidate.memoryId)}`,
        {
          archivedAt: now,
          archiveReason: `auto-${candidate.reason}`,
          duplicateOf: candidate.duplicate
            ? candidate.duplicate.memoryId
            : null,
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { uid } = await params;
  const token = await getFirebaseAccessToken();
  const docs = await loadMemoryDocs(uid, token);
  const items = indexedMemoriesFromDocs(docs);
  const candidates = buildCandidates(items);
  const autoArchived = await autoArchiveCandidates(uid, candidates, token);

  return Response.json({
    candidates: autoArchived,
    archived: archivedItemsFromDocs(docs),
    thresholds: {
      duplicateSimilarity: DUPLICATE_SIMILARITY_THRESHOLD,
      lowWeight: LOW_WEIGHT_THRESHOLD,
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
    reason?: unknown;
    duplicateOf?: unknown;
  } | null;
  const memoryId = String(body?.memoryId ?? "");
  if (!memoryId) {
    return Response.json({ error: "missing memory item" }, { status: 400 });
  }

  const token = await getFirebaseAccessToken();
  const now = Date.now();
  await patchFirestoreDocument(
    `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryId)}`,
    {
      archivedAt: now,
      archiveReason: String(body?.reason ?? "manual-forgetting"),
      duplicateOf: body?.duplicateOf ?? null,
      updatedAt: now,
    },
    token,
  );
  return Response.json({ ok: true, archivedAt: now });
}
