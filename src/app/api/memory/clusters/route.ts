import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  MEMORY_VERSION,
  MAX_ITEMS,
  isMemoryCluster,
  generateAndStoreClusters,
  clusterDocumentPath,
  memoryClusterItemSignature,
  parseStoredGraphEdges,
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
    const items = await loadMemoryItems(user.localId, token);
    if (items.length < 3) {
      return Response.json({
        clusters: [],
        edges: [],
        found: false,
        memoryVersion: MEMORY_VERSION,
        itemSignature: null,
        generatedAt: null,
      });
    }

    const itemSignature = memoryClusterItemSignature(items);
    const data = (await getFirestoreDocument(
      clusterDocumentPath(user.localId, MEMORY_VERSION, itemSignature),
      token,
    )) as Record<string, unknown> | null;

    if (!data || data.itemSignature !== itemSignature) {
      return Response.json({
        clusters: [],
        edges: [],
        found: false,
        memoryVersion: MEMORY_VERSION,
        itemSignature,
        generatedAt: null,
      });
    }

    const clusters = Array.isArray(data.graphClusters)
      ? data.graphClusters.filter(isMemoryCluster)
      : [];

    return Response.json({
      clusters,
      edges: parseStoredGraphEdges(data.graphEdges),
      found: clusters.length > 0,
      memoryVersion: typeof data.memoryVersion === "string"
        ? data.memoryVersion
        : MEMORY_VERSION,
      itemSignature,
      generatedAt: typeof data.generatedAt === "number"
        ? data.generatedAt
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

    const { graphClusters, graphEdges } = await generateAndStoreClusters(
      user.localId,
      items,
      token,
      user.email ?? user.localId,
    );

    return Response.json({
      clusters: graphClusters,
      edges: graphEdges,
      found: graphClusters.length > 0,
      memoryVersion: MEMORY_VERSION,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[api/memory/clusters POST]", err);
    return Response.json({ error: "클러스터 생성에 실패했습니다." }, { status: 500 });
  }
}
