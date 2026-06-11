import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Per-user randomized mission order. Assigned once and kept stable; new missions
// are appended (shuffled) and removed missions dropped, preserving the user's
// existing relative order so an in-progress study order never reshuffles.
async function resolveMissionOrder(
  uid: string,
  saved: unknown,
  token: string,
): Promise<string[]> {
  const allIds = await listFirestoreDocumentIds("missions", token);
  const present = new Set(allIds);
  const savedOrder = Array.isArray(saved)
    ? saved.map(String).filter((id) => present.has(id))
    : [];
  const missing = allIds.filter((id) => !savedOrder.includes(id));
  const order = [...savedOrder, ...shuffle(missing)];
  const changed =
    !Array.isArray(saved) ||
    order.length !== (saved as unknown[]).length ||
    order.some((id, i) => id !== (saved as unknown[])[i]);
  if (changed) {
    await patchFirestoreDocument(`users/${uid}`, { missionOrder: order }, token);
  }
  return order;
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const token = await getFirebaseAccessToken();
  const profile = await getFirestoreDocument(`users/${user.localId}`, token);
  const missionOrder = await resolveMissionOrder(
    user.localId,
    profile?.missionOrder,
    token,
  );
  return Response.json({
    uid: user.localId,
    displayName: profile?.displayName ?? user.displayName ?? null,
    email: profile?.email ?? user.email ?? null,
    photoURL: profile?.photoURL ?? user.photoUrl ?? null,
    onboardingCompleted: profile?.onboardingCompleted === true,
    missionOrder,
    exists: Boolean(profile),
  });
}

export async function PATCH(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    onboardingCompleted?: boolean;
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
