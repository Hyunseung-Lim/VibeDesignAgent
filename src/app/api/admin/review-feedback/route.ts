import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  queryFirestoreCollection,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const FEEDBACK_COLLECTION = "memoryReviewFeedback";

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 리뷰 중 staging된 활성/비활성 토글(states: 메모리별 최종 상태, events:
// undo 포함 이력). 세부 필드 검증은 뷰가 하고 여기서는 형태만 거른다.
function memoryActivationsField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { states?: unknown; events?: unknown };
  const states =
    raw.states && typeof raw.states === "object" && !Array.isArray(raw.states)
      ? (raw.states as Record<string, unknown>)
      : {};
  const events = Array.isArray(raw.events) ? raw.events : [];
  if (Object.keys(states).length === 0 && events.length === 0) return null;
  return { states, events };
}

// 활성/비활성 변경된 메모리의 본문 요약. 관리자 뷰가 opaque한 memoryId 대신
// 어떤 메모리였는지 보여주기 위한 조회 전용 텍스트다 (episodic > semantic >
// keywords 우선, 200자 절단).
function memorySummaryText(fields: Record<string, unknown> | null | undefined) {
  if (!fields) return null;
  const episodic = typeof fields.episodic === "string" ? fields.episodic.trim() : "";
  const semantic = typeof fields.semantic === "string" ? fields.semantic.trim() : "";
  const keywords = Array.isArray(fields.keywords)
    ? fields.keywords.filter((k) => typeof k === "string").join(", ")
    : "";
  const text = episodic || semantic || keywords;
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

async function loadMemorySummaries(
  uid: string,
  memoryIds: string[],
  token: string,
) {
  if (memoryIds.length === 0) return null;
  const entries = await Promise.all(
    memoryIds.map(async (memoryId) => {
      try {
        const doc = await getFirestoreDocument(
          `users/${uid}/memories_0_1_2/${memoryId}`,
          token,
        );
        return [memoryId, memorySummaryText(doc)] as const;
      } catch {
        return [memoryId, null] as const;
      }
    }),
  );
  const summaries: Record<string, string> = {};
  for (const [memoryId, text] of entries) {
    if (text) summaries[memoryId] = text;
  }
  return Object.keys(summaries).length > 0 ? summaries : null;
}

export async function GET(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !isAdminEmail(requester.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const userIds = await listFirestoreDocumentIds("users", token);

  const rowsByUser = await Promise.all(
    userIds.map(async (uid) => {
      const docs = await queryFirestoreCollection(
        `users/${uid}`,
        FEEDBACK_COLLECTION,
        token,
      );
      if (docs.length === 0) return [];
      const profile = await getFirestoreDocument(`users/${uid}`, token);
      return Promise.all(
        docs.map(async (doc) => {
          const memoryActivations = memoryActivationsField(
            doc.fields.memoryActivations,
          );
          return {
            uid,
            displayName: profile?.displayName ?? null,
            email: profile?.email ?? null,
            // Document id is the encoded missionId (see review-feedback route).
            missionId: decodeURIComponent(doc.id),
            answers:
              doc.fields.answers && typeof doc.fields.answers === "object"
                ? doc.fields.answers
                : {},
            memoryActivations,
            // 변경된 메모리들의 본문 요약 (id -> text). 뷰의 9번 문항 표시용.
            memorySummaries: await loadMemorySummaries(
              uid,
              Object.keys(memoryActivations?.states ?? {}),
              token,
            ),
            submittedAt: numberOrNull(doc.fields.submittedAt),
            updatedAt: numberOrNull(doc.fields.updatedAt),
          };
        }),
      );
    }),
  );

  const rows = rowsByUser
    .flat()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return Response.json({ rows });
}
