import { isAdminEmail } from "@/lib/admin";
import {
  archiveForgettingCandidates,
  archivedItemsFromDocs,
  buildForgettingCandidates,
  indexedMemoriesFromDocs,
  loadMemoryDocs,
  MEMORY_DUPLICATE_SIMILARITY_THRESHOLD,
  MEMORY_FORGETTING_COLLECTION,
  MEMORY_LOW_WEIGHT_THRESHOLD,
} from "@/lib/server/memoryForgetting";
import {
  getFirebaseAccessToken,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

async function requireAdmin(request: Request) {
  const admin = await verifyFirebaseIdToken(request);
  return admin && isAdminEmail(admin.email) ? admin : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { uid } = await params;
  const token = await getFirebaseAccessToken();
  const docs = await loadMemoryDocs(uid, token);
  const items = indexedMemoriesFromDocs(docs);
  const candidates = buildForgettingCandidates(items);
  const autoArchived = await archiveForgettingCandidates(uid, candidates, token);

  return Response.json({
    candidates: autoArchived,
    archived: archivedItemsFromDocs(docs),
    thresholds: {
      duplicateSimilarity: MEMORY_DUPLICATE_SIMILARITY_THRESHOLD,
      lowWeight: MEMORY_LOW_WEIGHT_THRESHOLD,
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });

  const { uid } = await params;
  const body = (await request.json().catch(() => null)) as {
    memoryId?: unknown;
    reason?: unknown;
    duplicateOf?: unknown;
  } | null;
  const memoryId = String(body?.memoryId ?? "");
  if (!memoryId) {
    return Response.json({ error: "missing memory item" }, { status: 400 });
  }

  const token = await getFirebaseAccessToken();
  const now = Date.now();
  await patchFirestoreDocument(
    `users/${uid}/${MEMORY_FORGETTING_COLLECTION}/${encodeURIComponent(memoryId)}`,
    {
      archivedAt: now,
      archiveReason: String(body?.reason ?? "manual-forgetting"),
      duplicateOf: body?.duplicateOf ?? null,
      updatedAt: now,
    },
    token,
  );
  return Response.json({ ok: true, archivedAt: now });
}
