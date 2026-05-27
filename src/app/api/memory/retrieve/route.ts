import OpenAI from "openai";
import { createHash } from "crypto";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_COLLECTION = "memories_0_1_1";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_MEMORY_DOCS = 200;
const MAX_CANDIDATES = 20;
const DEFAULT_LIMIT = 5;

type SemanticItem = {
  id: string;
  semantic: string;
  embedding?: number[];
  embeddingModel?: string;
  importanceScore?: number;
  usageScore?: number;
  decayScore?: number;
  retentionScore?: number;
  lastRetrievedAt?: number | null;
  retrievedCount?: number;
  duplicateOf?: string | null;
  archivedAt?: number | null;
  archiveReason?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type MemoryDoc = Record<string, unknown> & {
  id: string;
  semanticItems?: SemanticItem[];
};

type Candidate = {
  doc: MemoryDoc;
  item: SemanticItem;
  itemIndex: number;
  similarity: number;
};

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => l2Normalize(item.embedding));
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function retrievalLogId(now: number, query: string) {
  return `${now}-${stableHash(query)}`;
}

function normalizeSemanticItems(doc: MemoryDoc, now: number) {
  const existingItems = Array.isArray(doc.semanticItems)
    ? doc.semanticItems
    : [];
  const semantic = stringArray(doc.semantic);
  if (existingItems.length > 0) {
    return existingItems
      .map((item, index) => ({
        ...item,
        id: String(item.id ?? `semantic-${index}`),
        semantic: String(item.semantic ?? semantic[index] ?? "").trim(),
        embedding: numberArray(item.embedding),
        importanceScore: Number(item.importanceScore ?? 0.5),
        usageScore: Number(item.usageScore ?? 0),
        decayScore: Number(item.decayScore ?? 0),
        retentionScore: Number(item.retentionScore ?? 0.5),
        lastRetrievedAt:
          typeof item.lastRetrievedAt === "number" ? item.lastRetrievedAt : null,
        retrievedCount: Number(item.retrievedCount ?? 0),
        duplicateOf: item.duplicateOf ? String(item.duplicateOf) : null,
        archivedAt: typeof item.archivedAt === "number" ? item.archivedAt : null,
        archiveReason: item.archiveReason ? String(item.archiveReason) : null,
        createdAt: Number(item.createdAt ?? doc.createdAt ?? now),
        updatedAt: Number(item.updatedAt ?? doc.updatedAt ?? now),
      }))
      .filter((item) => item.semantic);
  }

  return semantic.map((item, index) => ({
    id: `semantic-${index}`,
    semantic: item,
    embedding: [],
    embeddingModel: EMBEDDING_MODEL,
    importanceScore: 0.5,
    usageScore: 0,
    decayScore: 0,
    retentionScore: 0.5,
    lastRetrievedAt: null,
    retrievedCount: 0,
    duplicateOf: null,
    archivedAt: null,
    archiveReason: null,
    createdAt: Number(doc.createdAt ?? doc.timestamp ?? now),
    updatedAt: Number(doc.updatedAt ?? doc.createdAt ?? now),
  }));
}

function recencyBoost(lastRetrievedAt: number | null, now: number) {
  if (!lastRetrievedAt) return 0;
  const days = Math.max(0, (now - lastRetrievedAt) / 86_400_000);
  return Math.max(0, 0.18 - days * 0.01);
}

function ageDecay(createdAt: number, now: number) {
  const days = Math.max(0, (now - createdAt) / 86_400_000);
  return Math.min(0.4, days * 0.002);
}

function retentionScore(item: SemanticItem, now: number) {
  return Number(
    (
      Number(item.importanceScore ?? 0.5) +
      Number(item.usageScore ?? 0) +
      recencyBoost(item.lastRetrievedAt ?? null, now) -
      ageDecay(Number(item.createdAt ?? now), now) -
      Number(item.decayScore ?? 0)
    ).toFixed(4),
  );
}

async function loadMemoryDocs(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  const docs = await Promise.all(
    ids.slice(-MAX_MEMORY_DOCS).map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${MEMORY_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...data } as MemoryDoc;
    }),
  );
  return docs.filter((doc) => doc.type === "interaction");
}

async function ensureEmbeddings(uid: string, docs: MemoryDoc[], token: string) {
  const now = Date.now();
  const missing: Array<{ doc: MemoryDoc; item: SemanticItem; index: number }> =
    [];

  docs.forEach((doc) => {
    const items = normalizeSemanticItems(doc, now);
    doc.semanticItems = items;
    items.forEach((item, index) => {
      if (!item.embedding || item.embedding.length === 0) {
        missing.push({ doc, item, index });
      }
    });
  });

  if (missing.length === 0) return docs;
  const embeddings = await embedTexts(missing.map(({ item }) => item.semantic));
  const changedDocs = new Map<string, MemoryDoc>();
  missing.forEach(({ doc, index }, missingIndex) => {
    if (!doc.semanticItems) return;
    doc.semanticItems[index] = {
      ...doc.semanticItems[index],
      embedding: embeddings[missingIndex] ?? [],
      embeddingModel: EMBEDDING_MODEL,
      updatedAt: now,
    };
    changedDocs.set(doc.id, doc);
  });

  await Promise.all(
    Array.from(changedDocs.values()).map((doc) =>
      patchFirestoreDocument(
        `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(doc.id)}`,
        {
          semanticItems: doc.semanticItems ?? [],
          updatedAt: now,
        },
        token,
      ),
    ),
  );

  return docs;
}

function updateCandidateScores(
  uid: string,
  candidates: Candidate[],
  retrieved: Candidate[],
  now: number,
) {
  const retrievedIds = new Set(
    retrieved.map((candidate) => `${candidate.doc.id}:${candidate.item.id}`),
  );
  const touchedDocs = new Map<string, MemoryDoc>();
  const scoreDeltas: Array<{
    memoryId: string;
    semanticItemId: string;
    usageDelta: number;
    decayDelta: number;
    retentionScore: number;
  }> = [];

  candidates.slice(0, MAX_CANDIDATES).forEach((candidate) => {
    const key = `${candidate.doc.id}:${candidate.item.id}`;
    const current = candidate.doc.semanticItems?.[candidate.itemIndex];
    if (!current) return;
    const wasRetrieved = retrievedIds.has(key);
    const retrievedCount = Number(current.retrievedCount ?? 0);
    const usageDelta = wasRetrieved
      ? Number((0.03 / Math.sqrt(retrievedCount + 1)).toFixed(4))
      : 0;
    const decayDelta = wasRetrieved ? 0 : 0.005;
    const nextItem: SemanticItem = {
      ...current,
      usageScore: Number((Number(current.usageScore ?? 0) + usageDelta).toFixed(4)),
      decayScore: Number((Number(current.decayScore ?? 0) + decayDelta).toFixed(4)),
      retrievedCount: wasRetrieved ? retrievedCount + 1 : retrievedCount,
      lastRetrievedAt: wasRetrieved ? now : (current.lastRetrievedAt ?? null),
      updatedAt: now,
    };
    nextItem.retentionScore = retentionScore(nextItem, now);
    candidate.doc.semanticItems![candidate.itemIndex] = nextItem;
    touchedDocs.set(candidate.doc.id, candidate.doc);
    scoreDeltas.push({
      memoryId: candidate.doc.id,
      semanticItemId: candidate.item.id,
      usageDelta,
      decayDelta,
      retentionScore: nextItem.retentionScore,
    });
  });

  return {
    patches: Array.from(touchedDocs.values()).map((doc) => ({
      path: `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(doc.id)}`,
      data: {
        semanticItems: doc.semanticItems ?? [],
        updatedAt: now,
      },
    })),
    scoreDeltas,
  };
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    missionId?: unknown;
    limit?: unknown;
  };
  const query = String(body.query ?? "").trim();
  const missionId = String(body.missionId ?? "").trim();
  const limit = Math.max(
    1,
    Math.min(10, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const token = await getFirebaseAccessToken();
  const now = Date.now();
  const [queryEmbedding] = await embedTexts([query]);
  const docs = await ensureEmbeddings(
    user.localId,
    await loadMemoryDocs(user.localId, token),
    token,
  );

  const candidates = docs
    .flatMap((doc) =>
      (doc.semanticItems ?? []).map((item, itemIndex) => ({
        doc,
        item,
        itemIndex,
        similarity:
          item.archivedAt || !item.embedding || item.embedding.length === 0
            ? -Infinity
            : cosineSimilarity(queryEmbedding, item.embedding),
      })),
    )
    .filter((candidate) => Number.isFinite(candidate.similarity))
    .sort((a, b) => b.similarity - a.similarity);

  const retrieved = candidates.slice(0, limit);
  const { patches, scoreDeltas } = updateCandidateScores(
    user.localId,
    candidates,
    retrieved,
    now,
  );

  await Promise.all([
    ...patches.map((patch) => patchFirestoreDocument(patch.path, patch.data, token)),
    patchFirestoreDocument(
      `users/${user.localId}/${RETRIEVAL_LOG_COLLECTION}/${retrievalLogId(now, query)}`,
      {
        query: query.slice(0, 1000),
        queryEmbeddingModel: EMBEDDING_MODEL,
        missionId: missionId || null,
        retrievedMemoryIds: retrieved.map(
          (candidate) => `${candidate.doc.id}:${candidate.item.id}`,
        ),
        similarities: retrieved.map((candidate) =>
          Number(candidate.similarity.toFixed(4)),
        ),
        scoreDeltas,
        createdAt: now,
      },
      token,
    ),
  ]);

  return Response.json({
    query,
    retrieved: retrieved.map((candidate) => {
      const current = candidate.doc.semanticItems?.[candidate.itemIndex] ?? candidate.item;
      return {
        id: `${candidate.doc.id}-${candidate.item.id}`,
        memoryId: candidate.doc.id,
        semanticItemId: candidate.item.id,
        type: "semantic",
        semantic: candidate.item.semantic,
        episode: String(candidate.doc.content ?? "").trim(),
        source: candidate.doc.source,
        timestamp:
          candidate.doc.timestamp ?? candidate.doc.occurredAt ?? candidate.doc.createdAt,
        schemaVersion: candidate.doc.schemaVersion,
        similarity: Number(candidate.similarity.toFixed(4)),
        retentionScore: current.retentionScore ?? retentionScore(current, now),
        retrievedCount: current.retrievedCount ?? 0,
      };
    }),
  });
}
