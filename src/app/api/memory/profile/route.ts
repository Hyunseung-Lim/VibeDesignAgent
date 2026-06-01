import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNow(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function sanitizeItem(raw: unknown): {
  id: string;
  input: string;
  createdAt: number;
  updatedAt: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const input = stringOrNull(item.input);
  const id = stringOrNull(item.id);
  if (!input || !id) return null;
  return {
    id,
    input,
    createdAt: numberOrNow(item.createdAt),
    updatedAt: numberOrNow(item.updatedAt),
  };
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const missionId = url.searchParams.get("missionId");
  if (!missionId?.trim()) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const token = await getFirebaseAccessToken();
  const doc = (await getFirestoreDocument(
    `users/${user.localId}/profile_memories/${encodeURIComponent(missionId)}`,
    token,
  )) as Record<string, unknown> | null;

  const items = Array.isArray(doc?.items)
    ? doc.items.map(sanitizeItem).filter(Boolean)
    : [];

  return Response.json({ missionId, items });
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map(sanitizeItem).filter(Boolean);

  const token = await getFirebaseAccessToken();
  await patchFirestoreDocument(
    `users/${user.localId}/profile_memories/${encodeURIComponent(missionId)}`,
    { missionId, items, updatedAt: Date.now() },
    token,
  );

  return Response.json({ ok: true, missionId, count: items.length });
}
