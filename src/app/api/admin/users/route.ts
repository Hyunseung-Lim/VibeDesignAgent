import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

export async function GET(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !ADMIN_EMAILS.includes(requester.email ?? "")) {
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
        isAdmin: ADMIN_EMAILS.includes(String(profile?.email ?? "")),
      };
    }),
  );

  return Response.json({ users });
}
