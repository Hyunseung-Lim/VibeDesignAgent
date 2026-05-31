import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTIONS = ["memories_0_1_2", "memories_0_1_1"];
const MAX_MEMORY_DOCS = 300;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceMissionId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return stringOrNull(source.missionId);
}

function compactMemory(id: string, doc: Record<string, unknown>) {
  return {
    id,
    episodic: stringOrNull(doc.episodic ?? doc.episode ?? doc.content),
    semantic: stringOrNull(doc.semantic),
    input: stringOrNull(doc.input),
    output: stringOrNull(doc.output),
    weight: numberOrNull(doc.weight),
    archivedAt: numberOrNull(doc.archivedAt),
    archiveReason: stringOrNull(doc.archiveReason),
    duplicateOf: stringOrNull(doc.duplicateOf),
    duplicate:
      doc.duplicate && typeof doc.duplicate === "object"
        ? doc.duplicate
        : null,
    source: doc.source ?? null,
    timestamp: numberOrNull(doc.timestamp ?? doc.createdAt),
  };
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetUid?: unknown;
    missionId?: unknown;
  };
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const requestedTargetUid = stringOrNull(body.targetUid);
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const sessionPath = `sessions/${targetUid}/missions/${encodeURIComponent(
    missionId,
  )}`;
  const draftIds = await listFirestoreDocumentIds(
    `${sessionPath}/memoryDrafts`,
    token,
  );
  const drafts = await Promise.all(
    draftIds.map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `${sessionPath}/memoryDrafts/${encodeURIComponent(id)}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return {
        id,
        episodic: stringOrNull(doc.episode ?? doc.episodic),
        semantic:
          stringOrNull(doc.semantic) ??
          (Array.isArray(doc.semanticJson)
            ? stringOrNull(doc.semanticJson[0])
            : null),
        input: stringOrNull(doc.input),
        output: stringOrNull(doc.output),
        status: stringOrNull(doc.status),
        promotedAt: numberOrNull(doc.promotedAt),
        timestamp: numberOrNull(doc.timestamp ?? doc.createdAt),
      };
    }),
  );

  const promoted = (
    await Promise.all(
      MEMORY_COLLECTIONS.map(async (collection) => {
        const ids = await listFirestoreDocumentIds(
          `users/${targetUid}/${collection}`,
          token,
        );
        const docs = await Promise.all(
          ids.slice(-MAX_MEMORY_DOCS).map(async (id) => {
            const doc =
              ((await getFirestoreDocument(
                `users/${targetUid}/${collection}/${encodeURIComponent(id)}`,
                token,
              )) ?? {}) as Record<string, unknown>;
            if (sourceMissionId(doc.source) !== missionId) return null;
            return compactMemory(id, doc);
          }),
        );
        return docs.filter(Boolean);
      }),
    )
  )
    .flat()
    .filter((item): item is ReturnType<typeof compactMemory> => Boolean(item))
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));

  return Response.json({ drafts, promoted });
}
