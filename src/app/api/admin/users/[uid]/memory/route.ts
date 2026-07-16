import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  deleteFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";
import {
  ADMIN_MEMORY_CLUSTER_COLLECTION,
  ADMIN_MEMORY_COLLECTION,
  deleteMissionScopedMemoryData,
  deleteUserCollection,
} from "@/lib/server/adminMemoryCleanup";
import { loadUserMemoryItems } from "@/lib/server/memoryItems";

export const runtime = "nodejs";

const MEMORY_COLLECTION = ADMIN_MEMORY_COLLECTION;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const url = new URL(request.url);
  const memoryId = url.searchParams.get("memoryId");
  const missionId = url.searchParams.get("missionId")?.trim();
  const token = await getFirebaseAccessToken();

  if (memoryId) {
    await deleteFirestoreDocument(
      `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryId)}`,
      token,
    );
    return Response.json({ ok: true, deleted: 1 });
  }

  if (missionId) {
    const result = await deleteMissionScopedMemoryData(uid, missionId, token);
    return Response.json({
      ok: true,
      missionId,
      deleted: result.deletedMemories,
      ...result,
    });
  }

  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  await Promise.all(
    ids.map((id) =>
      deleteFirestoreDocument(`users/${uid}/${MEMORY_COLLECTION}/${id}`, token),
    ),
  );
  const deletedMemoryClusters = await deleteUserCollection(
    uid,
    ADMIN_MEMORY_CLUSTER_COLLECTION,
    token,
  );
  return Response.json({ ok: true, deleted: ids.length, deletedMemoryClusters });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const token = await getFirebaseAccessToken();
  const includeInactive =
    new URL(request.url).searchParams.get("includeInactive") === "1";
  const memories = await loadUserMemoryItems(uid, token, {
    includeArchived: includeInactive,
    includeInactive,
  });
  const profile = await getFirestoreDocument(`users/${uid}`, token);
  const missionOrder = Array.isArray(profile?.missionOrder)
    ? profile.missionOrder.map(String)
    : [];
  return Response.json({
    memories,
    missionOrder,
    counts: {
      "0.1.2": memories.length,
    },
  });
}
