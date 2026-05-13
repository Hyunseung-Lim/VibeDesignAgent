import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

function jsonArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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
  const [episodic, semantic] = await Promise.all([
    loadCollection(user.localId, "episodicMemories", token),
    loadCollection(user.localId, "semanticMemories", token),
  ]);
  return Response.json({
    episodic: episodic.slice(0, 100),
    semantic,
  });
}
