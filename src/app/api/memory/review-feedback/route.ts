import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const FEEDBACK_COLLECTION = "memoryReviewFeedback";
const SCHEMA_VERSION = 1;
const MAX_ANSWER_LENGTH = 5000;
const MAX_MENTIONS_PER_ANSWER = 50;

type ReviewMention = {
  type: "cluster" | "memory";
  id: string;
  label: string;
  start: number;
  end: number;
};

type ReviewAnswer = {
  text: string;
  mentions: ReviewMention[];
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanMention(value: unknown): ReviewMention | null {
  if (!value || typeof value !== "object") return null;
  const mention = value as Record<string, unknown>;
  const type = mention.type === "cluster" || mention.type === "memory"
    ? mention.type
    : null;
  const id = stringOrNull(mention.id);
  const label = stringOrNull(mention.label);
  const start = numberOrNull(mention.start);
  const end = numberOrNull(mention.end);
  if (!type || !id || !label || start == null || end == null || end <= start) {
    return null;
  }
  return {
    type,
    id,
    label: label.slice(0, 200),
    start,
    end,
  };
}

function cleanAnswers(value: unknown): Record<string, ReviewAnswer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([questionId, rawAnswer]) => {
        if (!rawAnswer || typeof rawAnswer !== "object") return null;
        const answer = rawAnswer as Record<string, unknown>;
        const text = String(answer.text ?? "").slice(0, MAX_ANSWER_LENGTH);
        const mentions = Array.isArray(answer.mentions)
          ? answer.mentions
              .map(cleanMention)
              .filter((item): item is ReviewMention => Boolean(item))
              .slice(0, MAX_MENTIONS_PER_ANSWER)
          : [];
        return [questionId, { text, mentions }] as const;
      })
      .filter((item): item is readonly [string, ReviewAnswer] => Boolean(item)),
  );
}

function answerMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function answerText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const text = (value as Record<string, unknown>).text;
  return typeof text === "string" ? text.trim() : "";
}

// Part 1 (intro) and Part 2 save through the same document but each client
// payload may carry only its own part's keys — and a client that opened the
// review before its saved answers finished loading can send stale-empty
// values. Merge per key and never let an empty answer erase a stored one, so
// neither part can wipe the other.
function mergeAnswers(
  previous: Record<string, unknown>,
  incoming: Record<string, ReviewAnswer>,
) {
  const merged: Record<string, unknown> = { ...previous };
  for (const [questionId, answer] of Object.entries(incoming)) {
    if (!answer.text.trim() && answerText(merged[questionId])) continue;
    merged[questionId] = answer;
  }
  return merged;
}

function feedbackPath(uid: string, missionId: string) {
  return `users/${uid}/${FEEDBACK_COLLECTION}/${encodeURIComponent(missionId)}`;
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const missionId = stringOrNull(url.searchParams.get("missionId"));
  if (!missionId) {
    return Response.json({ error: "missionId_required" }, { status: 400 });
  }

  const requestedTargetUid = stringOrNull(url.searchParams.get("targetUid"));
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const feedback = await getFirestoreDocument(
    feedbackPath(targetUid, missionId),
    token,
  );
  return Response.json(
    { feedback: feedback ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId_required" }, { status: 400 });
  }

  const answers = cleanAnswers(body.answers);
  const submitted = body.submitted === true;
  const now = Date.now();
  const token = await getFirebaseAccessToken();
  const previous = (await getFirestoreDocument(
    feedbackPath(user.localId, missionId),
    token,
  )) as Record<string, unknown> | null;
  const payload = {
    uid: user.localId,
    missionId,
    schemaVersion: SCHEMA_VERSION,
    answers: mergeAnswers(answerMap(previous?.answers), answers),
    updatedAt: now,
    submittedAt: submitted ? now : (previous?.submittedAt ?? null),
  };

  await patchFirestoreDocument(feedbackPath(user.localId, missionId), payload, token);
  return Response.json({ ok: true, feedback: payload });
}
