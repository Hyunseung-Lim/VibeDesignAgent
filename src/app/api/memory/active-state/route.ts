import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  isActiveMemoryDocument,
  memoryArchivedAt,
  memoryInactiveReason,
  memoryWeight,
} from "@/lib/server/memoryActivity";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";
const MAX_REASON_LENGTH = 1000;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function PATCH(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const memoryId = stringOrNull(body.memoryId);
  const active = typeof body.active === "boolean" ? body.active : null;
  const reason = stringOrNull(body.reason);

  if (!memoryId) {
    return Response.json({ error: "memoryId_required" }, { status: 400 });
  }
  if (active == null) {
    return Response.json({ error: "active_required" }, { status: 400 });
  }
  if (!active && !reason) {
    return Response.json(
      { error: "deactivation_reason_required" },
      { status: 400 },
    );
  }

  const token = await getFirebaseAccessToken();
  const path = `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryId)}`;
  const previous = (await getFirestoreDocument(path, token)) as Record<
    string,
    unknown
  > | null;
  if (!previous) {
    return Response.json({ error: "memory_not_found" }, { status: 404 });
  }

  const now = Date.now();
  const patch = active
    ? {
        weight: 0.5,
        archivedAt: null,
        archiveReason: null,
        inactiveAt: null,
        inactiveReason: null,
        inactiveReasonDetail: null,
        reactivatedByUserAt: now,
        updatedAt: now,
      }
    : {
        weight: 0,
        inactiveAt: now,
        inactiveReason: "user_disabled",
        inactiveReasonDetail: reason!.slice(0, MAX_REASON_LENGTH),
        reactivatedByUserAt: null,
        updatedAt: now,
      };

  await patchFirestoreDocument(path, patch, token);
  const next = { ...previous, ...patch };

  return Response.json({
    ok: true,
    status: {
      memoryId,
      active: isActiveMemoryDocument(next),
      archivedAt: memoryArchivedAt(next.archivedAt),
      archiveReason: stringOrNull(next.archiveReason),
      inactiveReason: memoryInactiveReason(next),
      inactiveReasonDetail: stringOrNull(next.inactiveReasonDetail),
      weight: memoryWeight(next.weight),
    },
  });
}
