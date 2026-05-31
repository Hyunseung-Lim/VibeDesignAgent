import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTIONS = ["memories_0_1_2", "memories_0_1_1"];
const MAX_MEMORY_IDS = 80;

type ArchiveStatus = {
  memoryId: string;
  archivedAt: number | null;
  archiveReason: string | null;
  duplicateOf: string | null;
  duplicate: unknown;
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetUid?: unknown;
    memoryIds?: unknown;
  };
  const requestedTargetUid = stringOrNull(body.targetUid);
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const memoryIds = Array.isArray(body.memoryIds)
    ? Array.from(new Set(body.memoryIds.map(String).filter(Boolean))).slice(
        0,
        MAX_MEMORY_IDS,
      )
    : [];
  if (memoryIds.length === 0) return Response.json({ statuses: {} });

  const token = await getFirebaseAccessToken();
  const entries = await Promise.all(
    memoryIds.map(async (memoryId): Promise<[string, ArchiveStatus | null]> => {
      for (const collection of MEMORY_COLLECTIONS) {
        const doc = (await getFirestoreDocument(
          `users/${targetUid}/${collection}/${encodeURIComponent(memoryId)}`,
          token,
        )) as Record<string, unknown> | null;
        if (!doc) continue;
        const duplicate = doc.duplicate && typeof doc.duplicate === "object"
          ? doc.duplicate
          : null;
        return [
          memoryId,
          {
            memoryId,
            archivedAt: numberOrNull(doc.archivedAt),
            archiveReason: stringOrNull(doc.archiveReason),
            duplicateOf: stringOrNull(doc.duplicateOf),
            duplicate,
          },
        ];
      }
      return [memoryId, null];
    }),
  );

  return Response.json({
    statuses: Object.fromEntries(
      entries.filter((entry): entry is [string, ArchiveStatus] =>
        Boolean(entry[1]),
      ),
    ),
  });
}
