import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  deleteFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];
const VERSIONED_MEMORY_COLLECTION = "memories_0_1_1";

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

async function load(uid: string, collection: "episodicMemories" | "semanticMemories", token: string) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
  return Promise.all(
    ids.map(async (id) => {
      const doc =
        ((await getFirestoreDocument(`users/${uid}/${collection}/${id}`, token)) ??
          {}) as Record<string, unknown>;
      return {
        id,
        version: "0.1.0",
        type: collection === "episodicMemories" ? "episodic" : "semantic",
        ...doc,
        category: jsonArray(doc?.categoryJson),
        subcategory: jsonArray(doc?.subcategoryJson),
        keywords: jsonArray(doc?.keywordsJson),
      };
    }),
  ) as Promise<Array<Record<string, unknown> & { id: string; type: "episodic" | "semantic" }>>;
}

async function loadVersioned(uid: string, token: string) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${VERSIONED_MEMORY_COLLECTION}`,
    token,
  );
  const docs = await Promise.all(
    ids.map(async (id) => {
      const doc =
        ((await getFirestoreDocument(
          `users/${uid}/${VERSIONED_MEMORY_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return {
        id,
        version: String(doc.schemaVersion ?? "0.1.1"),
        type: String(doc.type ?? "interaction"),
        ...doc,
        episode: doc.content,
        semantic: jsonArray(doc.semantic).join("\n"),
        keywords: jsonArray(doc.keywords),
        timestamp: Number(doc.timestamp ?? doc.occurredAt ?? doc.createdAt ?? 0),
      };
    }),
  );
  return docs.filter((doc) => doc.type === "interaction");
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !ADMIN_EMAILS.includes(admin.email ?? "")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const version = new URL(request.url).searchParams.get("version") ?? "0.1.1";
  const token = await getFirebaseAccessToken();

  let deleted = 0;
  if (version === "0.1.1") {
    const ids = await listFirestoreDocumentIds(`users/${uid}/${VERSIONED_MEMORY_COLLECTION}`, token);
    await Promise.all(ids.map((id) => deleteFirestoreDocument(`users/${uid}/${VERSIONED_MEMORY_COLLECTION}/${id}`, token)));
    deleted = ids.length;
  } else {
    const [episodicIds, semanticIds] = await Promise.all([
      listFirestoreDocumentIds(`users/${uid}/episodicMemories`, token),
      listFirestoreDocumentIds(`users/${uid}/semanticMemories`, token),
    ]);
    await Promise.all([
      ...episodicIds.map((id) => deleteFirestoreDocument(`users/${uid}/episodicMemories/${id}`, token)),
      ...semanticIds.map((id) => deleteFirestoreDocument(`users/${uid}/semanticMemories/${id}`, token)),
    ]);
    deleted = episodicIds.length + semanticIds.length;
  }
  return Response.json({ ok: true, deleted });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !ADMIN_EMAILS.includes(admin.email ?? "")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const token = await getFirebaseAccessToken();
  const [episodic, semantic] = await Promise.all([
    load(uid, "episodicMemories", token),
    load(uid, "semanticMemories", token),
  ]);
  const versioned = await loadVersioned(uid, token);
  const memories = [...versioned, ...episodic, ...semantic].sort(
    (a, b) =>
      Number((b as Record<string, unknown>).timestamp ?? (b as Record<string, unknown>).createdAt ?? 0) -
      Number((a as Record<string, unknown>).timestamp ?? (a as Record<string, unknown>).createdAt ?? 0),
  );
  return Response.json({
    memories,
    counts: {
      "0.1.0": episodic.length + semantic.length,
      "0.1.1": versioned.length,
    },
  });
}
