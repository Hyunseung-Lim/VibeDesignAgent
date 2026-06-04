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
const MEMORY_COLLECTION = "memories_0_1_2";
const LEGACY_MEMORY_COLLECTION = "memories_0_1_1";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_SOURCE = "combined_no_timestamp";
const ACCEPTED_EMBEDDING_SOURCES = new Set(["combined", EMBEDDING_SOURCE]);
const MAX_MEMORY_DOCS = 200;
const DEFAULT_LIMIT = 5;
const NEAR_MISS_LIMIT = 20;
const NEAR_MISS_MIN_SIMILARITY = 0.55;
const NEAR_MISS_WEIGHT_LOSS = 0.005;
const NEAR_MISS_MAX_WEIGHT_LOSS = 0.0075;
const MIN_MEMORY_WEIGHT = 0.1;

type MemoryDoc = Record<string, unknown> & {
  id: string;
  embedding?: unknown;
  semanticItems?: Array<Record<string, unknown>>;
};

type Candidate = {
  id: string;
  memoryId: string;
  semanticItemId: string | null;
  path: string;
  doc: MemoryDoc;
  itemIndex: number | null;
  episodic: string;
  semantic: string | null;
  action: string;
  keyword: string[];
  input: string;
  output: string;
  link: string | null;
  embedding: number[];
  embeddingSource: string;
  weight: number;
  retrievedCount: number;
  lastRetrievedAt: number | null;
  timestamp: unknown;
  source: unknown;
  schemaVersion: string;
  similarity: number;
  legacy: boolean;
  weightDelta?: number;
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

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function timestampValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index];
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

function buildEmbeddingText(candidate: Pick<Candidate, "action" | "keyword" | "episodic" | "semantic" | "input" | "output" | "link">) {
  // Timestamp is retrieval metadata only; do not include it in vector text.
  return [
    candidate.action ? `Action: ${candidate.action}` : "",
    candidate.keyword.length ? `Keywords: ${candidate.keyword.join(", ")}` : "",
    candidate.episodic ? `Episodic: ${candidate.episodic}` : "",
    candidate.semantic ? `Semantic: ${candidate.semantic}` : "",
    candidate.input ? `Input: ${candidate.input}` : "",
    candidate.output ? `Output: ${candidate.output}` : "",
    candidate.link ? `Link: ${candidate.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function retrievalLogId(now: number, query: string) {
  return `${now}-${stableHash(query)}`;
}

async function loadCollectionDocs(uid: string, collection: string, token: string) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
  const docs = await Promise.all(
    ids.slice(-MAX_MEMORY_DOCS).map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${collection}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...data } as MemoryDoc;
    }),
  );
  return docs.filter((doc) => doc.type === "interaction" || doc.type === "profile");
}

function v2Candidate(uid: string, doc: MemoryDoc): Candidate | null {
  const episodic = String(doc.episodic ?? doc.episode ?? doc.content ?? "").trim();
  const semantic =
    typeof doc.semantic === "string" && doc.semantic.trim()
      ? doc.semantic.trim()
      : null;
  const embedding = numberArray(doc.embedding);
  if (!episodic || timestampValue(doc.archivedAt)) return null;
  return {
    id: doc.id,
    memoryId: doc.id,
    semanticItemId: null,
    path: `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(doc.id)}`,
    doc,
    itemIndex: null,
    episodic,
    semantic,
    action: String(doc.action ?? doc.agentActionCategory ?? "agent_response"),
    keyword: stringArray(doc.keyword).length
      ? stringArray(doc.keyword)
      : stringArray(doc.keywords),
    input: String(doc.input ?? ""),
    output: String(doc.output ?? ""),
    link: doc.link ? String(doc.link) : null,
    embedding,
    embeddingSource: String(doc.embeddingSource ?? (semantic ? "semantic" : "episodic")),
    weight: numberValue(doc.weight, 0.5),
    retrievedCount: numberValue(doc.retrievedCount),
    lastRetrievedAt: timestampValue(doc.lastRetrievedAt),
    timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
    source: doc.source ?? null,
    schemaVersion: String(doc.schemaVersion ?? "0.1.2"),
    similarity: -Infinity,
    legacy: false,
  };
}

function legacyCandidates(uid: string, doc: MemoryDoc): Candidate[] {
  const semanticItems = Array.isArray(doc.semanticItems) ? doc.semanticItems : [];
  const semantic = stringArray(doc.semantic);
  return semanticItems
    .map((item, index): Candidate | null => {
      const semanticText = String(item.semantic ?? semantic[index] ?? "").trim();
      const archivedAt = timestampValue(item.archivedAt);
      if (!semanticText || archivedAt) return null;
      const semanticItemId = String(item.id ?? `semantic-${index}`);
      return {
        id: `${doc.id}:${semanticItemId}`,
        memoryId: doc.id,
        semanticItemId,
        path: `users/${uid}/${LEGACY_MEMORY_COLLECTION}/${encodeURIComponent(doc.id)}`,
        doc,
        itemIndex: index,
        episodic: String(doc.content ?? doc.episode ?? "").trim(),
        semantic: semanticText,
        action: String(doc.agentActionCategory ?? "agent_response"),
        keyword: stringArray(doc.keywords),
        input: String(doc.input ?? ""),
        output: String(doc.output ?? ""),
        link: null,
        embedding: numberArray(item.embedding),
        embeddingSource: "semantic",
        weight: numberValue(item.weight ?? item.retentionScore, 0.5),
        retrievedCount: numberValue(item.retrievedCount),
        lastRetrievedAt: timestampValue(item.lastRetrievedAt),
        timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
        source: doc.source ?? null,
        schemaVersion: String(doc.schemaVersion ?? "0.1.1"),
        similarity: -Infinity,
        legacy: true,
      };
    })
    .filter((item): item is Candidate => Boolean(item));
}

async function ensureV2Embeddings(candidates: Candidate[], token: string) {
  // Regenerate: missing embedding OR built with old single-field method.
  // Existing "combined" embeddings are accepted because they were already timestamp-free.
  const stale = candidates.filter(
    (candidate) =>
      !candidate.legacy &&
      (candidate.embedding.length === 0 ||
        !ACCEPTED_EMBEDDING_SOURCES.has(candidate.embeddingSource)),
  );
  if (stale.length === 0) return;
  const now = Date.now();
  const embeddings = await embedTexts(
    stale.map((candidate) => buildEmbeddingText(candidate)),
  );
  await Promise.all(
    stale.map((candidate, index) => {
      candidate.embedding = embeddings[index] ?? [];
      candidate.embeddingSource = EMBEDDING_SOURCE;
      candidate.doc.embedding = candidate.embedding;
      candidate.doc.embeddingSource = EMBEDDING_SOURCE;
      candidate.doc.embeddingModel = EMBEDDING_MODEL;
      candidate.doc.updatedAt = now;
      return patchFirestoreDocument(
        candidate.path,
        {
          embedding: candidate.embedding,
          embeddingSource: EMBEDDING_SOURCE,
          embeddingModel: EMBEDDING_MODEL,
          updatedAt: now,
        },
        token,
      );
    }),
  );
}

async function loadCandidates(uid: string, token: string) {
  const v2Docs = await loadCollectionDocs(uid, MEMORY_COLLECTION, token);
  const v2 = v2Docs
    .map((doc) => v2Candidate(uid, doc))
    .filter((item): item is Candidate => Boolean(item));
  if (v2.length > 0) {
    await ensureV2Embeddings(v2, token);
    if (v2.some((candidate) => candidate.doc.type === "interaction")) {
      return v2;
    }
  }
  const legacyDocs = await loadCollectionDocs(uid, LEGACY_MEMORY_COLLECTION, token);
  const legacy = legacyDocs.flatMap((doc) => legacyCandidates(uid, doc));
  return [...v2, ...legacy];
}

function nextWeight(candidate: Candidate, wasRetrieved: boolean) {
  if (!wasRetrieved) return candidate.weight;
  const gain = 0.04 / Math.sqrt(candidate.retrievedCount + 1);
  return Number(Math.min(1, candidate.weight + gain).toFixed(4));
}

function memoryCountDecayMultiplier(memoryCount: number) {
  if (memoryCount >= 200) return 1.5;
  if (memoryCount >= 120) return 1.3;
  if (memoryCount >= 60) return 1.15;
  return 1;
}

function nearMissWeightLoss(memoryCount: number) {
  return Math.min(
    NEAR_MISS_MAX_WEIGHT_LOSS,
    NEAR_MISS_WEIGHT_LOSS * memoryCountDecayMultiplier(memoryCount),
  );
}

function nextNearMissWeight(candidate: Candidate, memoryCount: number) {
  const loss = nearMissWeightLoss(memoryCount);
  return Number(
    Math.max(MIN_MEMORY_WEIGHT, candidate.weight - loss).toFixed(4),
  );
}

async function updateRetrievedWeights(retrieved: Candidate[], token: string, now: number) {
  const deltas = await Promise.all(
    retrieved.map(async (candidate) => {
      const previousWeight = candidate.weight;
      const weight = nextWeight(candidate, true);
      const retrievedCount = candidate.retrievedCount + 1;
      if (candidate.legacy && candidate.itemIndex != null) {
        const semanticItems = Array.isArray(candidate.doc.semanticItems)
          ? [...candidate.doc.semanticItems]
          : [];
        semanticItems[candidate.itemIndex] = {
          ...(semanticItems[candidate.itemIndex] ?? {}),
          retentionScore: weight,
          retrievedCount,
          lastRetrievedAt: now,
          updatedAt: now,
        };
        await patchFirestoreDocument(
          candidate.path,
          { semanticItems, updatedAt: now },
          token,
        );
      } else {
        await patchFirestoreDocument(
          candidate.path,
          { weight, retrievedCount, lastRetrievedAt: now, updatedAt: now },
          token,
        );
      }
      candidate.weight = weight;
      candidate.retrievedCount = retrievedCount;
      candidate.lastRetrievedAt = now;
      candidate.weightDelta = Number((weight - previousWeight).toFixed(4));
      return {
        memoryId: candidate.memoryId,
        semanticItemId: candidate.semanticItemId,
        previousWeight,
        weight,
        weightDelta: candidate.weightDelta,
      };
    }),
  );
  return deltas;
}

async function updateNearMissWeights(
  nearMisses: Candidate[],
  token: string,
  now: number,
  memoryCount: number,
) {
  const deltas = await Promise.all(
    nearMisses.map(async (candidate) => {
      const previousWeight = candidate.weight;
      const weight = nextNearMissWeight(candidate, memoryCount);
      if (weight === previousWeight) {
        return {
          memoryId: candidate.memoryId,
          semanticItemId: candidate.semanticItemId,
          similarity: Number(candidate.similarity.toFixed(4)),
          previousWeight,
          weight,
          weightDelta: 0,
          decayMultiplier: memoryCountDecayMultiplier(memoryCount),
        };
      }

      if (candidate.legacy && candidate.itemIndex != null) {
        const semanticItems = Array.isArray(candidate.doc.semanticItems)
          ? [...candidate.doc.semanticItems]
          : [];
        semanticItems[candidate.itemIndex] = {
          ...(semanticItems[candidate.itemIndex] ?? {}),
          retentionScore: weight,
          updatedAt: now,
        };
        await patchFirestoreDocument(
          candidate.path,
          { semanticItems, updatedAt: now },
          token,
        );
      } else {
        await patchFirestoreDocument(
          candidate.path,
          { weight, updatedAt: now },
          token,
        );
      }

      candidate.weight = weight;
      candidate.weightDelta = Number((weight - previousWeight).toFixed(4));
      return {
        memoryId: candidate.memoryId,
        semanticItemId: candidate.semanticItemId,
        similarity: Number(candidate.similarity.toFixed(4)),
        previousWeight,
        weight,
        weightDelta: candidate.weightDelta,
        decayMultiplier: memoryCountDecayMultiplier(memoryCount),
      };
    }),
  );
  return deltas;
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

  let retrieved: Candidate[] = [];
  try {
    const token = await getFirebaseAccessToken();
    const now = Date.now();
    const [queryEmbedding] = await embedTexts([query]);

    const candidates = await loadCandidates(user.localId, token);
    const memoryCount = candidates.length;

    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        similarity:
          candidate.embedding.length === 0
            ? -Infinity
            : cosineSimilarity(queryEmbedding, candidate.embedding),
      }))
      .filter((candidate) => Number.isFinite(candidate.similarity))
      .sort((a, b) => b.similarity - a.similarity);

    retrieved = ranked.slice(0, limit);
    const scoreDeltas = await updateRetrievedWeights(retrieved, token, now);
    const nearMisses = ranked
      .slice(limit, NEAR_MISS_LIMIT)
      .filter((candidate) => candidate.similarity >= NEAR_MISS_MIN_SIMILARITY);
    const nearMissDeltas = await updateNearMissWeights(
      nearMisses,
      token,
      now,
      memoryCount,
    );

    await patchFirestoreDocument(
      `users/${user.localId}/${RETRIEVAL_LOG_COLLECTION}/${retrievalLogId(now, query)}`,
      {
        query: query.slice(0, 1000),
        queryEmbeddingModel: EMBEDDING_MODEL,
        missionId: missionId || null,
        memoryVersion: retrieved.some((candidate) => candidate.legacy)
          ? "0.1.1"
          : "0.1.2",
        retrievedMemoryIds: retrieved.map((candidate) => candidate.id),
        similarities: retrieved.map((candidate) =>
          Number(candidate.similarity.toFixed(4)),
        ),
        profileItemCount: retrieved.filter(
          (candidate) => candidate.doc.type === "profile",
        ).length,
        profileCandidateCount: candidates.filter(
          (candidate) => candidate.doc.type === "profile",
        ).length,
        profileItemIds: retrieved
          .filter((candidate) => candidate.doc.type === "profile")
          .map((candidate) => candidate.id),
        profileSimilarities: retrieved
          .filter((candidate) => candidate.doc.type === "profile")
          .map((candidate) => Number(candidate.similarity.toFixed(4))),
        memoryCount,
        nearMissDecayMultiplier: memoryCountDecayMultiplier(memoryCount),
        nearMissWeightLoss: nearMissWeightLoss(memoryCount),
        scoreDeltas,
        nearMissDeltas,
        createdAt: now,
      },
      token,
    );
  } catch (error) {
    console.warn("[memory/retrieve] unavailable, continuing without memory", error);
    return Response.json({ query, retrieved: [], unavailable: true });
  }

  return Response.json({
    query,
    retrieved: retrieved.map((candidate) => ({
        id: candidate.id,
        memoryId: candidate.memoryId,
        semanticItemId: candidate.semanticItemId,
        type: candidate.doc.type === "profile" ? "profile_memory" : "memory",
        sourceType: candidate.doc.sourceType ?? candidate.doc.memorySource ?? null,
        action: candidate.action,
        keyword: candidate.keyword,
        episodic: candidate.episodic,
        episode: candidate.episodic,
        semantic: candidate.semantic,
        input: candidate.input,
        output: candidate.output,
        link: candidate.link,
        embeddingSource: candidate.embeddingSource,
        source: candidate.source,
        timestamp: candidate.timestamp,
        schemaVersion: candidate.schemaVersion,
        similarity: Number(candidate.similarity.toFixed(4)),
        weight: candidate.weight,
        weightDelta: candidate.weightDelta ?? 0,
        retrievedCount: candidate.retrievedCount,
      })),
  });
}
