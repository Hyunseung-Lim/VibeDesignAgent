import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { uids?: string[] };
  const uids = Array.from(new Set(body.uids ?? [])).filter(Boolean);
  const token = await getFirebaseAccessToken();
  const statuses = await Promise.all(
    uids.map(async (uid) => {
      const profile = await getFirestoreDocument(`users/${uid}`, token);
      return [
        uid,
        {
          onboardingStatus: profile
            ? profile.onboardingCompleted === true
              ? "completed"
              : "required"
            : "unknown",
        },
      ] as const;
    }),
  );

  return Response.json({ statuses: Object.fromEntries(statuses) });
}
