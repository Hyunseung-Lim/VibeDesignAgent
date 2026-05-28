import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

// Legacy endpoint: the main app no longer preloads memory at session start.
// Current chat turns use POST /api/memory/retrieve and inject only query-relevant
// top matches into /api/chat. Keep this route for older clients/debug exports.
const MEMORY_COLLECTION = "memories_0_1_2";
const LEGACY_MEMORY_COLLECTION = "memories_0_1_1";

function legacyResponse(body: Record<string, unknown>) {
  return Response.json(
    {
      ...body,
      legacy: true,
      deprecated: true,
      replacement: "/api/memory/retrieve",
    },
    {
      headers: {
        "X-VDA-Legacy-Endpoint": "true",
        "X-VDA-Replacement": "/api/memory/retrieve",
      },
    },
  );
}

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
          typeof (doc.episodic ?? doc.content) === "string" &&
          String(doc.episodic ?? doc.content).trim(),
      )
      .map((doc) => ({
        ...doc,
        episode: doc.episodic ?? doc.content,
        episodic: doc.episodic ?? doc.content,
        keyword: jsonArray(doc.keyword).length
          ? jsonArray(doc.keyword)
          : jsonArray(doc.keywords),
      })),
    semantic: sorted
      .filter(
        (doc) =>
          doc.type === "interaction" &&
          typeof doc.semantic === "string" &&
          doc.semantic.trim(),
      )
      .map((doc) => ({
        ...doc,
        id: doc.id,
        type: "memory",
        action: doc.action ?? doc.agentActionCategory,
        keyword: jsonArray(doc.keyword).length
          ? jsonArray(doc.keyword)
          : jsonArray(doc.keywords),
        episodic: doc.episodic ?? doc.content,
        episode: doc.episodic ?? doc.content,
        semantic: doc.semantic,
        weight: doc.weight,
        source: doc.source,
        timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
        schemaVersion: doc.schemaVersion,
      })),
  };
}

async function loadLegacyVersionedMemories(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${LEGACY_MEMORY_COLLECTION}`, token);
  const docs: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    ids.slice(-200).map(async (id) => {
      const data =
        (await getFirestoreDocument(`users/${uid}/${LEGACY_MEMORY_COLLECTION}/${id}`, token)) ??
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
        episodic: doc.content,
      })),
    semantic: sorted.filter((doc) => doc.type === "interaction").flatMap((doc) =>
      jsonArray(doc.semantic).map((semantic, index) => ({
        id: `${doc.id}-semantic-${index}`,
        type: "semantic",
        semantic,
        episodic: doc.content,
        episode: doc.content,
        keywords: jsonArray(doc.keywords),
        keyword: jsonArray(doc.keywords),
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
    return legacyResponse({
      episodic: versioned.episodic.slice(0, 100),
      semantic: versioned.semantic,
    });
  }
  const legacyVersioned = await loadLegacyVersionedMemories(user.localId, token);
  if (legacyVersioned.episodic.length > 0 || legacyVersioned.semantic.length > 0) {
    return legacyResponse({
      episodic: legacyVersioned.episodic.slice(0, 100),
      semantic: legacyVersioned.semantic,
    });
  }
  const [episodic, semantic] = await Promise.all([
    loadCollection(user.localId, "episodicMemories", token),
    loadCollection(user.localId, "semanticMemories", token),
  ]);
  return legacyResponse({
    episodic: episodic.slice(0, 100),
    semantic,
  });
}
