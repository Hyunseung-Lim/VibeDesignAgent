import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getFirebaseAccessToken();
    const ids = await listFirestoreDocumentIds(
      `users/${user.localId}/${MEMORY_COLLECTION}`,
      token,
    );

    const docs = await Promise.all(
      ids.map(async (id) => {
        const data =
          ((await getFirestoreDocument(
            `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
            token,
          )) ?? {}) as Record<string, unknown>;
        return {
          id,
          episodic: str(data.episodic ?? data.episode),
          semantic: str(data.semantic),
          input: str(data.input),
          output: str(data.output),
          originalInteractionContent: str(data.originalInteractionContent),
          action: str(data.action),
          sourceType: str(data.sourceType ?? data.memorySource),
          keywords: Array.isArray(data.keywords)
            ? data.keywords.map(String)
            : Array.isArray(data.keyword)
              ? (data.keyword as unknown[]).map(String)
              : [],
          weight: num(data.weight),
          embedding: numArray(data.embedding),
          timestamp: num(data.timestamp ?? data.createdAt),
          archivedAt: num(data.archivedAt),
          archiveReason: str(data.archiveReason),
          source: data.source && typeof data.source === "object"
            ? data.source
            : null,
        };
      }),
    );

    const memories = docs
      .filter(
        (d) =>
          d.episodic ||
          d.semantic ||
          d.input ||
          d.output ||
          d.keywords.length > 0,
      )
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    return Response.json({ memories });
  } catch (err) {
    console.error("[api/memory/all]", err);
    return Response.json({ error: "failed to load memories" }, { status: 500 });
  }
}
