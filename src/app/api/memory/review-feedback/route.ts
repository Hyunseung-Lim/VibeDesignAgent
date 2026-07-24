import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  isActiveMemoryDocument,
  memoryWeight,
} from "@/lib/server/memoryActivity";

export const runtime = "nodejs";

const FEEDBACK_COLLECTION = "memoryReviewFeedback";
const MEMORY_COLLECTION = "memories_0_1_2";
const ACTIVATION_LOG_COLLECTION = "memoryActivationLogs";
const SCHEMA_VERSION = 1;
const MAX_ANSWER_LENGTH = 5000;
const MAX_MENTIONS_PER_ANSWER = 50;
const MAX_ACTIVATION_STATES = 100;
const MAX_ACTIVATION_EVENTS = 300;
const MAX_ACTIVATION_REASON_LENGTH = 1000;

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

type ActivationState = {
  active: boolean;
  reason: string | null;
  toggledAt: number;
};

type ActivationEvent = ActivationState & { memoryId: string };

type MemoryActivations = {
  states: Record<string, ActivationState>;
  events: ActivationEvent[];
};

// 리뷰 중 staging된 활성/비활성 토글. states는 제출 시 적용할 메모리별 최종
// 상태, events는 중간 undo까지 포함한 토글 이력 전체다. 필드가 아예 없으면
// null을 반환해 기존 저장분을 유지한다 (answers의 stale-empty 보호와 동일).
function cleanMemoryActivations(value: unknown): MemoryActivations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const states: Record<string, ActivationState> = {};
  if (raw.states && typeof raw.states === "object" && !Array.isArray(raw.states)) {
    for (const [memoryId, rawState] of Object.entries(
      raw.states as Record<string, unknown>,
    ).slice(0, MAX_ACTIVATION_STATES)) {
      if (!memoryId.trim() || !rawState || typeof rawState !== "object") continue;
      const state = rawState as Record<string, unknown>;
      if (typeof state.active !== "boolean") continue;
      const reason = stringOrNull(state.reason);
      // 비활성화는 이유가 필수 계약이다 — 없으면 적용 대상에서 제외한다.
      if (!state.active && !reason) continue;
      states[memoryId] = {
        active: state.active,
        reason: state.active
          ? null
          : reason!.slice(0, MAX_ACTIVATION_REASON_LENGTH),
        toggledAt: numberOrNull(state.toggledAt) ?? 0,
      };
    }
  }
  const events: ActivationEvent[] = [];
  if (Array.isArray(raw.events)) {
    for (const rawEvent of raw.events.slice(-MAX_ACTIVATION_EVENTS)) {
      if (!rawEvent || typeof rawEvent !== "object") continue;
      const event = rawEvent as Record<string, unknown>;
      const memoryId = stringOrNull(event.memoryId);
      if (!memoryId || typeof event.active !== "boolean") continue;
      const reason = stringOrNull(event.reason);
      events.push({
        memoryId,
        active: event.active,
        reason: reason ? reason.slice(0, MAX_ACTIVATION_REASON_LENGTH) : null,
        toggledAt: numberOrNull(event.toggledAt) ?? 0,
      });
    }
  }
  return { states, events };
}

function storedMemoryActivations(value: unknown): MemoryActivations {
  return cleanMemoryActivations(value) ?? { states: {}, events: [] };
}

// answers의 mergeAnswers와 같은 이유로 memoryActivations도 통째 교체가 아닌
// memoryId별 merge를 한다: draft 복원이 끝나기 전의 클라이언트(리마운트 직후)가
// 일부 토글만 담긴 payload를 보내도 기존 staged 토글이 지워지면 안 된다.
// 반대로 사용자가 토글을 baseline으로 되돌린 undo(states에서 항목 제거)는
// 반영돼야 하므로, memoryId별로 더 최신 결정(state toggledAt과 event toggledAt
// 중 최댓값)을 가진 쪽의 표현 — state 항목 또는 부재(=baseline) — 을 택한다.
// 이력 없이 항목만 사라진 payload(복원 전 클라이언트)는 결정 시각 0으로 취급돼
// 기존 항목을 이기지 못한다. events는 (toggledAt, memoryId, active) 기준
// union이라 out-of-order 도착에도 이력이 유실되지 않는다.
function mergeMemoryActivations(
  previous: MemoryActivations,
  incoming: MemoryActivations,
): MemoryActivations {
  const eventKey = (event: ActivationEvent) =>
    `${event.toggledAt}:${event.active}:${event.memoryId}`;
  const mergedEvents = new Map<string, ActivationEvent>();
  for (const event of [...previous.events, ...incoming.events]) {
    mergedEvents.set(eventKey(event), event);
  }
  const events = Array.from(mergedEvents.values())
    .sort((a, b) => a.toggledAt - b.toggledAt)
    .slice(-MAX_ACTIVATION_EVENTS);

  const decisionAt = (side: MemoryActivations, memoryId: string) => {
    let at = side.states[memoryId]?.toggledAt ?? 0;
    for (const event of side.events) {
      if (event.memoryId === memoryId && event.toggledAt > at) {
        at = event.toggledAt;
      }
    }
    return at;
  };
  const states: Record<string, ActivationState> = {};
  const memoryIds = new Set([
    ...Object.keys(previous.states),
    ...Object.keys(incoming.states),
  ]);
  for (const memoryId of memoryIds) {
    const incomingAt = decisionAt(incoming, memoryId);
    const previousAt = decisionAt(previous, memoryId);
    // 동시각이면 state 항목이 있는 쪽을 우선해, 이력 없는 부재가 기존 항목을
    // 지우지 못하게 한다.
    const winner =
      incomingAt > previousAt ||
      (incomingAt === previousAt && incoming.states[memoryId])
        ? incoming
        : previous;
    const state = winner.states[memoryId];
    if (state) states[memoryId] = state;
  }
  return {
    states: Object.fromEntries(
      Object.entries(states).slice(0, MAX_ACTIVATION_STATES),
    ),
    events,
  };
}

// 제출 시점에 staged 최종 상태를 메모리 문서에 적용하고, 토글 이력 전체를
// append-only 로그로 남긴다. 메모리 문서는 마지막 상태만 들고 있으므로
// 언제/어떤 리뷰 세션에서 토글했는지는 이 로그가 유일한 근거다.
async function applyMemoryActivations(
  uid: string,
  missionId: string,
  activations: MemoryActivations,
  token: string,
) {
  const now = Date.now();
  const lastEventKeyByMemory = new Map<string, number>();
  activations.events.forEach((event, index) => {
    lastEventKeyByMemory.set(event.memoryId, index);
  });

  const previousByMemory = new Map<
    string,
    { previouslyActive: boolean; previousWeight: number | null } | null
  >();
  for (const [memoryId, state] of Object.entries(activations.states)) {
    const path = `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryId)}`;
    const previous = (await getFirestoreDocument(path, token)) as Record<
      string,
      unknown
    > | null;
    if (!previous) {
      // 리뷰 도중 삭제된 메모리 등 — 적용은 건너뛰고 로그에는 남긴다.
      previousByMemory.set(memoryId, null);
      continue;
    }
    previousByMemory.set(memoryId, {
      previouslyActive: isActiveMemoryDocument(previous),
      previousWeight: memoryWeight(previous.weight),
    });
    const patch = state.active
      ? {
          weight: 0.5,
          archivedAt: null,
          archiveReason: null,
          inactiveAt: null,
          inactiveReason: null,
          inactiveReasonDetail: null,
          reactivatedByUserAt: now,
          updatedAt: now,
        }
      : {
          weight: 0,
          inactiveAt: now,
          inactiveReason: "user_disabled",
          inactiveReasonDetail: state.reason,
          reactivatedByUserAt: null,
          updatedAt: now,
        };
    await patchFirestoreDocument(path, patch, token);
  }

  for (const [index, event] of activations.events.entries()) {
    const finalState = activations.states[event.memoryId];
    const applied =
      lastEventKeyByMemory.get(event.memoryId) === index &&
      finalState != null &&
      finalState.active === event.active &&
      previousByMemory.get(event.memoryId) != null;
    const previous = applied
      ? previousByMemory.get(event.memoryId)!
      : null;
    // toggledAt 기반 문서 ID라 재시도 시 같은 이벤트는 같은 문서를 덮어쓴다.
    await patchFirestoreDocument(
      `users/${uid}/${ACTIVATION_LOG_COLLECTION}/${event.toggledAt}-${encodeURIComponent(event.memoryId)}`,
      {
        memoryId: event.memoryId,
        active: event.active,
        reason: event.reason,
        missionId,
        toggledAt: event.toggledAt,
        applied,
        appliedAt: applied ? now : null,
        previouslyActive: previous?.previouslyActive ?? null,
        previousWeight: previous?.previousWeight ?? null,
        createdAt: now,
      },
      token,
    );
  }
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
  const incomingActivations = cleanMemoryActivations(body.memoryActivations);
  const previousActivations = storedMemoryActivations(
    previous?.memoryActivations,
  );
  const memoryActivations = incomingActivations
    ? mergeMemoryActivations(previousActivations, incomingActivations)
    : previousActivations;

  // 활성/비활성 토글은 draft 동안 staging만 되다가 최초 제출 시 한 번 적용된다.
  // 재제출/중복 클릭이 메모리를 다시 patch하거나 로그를 중복 생성하지 않도록
  // 기존 submittedAt이 있으면 건너뛴다. 피드백 문서 patch보다 먼저 적용해,
  // 적용 실패 시 submittedAt이 남지 않고 클라이언트가 재시도할 수 있게 한다.
  if (
    submitted &&
    !previous?.submittedAt &&
    (Object.keys(memoryActivations.states).length > 0 ||
      memoryActivations.events.length > 0)
  ) {
    await applyMemoryActivations(
      user.localId,
      missionId,
      memoryActivations,
      token,
    );
  }

  const payload = {
    uid: user.localId,
    missionId,
    schemaVersion: SCHEMA_VERSION,
    answers: mergeAnswers(answerMap(previous?.answers), answers),
    memoryActivations,
    updatedAt: now,
    submittedAt: submitted ? now : (previous?.submittedAt ?? null),
  };

  await patchFirestoreDocument(feedbackPath(user.localId, missionId), payload, token);
  return Response.json({ ok: true, feedback: payload });
}
