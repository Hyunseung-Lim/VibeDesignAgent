import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const PROFILE_MEMORY_MAX_ITEMS = 5;
const PROFILE_MEMORY_MAX_CHARS = 240;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateProfileInput(value: string) {
  return value.slice(0, PROFILE_MEMORY_MAX_CHARS);
}

function numberOrNow(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

type ProfileMemoryItem = {
  id: string;
  input: string;
  createdAt: number;
  updatedAt: number;
};

function sanitizeItem(raw: unknown): ProfileMemoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const input = stringOrNull(item.input);
  const id = stringOrNull(item.id);
  if (!input || !id) return null;
  return {
    id,
    input: truncateProfileInput(input),
    createdAt: numberOrNow(item.createdAt),
    updatedAt: numberOrNow(item.updatedAt),
  };
}

function isProfileMemoryItem(item: ProfileMemoryItem | null): item is ProfileMemoryItem {
  return Boolean(item);
}

function itemsChanged(previousItems: ProfileMemoryItem[], nextItems: ProfileMemoryItem[]) {
  return (
    JSON.stringify(previousItems.map(({ id, input }) => ({ id, input }))) !==
    JSON.stringify(nextItems.map(({ id, input }) => ({ id, input })))
  );
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const missionId = url.searchParams.get("missionId");
  if (!missionId?.trim()) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const requestedTargetUid = url.searchParams.get("targetUid");
  const includeRevisions = url.searchParams.get("includeRevisions") === "1";
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const doc = (await getFirestoreDocument(
    `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}`,
    token,
  )) as Record<string, unknown> | null;

  const items = Array.isArray(doc?.items)
    ? doc.items.map(sanitizeItem).filter(isProfileMemoryItem)
    : [];

  const revisions = includeRevisions
    ? (
        await Promise.all(
          (
            await listFirestoreDocumentIds(
              `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}/revisions`,
              token,
            )
          ).map(async (id) => {
            const revision =
              ((await getFirestoreDocument(
                `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}/revisions/${encodeURIComponent(id)}`,
                token,
              )) ?? {}) as Record<string, unknown>;
            return { id, ...revision };
          }),
        )
      ).sort(
        (a, b) =>
          Number((b as Record<string, unknown>).createdAt ?? 0) -
          Number((a as Record<string, unknown>).createdAt ?? 0),
      )
    : undefined;

  return Response.json({ missionId, items, revisions });
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
  const items = rawItems
    .map(sanitizeItem)
    .filter(isProfileMemoryItem)
    .slice(0, PROFILE_MEMORY_MAX_ITEMS);

  const token = await getFirebaseAccessToken();
  const documentPath = `users/${user.localId}/profile_memories/${encodeURIComponent(missionId)}`;
  const previousDoc = (await getFirestoreDocument(
    documentPath,
    token,
  )) as Record<string, unknown> | null;
  const previousItems = Array.isArray(previousDoc?.items)
    ? previousDoc.items.map(sanitizeItem).filter(isProfileMemoryItem)
    : [];
  const now = Date.now();

  await patchFirestoreDocument(
    documentPath,
    { missionId, items, updatedAt: now },
    token,
  );

  let revisionId: string | null = null;
  if (itemsChanged(previousItems, items)) {
    revisionId = String(now);
    await patchFirestoreDocument(
      `${documentPath}/revisions/${revisionId}`,
      {
        missionId,
        previousItems,
        nextItems: items,
        previousCount: previousItems.length,
        nextCount: items.length,
        createdAt: now,
        actorUid: user.localId,
        source: "session-start-profile-upsert",
      },
      token,
    );
  }

  return Response.json({
    ok: true,
    missionId,
    count: items.length,
    revisionId,
  });
}
