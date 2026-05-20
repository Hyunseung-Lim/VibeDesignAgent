import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user || !isAdminEmail(user.email)) {
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
