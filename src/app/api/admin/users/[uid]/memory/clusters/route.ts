import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { loadClusterInputItems } from "@/lib/server/memoryItems";
import {
  CLUSTERING_INPUT_VARIANT,
  MAX_ITEMS,
  MEMORY_VERSION,
  clusterDocumentPath,
  generateAndStoreClusters,
  isMemoryCluster,
  memoryClusterItemSignature,
  parseStoredGraphEdges,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

async function adminTarget(
  request: Request,
  params: Promise<{ uid: string }>,
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) return null;
  const { uid } = await params;
  return { admin, uid };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const target = await adminTarget(request, params);
  if (!target) return Response.json({ error: "forbidden" }, { status: 403 });

  try {
    const token = await getFirebaseAccessToken();
    const items = await loadClusterInputItems(target.uid, token, MAX_ITEMS);
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
      clusterDocumentPath(target.uid, MEMORY_VERSION, itemSignature),
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
      memoryVersion:
        typeof data.memoryVersion === "string"
          ? data.memoryVersion
          : MEMORY_VERSION,
      itemSignature,
      generatedAt:
        typeof data.generatedAt === "number" ? data.generatedAt : null,
    });
  } catch (error) {
    console.error("[api/admin/users/[uid]/memory/clusters GET]", error);
    return Response.json(
      { error: "failed to load clusters" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const target = await adminTarget(request, params);
  if (!target) return Response.json({ error: "forbidden" }, { status: 403 });

  try {
    const token = await getFirebaseAccessToken();
    const items = await loadClusterInputItems(target.uid, token, MAX_ITEMS);
    if (items.length < 3) {
      return Response.json(
        { error: "클러스터링에 필요한 기억이 부족합니다. (최소 3개)" },
        { status: 400 },
      );
    }

    const profile = await getFirestoreDocument(`users/${target.uid}`, token);
    const subjectName = String(profile?.displayName ?? "").trim();
    const { graphClusters, graphEdges } = await generateAndStoreClusters(
      target.uid,
      items,
      token,
      target.admin.email ?? target.admin.localId,
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
  } catch (error) {
    console.error("[api/admin/users/[uid]/memory/clusters POST]", error);
    return Response.json(
      { error: "클러스터 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
