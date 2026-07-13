import { createHash } from "crypto";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  clusterSummaryByItemId,
  loadLatestStoredClusters,
} from "@/lib/server/memoryClustering";
import {
  embedMemoryTexts,
  ensureFreshMemoryEmbeddings,
  MEMORY_EMBEDDING_MODEL,
} from "@/lib/server/memoryEmbedding";
import { isActiveMemoryDocument } from "@/lib/server/memoryActivity";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const MAX_MEMORY_DOCS = 200;
const DEFAULT_LIMIT = 10;
// Usage-based forgetting: every retrieval nudges down all memories that were
// NOT retrieved this turn, so unused memories drift toward the floor while
// repeatedly-used ones stay high. Wall-clock independent (safe for the 3-day
// formative study). Replaces the old narrow near-miss decay which, in practice,
// almost never fired — see scripts/analyze_memory_weights.py (weight only ever
// rose: +835 vs -61 delta events across users, nothing below the 0.5 default).
const IDLE_DECAY_WEIGHT_LOSS = 0.01;
const IDLE_DECAY_MAX_WEIGHT_LOSS = 0.006;
const MIN_MEMORY_WEIGHT = 0.1;

type MemoryDoc = Record<string, unknown> & {
  id: string;
  embedding?: unknown;
};

type Candidate = {
  id: string;
  memoryId: string;
  semanticItemId: string | null;
  path: string;
  doc: MemoryDoc;
  episodic: string;
  semantic: string | null;
  action: string;
  keyword: string[];
  input: string;
  output: string;
  originalInteractionContent: string;
  preferenceSignal: unknown;
  link: string | null;
  sourceType: string | null;
  embedding: number[];
  embeddingSource: string;
  weight: number;
  retrievedCount: number;
  lastRetrievedAt: number | null;
  timestamp: unknown;
  source: unknown;
  schemaVersion: string;
  similarity: number;
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
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function timestampValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index];
  return sum;
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function retrievalLogId(now: number, query: string) {
  return `${now}-${stableHash(query)}`;
}

async function loadCollectionDocs(
  uid: string,
  collection: string,
  token: string,
) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${collection}`,
    token,
  );
  const docs = await Promise.all(
    ids.slice(-MAX_MEMORY_DOCS).map(async (id) => {
      const data = ((await getFirestoreDocument(
        `users/${uid}/${collection}/${id}`,
        token,
      )) ?? {}) as Record<string, unknown>;
      return { id, ...data } as MemoryDoc;
    }),
  );
  return docs.filter((doc) => {
    const sourceType = String(
      doc.sourceType ?? doc.memorySource ?? doc.type ?? "",
    );
    return sourceType === "during_session" || sourceType === "before_session";
  });
}

function isBeforeSessionDoc(doc: MemoryDoc) {
  return (
    String(doc.sourceType ?? doc.memorySource ?? doc.type ?? "") ===
    "before_session"
  );
}

function sourceMissionId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const missionId = source.missionId;
  return typeof missionId === "string" && missionId.trim()
    ? missionId.trim()
    : null;
}

function beforeSessionScope(candidate: Candidate, currentMissionId: string) {
  if (!isBeforeSessionDoc(candidate.doc)) return null;
  const candidateMissionId = sourceMissionId(candidate.source);
  if (!candidateMissionId) return "unknown_mission";
  if (!currentMissionId) return "unknown_current_mission";
  return candidateMissionId === currentMissionId
    ? "current_mission"
    : "prior_mission";
}

function responseMemory(
  candidate: Candidate,
  missionId: string,
  clusterByItemId: Map<
    string,
    { clusterId: string; label: string; summary: string }
  >,
) {
  return {
    id: candidate.id,
    memoryId: candidate.memoryId,
    semanticItemId: candidate.semanticItemId,
    clusterId: clusterByItemId.get(candidate.id)?.clusterId ?? null,
    clusterLabel: clusterByItemId.get(candidate.id)?.label ?? null,
    clusterSummary: clusterByItemId.get(candidate.id)?.summary ?? null,
    type: isBeforeSessionDoc(candidate.doc)
      ? "before_session_memory"
      : "during_session_memory",
    sourceType: candidate.doc.sourceType ?? candidate.doc.memorySource ?? null,
    action: candidate.action,
    keyword: candidate.keyword,
    episodic: candidate.episodic,
    episode: candidate.episodic,
    semantic: candidate.semantic,
    input: candidate.input,
    output: candidate.output,
    originalInteractionContent: candidate.originalInteractionContent,
    preferenceSignal: candidate.doc.preferenceSignal ?? null,
    link: candidate.link,
    embeddingSource: candidate.embeddingSource,
    source: candidate.source,
    sourceMissionId: sourceMissionId(candidate.source),
    beforeSessionScope: beforeSessionScope(candidate, missionId),
    timestamp: candidate.timestamp,
    schemaVersion: candidate.schemaVersion,
    similarity: Number.isFinite(candidate.similarity)
      ? Number(candidate.similarity.toFixed(4))
      : null,
    weight: candidate.weight,
    weightDelta: candidate.weightDelta ?? 0,
    retrievedCount: candidate.retrievedCount,
  };
}

function v2Candidate(uid: string, doc: MemoryDoc): Candidate | null {
  const sourceType = String(
    doc.sourceType ?? doc.memorySource ?? doc.type ?? "",
  );
  const episodic = String(
    doc.episodic ?? doc.episode ?? doc.content ?? "",
  ).trim();
  const semantic =
    typeof doc.semantic === "string" && doc.semantic.trim()
      ? doc.semantic.trim()
      : null;
  const embedding = numberArray(doc.embedding);
  if (!episodic || !isActiveMemoryDocument(doc)) return null;
  return {
    id: doc.id,
    memoryId: doc.id,
    semanticItemId: null,
    path: `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(doc.id)}`,
    doc,
    episodic,
    semantic,
    action: String(doc.action ?? doc.agentActionCategory ?? "agent_response"),
    keyword: stringArray(doc.keyword).length
      ? stringArray(doc.keyword)
      : stringArray(doc.keywords),
    input: String(doc.input ?? ""),
    output: String(doc.output ?? ""),
    originalInteractionContent: String(doc.originalInteractionContent ?? ""),
    preferenceSignal: doc.preferenceSignal ?? null,
    link: doc.link ? String(doc.link) : null,
    sourceType,
    embedding,
    embeddingSource: String(
      doc.embeddingSource ?? (semantic ? "semantic" : "episodic"),
    ),
    weight: numberValue(doc.weight, 0.5),
    retrievedCount: numberValue(doc.retrievedCount),
    lastRetrievedAt: timestampValue(doc.lastRetrievedAt),
    timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
    source: doc.source ?? null,
    schemaVersion: String(doc.schemaVersion ?? "0.1.2"),
    similarity: -Infinity,
  };
}

async function loadCandidates(uid: string, token: string) {
  const v2Docs = await loadCollectionDocs(uid, MEMORY_COLLECTION, token);
  const v2 = v2Docs
    .map((doc) => v2Candidate(uid, doc))
    .filter((item): item is Candidate => Boolean(item));
  await ensureFreshMemoryEmbeddings(v2, token);
  return v2;
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

function idleDecayWeightLoss(memoryCount: number) {
  return Math.min(
    IDLE_DECAY_MAX_WEIGHT_LOSS,
    IDLE_DECAY_WEIGHT_LOSS * memoryCountDecayMultiplier(memoryCount),
  );
}

function nextIdleWeight(candidate: Candidate, memoryCount: number) {
  const loss = idleDecayWeightLoss(memoryCount);
  return Number(
    Math.max(MIN_MEMORY_WEIGHT, candidate.weight - loss).toFixed(4),
  );
}

async function updateRetrievedWeights(
  retrieved: Candidate[],
  token: string,
  now: number,
) {
  const deltas = await Promise.all(
    retrieved.map(async (candidate) => {
      const previousWeight = candidate.weight;
      const weight = nextWeight(candidate, true);
      const retrievedCount = candidate.retrievedCount + 1;
      await patchFirestoreDocument(
        candidate.path,
        { weight, retrievedCount, lastRetrievedAt: now, updatedAt: now },
        token,
      );
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

async function updateIdleDecayWeights(
  idleTargets: Candidate[],
  token: string,
  now: number,
  memoryCount: number,
) {
  const deltas = await Promise.all(
    idleTargets.map(async (candidate) => {
      const previousWeight = candidate.weight;
      const weight = nextIdleWeight(candidate, memoryCount);
      // Already at the floor — nothing to write, and keep the log lean since we
      // now decay every non-retrieved memory each turn.
      if (weight === previousWeight) return null;

      await patchFirestoreDocument(
        candidate.path,
        { weight, updatedAt: now },
        token,
      );

      candidate.weight = weight;
      candidate.weightDelta = Number((weight - previousWeight).toFixed(4));
      return {
        memoryId: candidate.memoryId,
        semanticItemId: candidate.semanticItemId,
        similarity: Number.isFinite(candidate.similarity)
          ? Number(candidate.similarity.toFixed(4))
          : null,
        previousWeight,
        weight,
        weightDelta: candidate.weightDelta,
        decayMultiplier: memoryCountDecayMultiplier(memoryCount),
      };
    }),
  );
  return deltas.filter((d): d is NonNullable<typeof d> => d !== null);
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    missionId?: unknown;
    limit?: unknown;
    interactionId?: unknown;
    userMessageId?: unknown;
  };
  const query = String(body.query ?? "").trim();
  const missionId = String(body.missionId ?? "").trim();
  const interactionId = String(body.interactionId ?? "")
    .trim()
    .slice(0, 200);
  const userMessageId = String(body.userMessageId ?? "")
    .trim()
    .slice(0, 200);
  const limit = Math.max(
    1,
    Math.min(10, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  let retrieved: Candidate[] = [];
  let clusterByItemId = new Map<
    string,
    { clusterId: string; label: string; summary: string }
  >();
  try {
    const token = await getFirebaseAccessToken();
    const now = Date.now();
    const [queryEmbedding] = await embedMemoryTexts([query]);

    const candidates = await loadCandidates(user.localId, token);
    const memoryCount = candidates.length;

    const ranked = candidates
      .map((candidate) => {
        const similarity =
          candidate.embedding.length === 0
            ? -Infinity
            : cosineSimilarity(queryEmbedding, candidate.embedding);
        return {
          ...candidate,
          similarity,
        };
      })
      .filter((candidate) => Number.isFinite(candidate.similarity))
      .sort((a, b) => b.similarity - a.similarity);

    retrieved = ranked.slice(0, limit);
    // Best-effort: attach the persona summary of the cluster each retrieved item
    // belongs to. Used by the chat planner to pick user-specific actions without
    // re-summarizing. Never blocks retrieval — cache miss just yields no summary.
    try {
      const clusters = await loadLatestStoredClusters(user.localId, token);
      if (clusters.length > 0) {
        clusterByItemId = clusterSummaryByItemId(clusters);
      }
    } catch (clusterError) {
      console.warn(
        "[memory/retrieve] cluster summary lookup failed",
        clusterError,
      );
    }
    const scoreDeltas = await updateRetrievedWeights(retrieved, token, now);
    // Decay every memory that was NOT retrieved this turn (usage-based forgetting).
    const idleTargets = ranked.slice(limit);
    const idleDecayDeltas = await updateIdleDecayWeights(
      idleTargets,
      token,
      now,
      memoryCount,
    );
    const retrievedBeforeSession = retrieved.filter((candidate) =>
      isBeforeSessionDoc(candidate.doc),
    );
    const profileItemScopes = retrievedBeforeSession.map((candidate) => ({
      id: candidate.id,
      sourceMissionId: sourceMissionId(candidate.source),
      beforeSessionScope: beforeSessionScope(candidate, missionId),
    }));
    await patchFirestoreDocument(
      `users/${user.localId}/${RETRIEVAL_LOG_COLLECTION}/${retrievalLogId(now, query)}`,
      {
        query: query.slice(0, 1000),
        interactionId: interactionId || null,
        userMessageId: userMessageId || null,
        queryEmbeddingModel: MEMORY_EMBEDDING_MODEL,
        missionId: missionId || null,
        memoryVersion: "0.1.2",
        retrievalRankingPolicy: {
          beforeSession: "same_similarity_ranking_as_other_memories",
          currentBeforeSession:
            "same_similarity_ranking_no_forced_prompt_inclusion",
        },
        includedCurrentSetupMemoryIds: [],
        includedCurrentSetupMemoryCount: 0,
        includedCurrentSetupMemoryScopes: [],
        retrievedMemoryIds: retrieved.map((candidate) => candidate.id),
        similarities: retrieved.map((candidate) =>
          Number(candidate.similarity.toFixed(4)),
        ),
        profileItemCount: retrieved.filter((candidate) =>
          isBeforeSessionDoc(candidate.doc),
        ).length,
        profileCurrentMissionItemCount: profileItemScopes.filter(
          (item) => item.beforeSessionScope === "current_mission",
        ).length,
        profilePriorMissionItemCount: profileItemScopes.filter(
          (item) => item.beforeSessionScope === "prior_mission",
        ).length,
        profileCandidateCount: candidates.filter((candidate) =>
          isBeforeSessionDoc(candidate.doc),
        ).length,
        profileItemIds: retrievedBeforeSession.map((candidate) => candidate.id),
        profileItemScopes,
        profileSimilarities: retrieved
          .filter((candidate) => isBeforeSessionDoc(candidate.doc))
          .map((candidate) => Number(candidate.similarity.toFixed(4))),
        memoryCount,
        idleDecayMultiplier: memoryCountDecayMultiplier(memoryCount),
        idleDecayWeightLoss: idleDecayWeightLoss(memoryCount),
        idleDecayCount: idleDecayDeltas.length,
        scoreDeltas,
        idleDecayDeltas,
        createdAt: now,
      },
      token,
    );
  } catch (error) {
    console.warn(
      "[memory/retrieve] unavailable, continuing without memory",
      error,
    );
    return Response.json({ query, retrieved: [], unavailable: true });
  }

  return Response.json({
    query,
    currentBeforeSessionSetup: [],
    retrieved: retrieved.map((candidate) =>
      responseMemory(candidate, missionId, clusterByItemId),
    ),
  });
}
