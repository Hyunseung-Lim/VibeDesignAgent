import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  deleteFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function loadMemories(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  const docs = await Promise.all(
    ids.map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `users/${uid}/${MEMORY_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      const schemaVersion = String(doc.schemaVersion ?? "0.1.2");
      return {
        id,
        ...doc,
        version: schemaVersion,
        type: String(doc.type ?? doc.sourceType ?? "during_session"),
        episode: doc.episodic ?? doc.content,
        episodic: doc.episodic ?? doc.content,
        semantic:
          typeof doc.semantic === "string"
            ? doc.semantic
            : jsonArray(doc.semantic).join("\n"),
        keywords: jsonArray(doc.keyword).length
          ? jsonArray(doc.keyword)
          : jsonArray(doc.keywords),
        timestamp: Number(doc.timestamp ?? doc.occurredAt ?? doc.createdAt ?? 0),
      };
    }),
  );
  return docs.filter((doc) => {
    const row = doc as Record<string, unknown>;
    const sourceType = String(row.sourceType ?? row.memorySource ?? row.type ?? "");
    return sourceType === "during_session" || sourceType === "before_session";
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const token = await getFirebaseAccessToken();

  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  await Promise.all(
    ids.map((id) =>
      deleteFirestoreDocument(`users/${uid}/${MEMORY_COLLECTION}/${id}`, token),
    ),
  );
  return Response.json({ ok: true, deleted: ids.length });
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
  const memories = (await loadMemories(uid, token)).sort(
    (a, b) =>
      Number((b as Record<string, unknown>).timestamp ?? (b as Record<string, unknown>).createdAt ?? 0) -
      Number((a as Record<string, unknown>).timestamp ?? (a as Record<string, unknown>).createdAt ?? 0),
  );
  return Response.json({
    memories,
    counts: {
      "0.1.2": memories.length,
    },
  });
}
