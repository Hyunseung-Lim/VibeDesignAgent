import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  deleteFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

function jsonArray(value: unknown) {
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
        type: collection === "episodicMemories" ? "episodic" : "semantic",
        ...doc,
        category: jsonArray(doc?.categoryJson),
        subcategory: jsonArray(doc?.subcategoryJson),
        keywords: jsonArray(doc?.keywordsJson),
      };
    }),
  ) as Promise<Array<Record<string, unknown> & { id: string; type: "episodic" | "semantic" }>>;
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
  const token = await getFirebaseAccessToken();
  const [episodicIds, semanticIds] = await Promise.all([
    listFirestoreDocumentIds(`users/${uid}/episodicMemories`, token),
    listFirestoreDocumentIds(`users/${uid}/semanticMemories`, token),
  ]);
  await Promise.all([
    ...episodicIds.map((id) => deleteFirestoreDocument(`users/${uid}/episodicMemories/${id}`, token)),
    ...semanticIds.map((id) => deleteFirestoreDocument(`users/${uid}/semanticMemories/${id}`, token)),
  ]);
  return Response.json({ ok: true, deleted: episodicIds.length + semanticIds.length });
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
  const memories = [...episodic, ...semantic].sort(
    (a, b) => Number(b.timestamp ?? b.createdAt ?? 0) - Number(a.timestamp ?? a.createdAt ?? 0),
  );
  return Response.json({ memories });
}
