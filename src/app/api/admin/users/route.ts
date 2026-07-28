import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  lookupAuthUserCreatedAt,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail, isHiddenAdminViewEmail } from "@/lib/admin";
import { stitchApiGroupForUser } from "@/lib/server/stitchApiGroup";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !isAdminEmail(requester.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const userIds = await listFirestoreDocumentIds("users", token);
  const users = await Promise.all(
    userIds.map(async (uid) => {
      const profile = await getFirestoreDocument(`users/${uid}`, token);
      return {
        id: uid,
        displayName: profile?.displayName ?? null,
        email: profile?.email ?? null,
        photoURL: profile?.photoURL ?? null,
        updatedAt:
          typeof profile?.lastLoginAt === "string"
            ? Date.parse(profile.lastLoginAt)
            : 0,
        onboardingStatus: profile
          ? profile.onboardingCompleted === true
            ? "completed"
            : "required"
          : "unknown",
        missionOrder: Array.isArray(profile?.missionOrder)
          ? profile.missionOrder.map(String)
          : [],
        isAdmin: isAdminEmail(String(profile?.email ?? "")),
        stitchApiGroup: stitchApiGroupForUser(
          uid,
          profile?.stitchApiGroup,
        ),
      };
    }),
  );

  // 폐기 계정(재로그인으로 빈 프로필이 재생성되는 계정)은 목록·번호 부여에서
  // 완전히 제외한다 — kaithape가 다시 로그인해도 뒤 참가자 번호가 밀리지 않는다.
  const visibleUsers = users.filter(
    (user) => !isHiddenAdminViewEmail(String(user.email ?? "")),
  );

  // 참가자 번호(P1, P2, ...): 관리자를 제외한 계정에 Firebase Auth 가입 시각
  // 순서로 부여한다. 관리자 페이지 표시 전용이며 참가자 화면에는 노출되지
  // 않는다. Auth 조회 실패 시 번호 없이 반환한다.
  let createdAtByUid: Record<string, number> = {};
  try {
    createdAtByUid = await lookupAuthUserCreatedAt(userIds);
  } catch (error) {
    console.warn("[admin/users] auth createdAt lookup failed", error);
  }
  const orderedParticipants = visibleUsers
    .filter((user) => !user.isAdmin)
    .sort(
      (a, b) =>
        (createdAtByUid[a.id] ?? Number.MAX_SAFE_INTEGER) -
          (createdAtByUid[b.id] ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  const participantNumberByUid = new Map(
    orderedParticipants.map((user, index) => [user.id, index + 1] as const),
  );

  return Response.json({
    users: visibleUsers.map((user) => ({
      ...user,
      participantNumber: user.isAdmin
        ? null
        : (participantNumberByUid.get(user.id) ?? null),
    })),
  });
}
