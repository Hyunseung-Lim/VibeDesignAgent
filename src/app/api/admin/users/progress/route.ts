import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  listFirestoreDocumentIds,
  queryFirestoreCollection,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

// missionProgressFromSession이 참조하는 스칼라 필드만 projection한다.
// messages/ideas/artboards/references 배열은 내려받지 않는다 — 실데이터 검증
// 결과 hasActivity 판정은 아래 스칼라만으로 동일하다(15.297).
const SESSION_PROGRESS_FIELDS = [
  "status",
  "timerStartedAt",
  "startedAt",
  "endedAt",
  "selectedOptionId",
];

export async function GET(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !isAdminEmail(requester.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const token = await getFirebaseAccessToken();
    // sessions/{uid} 부모 문서는 기록되지 않는 phantom일 수 있어 users 컬렉션과
    // 실존 부모 문서의 합집합으로 대상 uid를 정한다(기존 클라이언트 로직과 동일).
    const [userIds, sessionParentIds] = await Promise.all([
      listFirestoreDocumentIds("users", token),
      listFirestoreDocumentIds("sessions", token),
    ]);
    const uids = Array.from(new Set([...userIds, ...sessionParentIds]));

    const entries = await Promise.all(
      uids.map(async (uid) => {
        const [sessionDocs, reviewDocs] = await Promise.all([
          queryFirestoreCollection(
            `sessions/${encodeURIComponent(uid)}`,
            "missions",
            token,
            SESSION_PROGRESS_FIELDS,
          ),
          queryFirestoreCollection(
            `users/${encodeURIComponent(uid)}`,
            "memoryReviewFeedback",
            token,
            ["submittedAt"],
          ),
        ]);
        return [
          uid,
          {
            missions: Object.fromEntries(
              sessionDocs.map((doc) => [doc.id, doc.fields]),
            ),
            reviewSubmittedAt: Object.fromEntries(
              reviewDocs.map((doc) => [
                doc.id,
                typeof doc.fields.submittedAt === "number"
                  ? doc.fields.submittedAt
                  : null,
              ]),
            ),
          },
        ] as const;
      }),
    );

    return Response.json({ progress: Object.fromEntries(entries) });
  } catch (error) {
    console.error("[api/admin/users/progress GET]", error);
    return Response.json(
      { error: "failed to load user progress" },
      { status: 500 },
    );
  }
}
