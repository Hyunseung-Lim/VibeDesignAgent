import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";
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

  return Response.json({ users });
}
