import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const CLUSTER_COLLECTION = "memoryClusters";
const MAX_MEMORY_DOCS = 300;
const MAX_RETRIEVAL_LOGS = 300;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceMissionId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return stringOrNull(source.missionId);
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function scoreDeltaArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const delta = item as Record<string, unknown>;
          const memoryId = stringOrNull(delta.memoryId);
          if (!memoryId) return null;
          return {
            memoryId,
            semanticItemId: stringOrNull(delta.semanticItemId),
            previousWeight: numberOrNull(delta.previousWeight),
            weight: numberOrNull(delta.weight),
            weightDelta: numberOrNull(delta.weightDelta),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
}

function timestampMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function graphClusterArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const cluster = item as Record<string, unknown>;
          const id = stringOrNull(cluster.id);
          if (!id) return null;
          return {
            id,
            label: stringOrNull(cluster.label) ?? "Memory cluster",
            summary: stringOrNull(cluster.summary) ?? "",
            count: numberOrNull(cluster.count) ?? 0,
            relatedActions: Array.isArray(cluster.relatedActions)
              ? cluster.relatedActions.map(String).filter(Boolean)
              : [],
            itemIds: Array.isArray(cluster.itemIds)
              ? cluster.itemIds.map(String).filter(Boolean)
              : [],
            representativeItems: Array.isArray(cluster.representativeItems)
              ? cluster.representativeItems.map(String).filter(Boolean)
              : [],
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
}

function graphEdgeArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const edge = item as Record<string, unknown>;
          const sourceId = stringOrNull(edge.sourceId);
          const targetId = stringOrNull(edge.targetId);
          const weight = numberOrNull(edge.weight);
          if (!sourceId || !targetId || sourceId === targetId || weight == null) {
            return null;
          }
          return { sourceId, targetId, weight };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
}

function memoryWeight(doc: Record<string, unknown>) {
  if (typeof doc.weight === "number" && Number.isFinite(doc.weight)) {
    return doc.weight;
  }
  return null;
}

function compactMemory(id: string, doc: Record<string, unknown>) {
  return {
    id,
    episodic: stringOrNull(doc.episodic ?? doc.episode ?? doc.content),
    semantic: stringOrNull(doc.semantic),
    input: stringOrNull(doc.input),
    output: stringOrNull(doc.output),
    originalInteractionContent: stringOrNull(doc.originalInteractionContent),
    agentActionCategory: stringOrNull(doc.agentActionCategory ?? doc.action),
    weight: memoryWeight(doc),
    archivedAt: numberOrNull(doc.archivedAt),
    archiveReason: stringOrNull(doc.archiveReason),
    duplicateOf: stringOrNull(doc.duplicateOf),
    duplicate:
      doc.duplicate && typeof doc.duplicate === "object"
        ? doc.duplicate
        : null,
    sourceType: stringOrNull(doc.sourceType ?? doc.memorySource),
    source: doc.source ?? null,
    timestamp: numberOrNull(doc.timestamp ?? doc.createdAt),
  };
}

function compactGraphMemory(item: ReturnType<typeof compactMemory>) {
  return {
    id: item.id,
    episodic: item.episodic,
    semantic: item.semantic,
    input: item.input,
    output: item.output,
    weight: item.weight,
    archivedAt: item.archivedAt,
    archiveReason: item.archiveReason,
    duplicateOf: item.duplicateOf,
    duplicate: item.duplicate,
    sourceType: item.sourceType,
    source: item.source,
    timestamp: item.timestamp,
  };
}

function referencedSummary(
  key: string,
  doc: ReturnType<typeof compactMemory> | null,
  events: Array<{
    createdAt: number | null;
    similarity: number | null;
    previousWeight: number | null;
    weight: number | null;
    weightDelta: number | null;
  }>,
) {
  const first = events[0];
  const last = events.at(-1);
  const totalDelta = events.reduce(
    (sum, event) => sum + (event.weightDelta ?? 0),
    0,
  );
  // weightAfter must reflect the memory's CURRENT weight, not the value at its
  // last retrieval — otherwise idle decay applied after retrieval makes the
  // review's number disagree with the live graph. weightDelta then captures the
  // net session change (retrieval gains AND idle decay), so decreases show too.
  const weightBefore = first?.previousWeight ?? null;
  const weightAfter = doc?.weight ?? last?.weight ?? null;
  const weightDelta =
    weightBefore != null && weightAfter != null
      ? Number((weightAfter - weightBefore).toFixed(4))
      : Number(totalDelta.toFixed(4));
  return {
    id: key,
    memoryId: doc?.id ?? key.split(":")[0],
    semanticItemId: key.split(":")[1] || null,
    episodic: doc?.episodic ?? null,
    semantic: doc?.semantic ?? null,
    input: doc?.input ?? null,
    output: doc?.output ?? null,
    source: doc?.source ?? null,
    timestamp: doc?.timestamp ?? first?.createdAt ?? null,
    archivedAt: doc?.archivedAt ?? null,
    archiveReason: doc?.archiveReason ?? null,
    duplicateOf: doc?.duplicateOf ?? null,
    duplicate: doc?.duplicate ?? null,
    referenceCount: events.length,
    firstReferencedAt: first?.createdAt ?? null,
    lastReferencedAt: last?.createdAt ?? null,
    similarity: last?.similarity ?? null,
    weightBefore,
    weightAfter,
    weightDelta,
  };
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetUid?: unknown;
    missionId?: unknown;
  };
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const requestedTargetUid = stringOrNull(body.targetUid);
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const sessionPath = `sessions/${targetUid}/missions/${encodeURIComponent(
    missionId,
  )}`;
  const draftIds = await listFirestoreDocumentIds(
    `${sessionPath}/memoryDrafts`,
    token,
  );
  const draftIdSet = new Set(draftIds);
  const drafts = (
    await Promise.all(
      draftIds.map(async (id) => {
        const doc =
          ((await getFirestoreDocument(
            `${sessionPath}/memoryDrafts/${encodeURIComponent(id)}`,
            token,
          )) ?? {}) as Record<string, unknown>;
        return {
          id,
          episodic: stringOrNull(doc.episode ?? doc.episodic),
          semantic:
            stringOrNull(doc.semantic) ??
            (Array.isArray(doc.semanticJson)
              ? stringOrNull(doc.semanticJson[0])
              : null),
          input: stringOrNull(doc.input),
          output: stringOrNull(doc.output),
          originalInteractionContent: stringOrNull(doc.originalInteractionContent),
          agentActionCategory: stringOrNull(
            doc.agentActionCategory ?? doc.action,
          ),
          status: stringOrNull(doc.status),
          promotedAt: numberOrNull(doc.promotedAt),
          timestamp: numberOrNull(doc.timestamp ?? doc.createdAt),
        };
      }),
    )
  ).filter((draft) => draft.status !== "promoted" && !draft.promotedAt);

  const allMemories = (
    await Promise.all(
      (
        await listFirestoreDocumentIds(
          `users/${targetUid}/${MEMORY_COLLECTION}`,
          token,
        )
      )
        .slice(-MAX_MEMORY_DOCS)
        .map(async (id) => {
          const doc =
            ((await getFirestoreDocument(
              `users/${targetUid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
              token,
            )) ?? {}) as Record<string, unknown>;
          return compactMemory(id, doc);
        }),
    )
  );
  const memoryById = new Map(allMemories.map((item) => [item.id, item]));

  const promoted = allMemories
    .filter((item) => {
      if (sourceMissionId(item.source) !== missionId) return false;
      const src =
        item.source && typeof item.source === "object"
          ? (item.source as Record<string, unknown>)
          : null;
      const draftId = stringOrNull(src?.draftId);
      // Cross-check against the session's actual memoryDrafts to prevent memories
      // from other sessions from leaking in.
      if (draftId !== null && !draftIdSet.has(draftId)) return false;
      return true;
    })
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));

  const logIds = await listFirestoreDocumentIds(
    `users/${targetUid}/${RETRIEVAL_LOG_COLLECTION}`,
    token,
  );
  const logs = await Promise.all(
    logIds.slice(-MAX_RETRIEVAL_LOGS).map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `users/${targetUid}/${RETRIEVAL_LOG_COLLECTION}/${encodeURIComponent(id)}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return {
        id,
        missionId: stringOrNull(doc.missionId),
        createdAt: numberOrNull(doc.createdAt),
        retrievedMemoryIds: Array.isArray(doc.retrievedMemoryIds)
          ? doc.retrievedMemoryIds.map(String)
          : [],
        similarities: numberArray(doc.similarities),
        scoreDeltas: scoreDeltaArray(doc.scoreDeltas),
        idleDecayDeltas: scoreDeltaArray(doc.idleDecayDeltas),
      };
    }),
  );
  const referencedEvents = new Map<
    string,
    Array<{
      createdAt: number | null;
      similarity: number | null;
      previousWeight: number | null;
      weight: number | null;
      weightDelta: number | null;
    }>
  >();
  logs
    .filter((log) => log.missionId === missionId)
    .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))
    .forEach((log) => {
      log.scoreDeltas.forEach((delta) => {
        const key = `${delta.memoryId}:${delta.semanticItemId ?? ""}`;
        const similarityIndex = log.retrievedMemoryIds.findIndex(
          (id) => id === key || id === delta.memoryId,
        );
        const events = referencedEvents.get(key) ?? [];
        events.push({
          createdAt: log.createdAt,
          similarity:
            similarityIndex >= 0 ? log.similarities[similarityIndex] ?? null : null,
          previousWeight: delta.previousWeight,
          weight: delta.weight,
          weightDelta: delta.weightDelta,
        });
        referencedEvents.set(key, events);
      });
    });
  const referenced = Array.from(referencedEvents.entries())
    .map(([key, events]) =>
      referencedSummary(key, memoryById.get(key.split(":")[0]) ?? null, events),
    )
    .sort(
      (a, b) =>
        Number(b.lastReferencedAt ?? 0) - Number(a.lastReferencedAt ?? 0),
    );
  // Aggregate idle decay (usage-based forgetting) for this session so the review
  // can explain that unused memories weakened, without dumping per-memory deltas.
  const idleDecayMemoryIds = new Set<string>();
  let idleDecayTotal = 0;
  logs
    .filter((log) => log.missionId === missionId)
    .forEach((log) => {
      log.idleDecayDeltas.forEach((delta) => {
        if (delta.weightDelta != null && delta.weightDelta < 0) {
          idleDecayMemoryIds.add(delta.memoryId);
          idleDecayTotal += delta.weightDelta;
        }
      });
    });
  const idleDecaySummary = {
    memoryCount: idleDecayMemoryIds.size,
    totalDelta: Number(idleDecayTotal.toFixed(4)),
  };

  const graphMemories = allMemories
    .filter((item) => item.weight != null)
    .map(compactGraphMemory)
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));
  const clusterIds = await listFirestoreDocumentIds(
    `users/${targetUid}/${CLUSTER_COLLECTION}`,
    token,
  );
  const clusterDocs = await Promise.all(
    clusterIds.map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `users/${targetUid}/${CLUSTER_COLLECTION}/${encodeURIComponent(id)}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return {
        id,
        generatedAt: timestampMs(doc.generatedAt),
        sourceItemCount: numberOrNull(doc.sourceItemCount) ?? 0,
        graphClusters: graphClusterArray(doc.graphClusters),
        graphEdges: graphEdgeArray(doc.graphEdges),
      };
    }),
  );
  const selectedClusterDoc =
    clusterDocs
      .filter((doc) => doc.graphClusters.length > 0)
      .sort((a, b) => {
        const countDiff =
          Math.abs(graphMemories.length - a.sourceItemCount) -
          Math.abs(graphMemories.length - b.sourceItemCount);
        if (countDiff !== 0) return countDiff;
        return b.generatedAt - a.generatedAt;
      })[0] ?? null;

  // The target user's per-user mission order, used by the review to compute the
  // cumulative memory set (missions are ordered per user, not by id/time).
  const userProfile = (await getFirestoreDocument(`users/${targetUid}`, token)) as
    | Record<string, unknown>
    | null;
  const missionOrder = Array.isArray(userProfile?.missionOrder)
    ? userProfile.missionOrder.map(String)
    : [];

  return Response.json({
    drafts,
    promoted,
    referenced,
    idleDecaySummary,
    graphMemories,
    graphClusters: selectedClusterDoc?.graphClusters ?? [],
    graphEdges: selectedClusterDoc?.graphEdges ?? [],
    missionOrder,
  });
}
