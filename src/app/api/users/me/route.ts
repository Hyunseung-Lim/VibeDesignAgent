import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const token = await getFirebaseAccessToken();
  const profile = await getFirestoreDocument(`users/${user.localId}`, token);
  return Response.json({
    uid: user.localId,
    displayName: profile?.displayName ?? user.displayName ?? null,
    email: profile?.email ?? user.email ?? null,
    photoURL: profile?.photoURL ?? user.photoUrl ?? null,
    onboardingCompleted: profile?.onboardingCompleted === true,
    onboardingMemory: profile?.onboardingMemory ?? "",
    onboardingMemoryUpdatedAt: profile?.onboardingMemoryUpdatedAt ?? null,
    exists: Boolean(profile),
  });
}

export async function PATCH(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    onboardingCompleted?: boolean;
    onboardingMemory?: string;
  };
  const now = new Date();
  const data: Record<string, unknown> = {
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    photoURL: user.photoUrl ?? null,
    lastLoginAt: now,
  };
  if (typeof body.onboardingCompleted === "boolean") {
    data.onboardingCompleted = body.onboardingCompleted;
    if (body.onboardingCompleted) data.onboardingCompletedAt = now;
  }
  if (typeof body.onboardingMemory === "string") {
    data.onboardingMemory = body.onboardingMemory.slice(0, 4000);
    data.onboardingMemoryUpdatedAt = now;
  }

  try {
    const token = await getFirebaseAccessToken();
    await patchFirestoreDocument(`users/${user.localId}`, data, token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[users/me PATCH] failed for", user.email, ":", message);
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    uid: user.localId,
    onboardingCompleted: body.onboardingCompleted,
  });
}
