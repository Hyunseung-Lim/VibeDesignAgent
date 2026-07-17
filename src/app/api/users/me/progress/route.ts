import {
  getFirebaseAccessToken,
  queryFirestoreCollection,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { SESSION_PROGRESS_FIELDS } from "@/lib/server/sessionProgress";

export const runtime = "nodejs";

// 로비용 자기 세션 진행상황. 클라이언트 SDK로 세션 문서 전체(messages 포함)를
// 구독하던 것을 대체한다 — projection으로 진행 스칼라와 리뷰 제출 여부만 반환.
export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getFirebaseAccessToken();
    const uid = user.localId;
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
    return Response.json({
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
    });
  } catch (error) {
    console.error("[api/users/me/progress GET]", error);
    return Response.json(
      { error: "failed to load progress" },
      { status: 500 },
    );
  }
}
