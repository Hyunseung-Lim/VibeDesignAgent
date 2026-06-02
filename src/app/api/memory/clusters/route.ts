import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  CLUSTER_COLLECTION,
  MEMORY_VERSION,
  MAX_ITEMS,
  isMemoryCluster,
  generateAndStoreClusters,
  type ClusterInputItem,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function loadMemoryItems(uid: string, token: string): Promise<ClusterInputItem[]> {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${MEMORY_COLLECTION}`, token);
  const items: ClusterInputItem[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const data = ((await getFirestoreDocument(
        `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
        token,
      )) ?? {}) as Record<string, unknown>;
      const episodic = str(data.episodic ?? data.episode);
      if (!episodic && !str(data.semantic) && !str(data.input)) return;
      items.push({
        id,
        action: str(data.action) ?? undefined,
        keyword: Array.isArray(data.keywords)
          ? data.keywords.map(String)
          : Array.isArray(data.keyword)
            ? (data.keyword as unknown[]).map(String)
            : [],
        episodic: episodic ?? undefined,
        semantic: str(data.semantic) ?? undefined,
        input: str(data.input) ?? undefined,
        output: str(data.output) ?? undefined,
        timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
      });
    }),
  );
  return items.slice(0, MAX_ITEMS);
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getFirebaseAccessToken();
    const ids = await listFirestoreDocumentIds(
      `users/${user.localId}/${CLUSTER_COLLECTION}`,
      token,
    );
    if (ids.length === 0) return Response.json({ clusters: [], found: false });

    const docs = await Promise.all(
      ids.map(async (id) => {
        const data = (await getFirestoreDocument(
          `users/${user.localId}/${CLUSTER_COLLECTION}/${encodeURIComponent(id)}`,
          token,
        )) as Record<string, unknown> | null;
        return { id, data };
      }),
    );

    const latest = docs
      .filter((d) => d.data)
      .sort((a, b) => {
        const ta = Number((a.data as Record<string, unknown>).generatedAt ?? 0);
        const tb = Number((b.data as Record<string, unknown>).generatedAt ?? 0);
        return tb - ta;
      })[0];

    if (!latest?.data) return Response.json({ clusters: [], found: false });

    const clusters = Array.isArray(latest.data.graphClusters)
      ? latest.data.graphClusters.filter(isMemoryCluster)
      : [];

    return Response.json({
      clusters,
      found: clusters.length > 0,
      memoryVersion: typeof latest.data.memoryVersion === "string"
        ? latest.data.memoryVersion
        : MEMORY_VERSION,
      generatedAt: typeof latest.data.generatedAt === "number"
        ? latest.data.generatedAt
        : null,
    });
  } catch (err) {
    console.error("[api/memory/clusters GET]", err);
    return Response.json({ error: "failed to load clusters" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getFirebaseAccessToken();
    const items = await loadMemoryItems(user.localId, token);

    if (items.length < 3) {
      return Response.json(
        { error: "클러스터링에 필요한 기억이 부족합니다. (최소 3개)" },
        { status: 400 },
      );
    }

    const { graphClusters } = await generateAndStoreClusters(
      user.localId,
      items,
      token,
      user.email ?? user.localId,
    );

    return Response.json({
      clusters: graphClusters,
      found: graphClusters.length > 0,
      memoryVersion: MEMORY_VERSION,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[api/memory/clusters POST]", err);
    return Response.json({ error: "클러스터 생성에 실패했습니다." }, { status: 500 });
  }
}
