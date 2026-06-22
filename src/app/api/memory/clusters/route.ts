import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { loadClusterInputItems } from "@/lib/server/memoryItems";
import {
  CLUSTERING_INPUT_VARIANT,
  MEMORY_VERSION,
  MAX_ITEMS,
  isMemoryCluster,
  generateAndStoreClusters,
  clusterDocumentPath,
  memoryClusterItemSignature,
  parseStoredGraphEdges,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const token = await getFirebaseAccessToken();
    const items = await loadClusterInputItems(user.localId, token, MAX_ITEMS);
    if (items.length < 3) {
      return Response.json({
        clusters: [],
        edges: [],
        found: false,
        variant: CLUSTERING_INPUT_VARIANT,
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
        variant: CLUSTERING_INPUT_VARIANT,
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
      variant: CLUSTERING_INPUT_VARIANT,
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
    const items = await loadClusterInputItems(user.localId, token, MAX_ITEMS);
    const profile = await getFirestoreDocument(`users/${user.localId}`, token);
    const subjectName = String(
      profile?.displayName ?? user.displayName ?? "",
    ).trim();

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
      subjectName,
    );

    return Response.json({
      clusters: graphClusters,
      edges: graphEdges,
      found: graphClusters.length > 0,
      variant: CLUSTERING_INPUT_VARIANT,
      memoryVersion: MEMORY_VERSION,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[api/memory/clusters POST]", err);
    return Response.json({ error: "클러스터 생성에 실패했습니다." }, { status: 500 });
  }
}
