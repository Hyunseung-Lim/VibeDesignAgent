import {
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
} from "@/lib/server/firebaseAdminRest";
import { isActiveMemoryDocument } from "@/lib/server/memoryActivity";

const MEMORY_COLLECTION = "memories_0_1_2";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const MAX_RETRIEVAL_LOGS = 100;
// Retrieval already rewards memories used in the answer. Feedback deltas are
// calibrated so the net effect is approximately +0.08 for good and -0.04 for bad.
const GOOD_FEEDBACK_WEIGHT_DELTA = 0.04;
const BAD_FEEDBACK_WEIGHT_DELTA = -0.08;

type AssistantFeedbackVote = "good" | "bad";

export type AssistantFeedbackWeightAdjustment = {
  version?: string;
  vote?: AssistantFeedbackVote;
  deltaPerMemory?: number;
  targetMessageId?: string | null;
  targetUserMessageId?: string | null;
  retrievedMemoryIds?: unknown;
};

type FeedbackWeightDelta = {
  memoryId: string;
  previousWeight: number;
  weight: number;
  weightDelta: number;
};

type RetrievalLog = Record<string, unknown> & { id: string };

export type AssistantFeedbackWeightAdjustmentResult = {
  version: "0.1.0";
  vote: AssistantFeedbackVote;
  deltaPerMemory: number;
  targetMessageId: string | null;
  targetUserMessageId: string | null;
  retrievedMemoryIds: string[];
  deltas: FeedbackWeightDelta[];
  skippedReason: string | null;
  appliedAt: number;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function clampWeight(value: number) {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function feedbackDelta(vote: AssistantFeedbackVote) {
  return vote === "good" ? GOOD_FEEDBACK_WEIGHT_DELTA : BAD_FEEDBACK_WEIGHT_DELTA;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function extractedMemoryIdsFromReviewTurn(doc: Record<string, unknown> | null) {
  if (!doc || !Array.isArray(doc.retrieved)) return [];
  return uniqueStrings(
    doc.retrieved.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return [record.memoryId, record.id].map((value) =>
        typeof value === "string" ? value : "",
      );
    }),
  );
}

async function loadReviewTurnMemoryIds(
  uid: string,
  missionId: string,
  targetMessageId: string | null,
  token: string,
) {
  if (!targetMessageId) return [];
  const doc = await getFirestoreDocument(
    `sessions/${uid}/missions/${encodeURIComponent(missionId)}/reviewTurns/${encodeURIComponent(targetMessageId)}`,
    token,
  );
  return extractedMemoryIdsFromReviewTurn(doc);
}

function retrievalLogMatches(
  log: Record<string, unknown>,
  missionId: string,
  targetMessageId: string | null,
  targetUserMessageId: string | null,
) {
  if (String(log.missionId ?? "") !== missionId) return false;
  const interactionId = typeof log.interactionId === "string" ? log.interactionId : "";
  const userMessageId = typeof log.userMessageId === "string" ? log.userMessageId : "";
  return Boolean(
    (targetMessageId && interactionId === targetMessageId) ||
      (targetUserMessageId && userMessageId === targetUserMessageId),
  );
}

async function loadRetrievalLogMemoryIds(
  uid: string,
  missionId: string,
  targetMessageId: string | null,
  targetUserMessageId: string | null,
  token: string,
) {
  if (!targetMessageId && !targetUserMessageId) return [];
  const logIds = await listFirestoreDocumentIds(
    `users/${uid}/${RETRIEVAL_LOG_COLLECTION}`,
    token,
  );
  const logs: RetrievalLog[] = await Promise.all(
    logIds.slice(-MAX_RETRIEVAL_LOGS).map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `users/${uid}/${RETRIEVAL_LOG_COLLECTION}/${encodeURIComponent(id)}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...doc } as RetrievalLog;
    }),
  );
  const matched = logs
    .filter((log) =>
      retrievalLogMatches(log, missionId, targetMessageId, targetUserMessageId),
    )
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0];
  return uniqueStrings(stringArray(matched?.retrievedMemoryIds));
}

async function loadTargetMemoryIds(
  uid: string,
  missionId: string,
  targetMessageId: string | null,
  targetUserMessageId: string | null,
  token: string,
) {
  const reviewTurnIds = await loadReviewTurnMemoryIds(
    uid,
    missionId,
    targetMessageId,
    token,
  );
  if (reviewTurnIds.length > 0) return reviewTurnIds;
  return loadRetrievalLogMemoryIds(
    uid,
    missionId,
    targetMessageId,
    targetUserMessageId,
    token,
  );
}

function previousAppliedDeltas(
  previous: AssistantFeedbackWeightAdjustment | null,
) {
  const previousIds = uniqueStrings(stringArray(previous?.retrievedMemoryIds));
  const previousDelta = numberValue(previous?.deltaPerMemory, 0);
  return new Map(previousIds.map((id) => [id, previousDelta]));
}

function desiredAppliedDeltas(ids: string[], delta: number) {
  return new Map(uniqueStrings(ids).map((id) => [id, delta]));
}

function netDeltas(
  previous: Map<string, number>,
  desired: Map<string, number>,
) {
  const ids = new Set([...previous.keys(), ...desired.keys()]);
  return Array.from(ids)
    .map((id) => ({
      id,
      delta: Number(((desired.get(id) ?? 0) - (previous.get(id) ?? 0)).toFixed(4)),
    }))
    .filter((item) => item.delta !== 0);
}

export async function applyAssistantFeedbackWeightAdjustment(params: {
  uid: string;
  missionId: string;
  vote: AssistantFeedbackVote;
  targetMessageId: string | null;
  targetUserMessageId: string | null;
  previousAdjustment?: AssistantFeedbackWeightAdjustment | null;
  token: string;
  now?: number;
}): Promise<AssistantFeedbackWeightAdjustmentResult> {
  const appliedAt = params.now ?? Date.now();
  const targetMemoryIds = await loadTargetMemoryIds(
    params.uid,
    params.missionId,
    params.targetMessageId,
    params.targetUserMessageId,
    params.token,
  );
  const deltaPerMemory = feedbackDelta(params.vote);
  const previous = previousAppliedDeltas(params.previousAdjustment ?? null);
  const desired = desiredAppliedDeltas(targetMemoryIds, deltaPerMemory);
  const adjustments = netDeltas(previous, desired);
  const deltas: FeedbackWeightDelta[] = [];

  await Promise.all(
    adjustments.map(async ({ id, delta }) => {
      const path = `users/${params.uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`;
      const doc = await getFirestoreDocument(path, params.token);
      if (!doc || !isActiveMemoryDocument(doc)) return;

      const previousWeight = numberValue(doc.weight, 0.5);
      const weight = clampWeight(previousWeight + delta);
      await patchFirestoreDocument(
        path,
        {
          weight,
          lastFeedbackAdjustedAt: appliedAt,
          updatedAt: appliedAt,
        },
        params.token,
      );
      deltas.push({
        memoryId: id,
        previousWeight,
        weight,
        weightDelta: Number((weight - previousWeight).toFixed(4)),
      });
    }),
  );

  return {
    version: "0.1.0",
    vote: params.vote,
    deltaPerMemory,
    targetMessageId: params.targetMessageId,
    targetUserMessageId: params.targetUserMessageId,
    retrievedMemoryIds: targetMemoryIds,
    deltas: deltas.sort((a, b) => a.memoryId.localeCompare(b.memoryId)),
    skippedReason: targetMemoryIds.length === 0 ? "no_retrieved_memories" : null,
    appliedAt,
  };
}
