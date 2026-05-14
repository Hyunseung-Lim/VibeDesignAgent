import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_1";

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

async function loadVersionedMemories(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${MEMORY_COLLECTION}`, token);
  const docs: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    ids.slice(-200).map(async (id) => {
      const data =
        (await getFirestoreDocument(`users/${uid}/${MEMORY_COLLECTION}/${id}`, token)) ??
        {};
      return { id, ...(data as Record<string, unknown>) };
    }),
  );
  const sorted = docs.sort(
    (a, b) =>
      Number(b.timestamp ?? b.occurredAt ?? b.createdAt ?? 0) -
      Number(a.timestamp ?? a.occurredAt ?? a.createdAt ?? 0),
  );
  return {
    episodic: sorted
      .filter(
        (doc) =>
          doc.type === "interaction" &&
          typeof doc.content === "string" &&
          doc.content.trim(),
      )
      .map((doc) => ({
        ...doc,
        episode: doc.content,
      })),
    semantic: sorted.filter((doc) => doc.type === "interaction").flatMap((doc) =>
      jsonArray(doc.semantic).map((semantic, index) => ({
        id: `${doc.id}-semantic-${index}`,
        type: "semantic",
        semantic,
        keywords: jsonArray(doc.keywords),
        source: doc.source,
        timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
        schemaVersion: doc.schemaVersion,
      })),
    ),
  };
}

async function loadCollection(uid: string, collection: "episodicMemories" | "semanticMemories", token: string) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
  const docs: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    ids.slice(-200).map(async (id) => {
      const data =
        (await getFirestoreDocument(`users/${uid}/${collection}/${id}`, token)) ??
        {};
      return { id, ...(data as Record<string, unknown>) };
    }),
  );
  const rows: Array<Record<string, unknown> & { id: string }> = docs
    .map((doc) => ({
      ...doc,
      category: jsonArray(doc.categoryJson),
      subcategory: jsonArray(doc.subcategoryJson),
      keywords: jsonArray(doc.keywordsJson),
    }));
  return rows.sort(
    (a, b) =>
      Number(b.timestamp ?? b.createdAt ?? 0) -
      Number(a.timestamp ?? a.createdAt ?? 0),
  );
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const token = await getFirebaseAccessToken();
  const versioned = await loadVersionedMemories(user.localId, token);
  if (versioned.episodic.length > 0 || versioned.semantic.length > 0) {
    return Response.json({
      episodic: versioned.episodic.slice(0, 100),
      semantic: versioned.semantic,
    });
  }
  const [episodic, semantic] = await Promise.all([
    loadCollection(user.localId, "episodicMemories", token),
    loadCollection(user.localId, "semanticMemories", token),
  ]);
  return Response.json({
    episodic: episodic.slice(0, 100),
    semantic,
  });
}
