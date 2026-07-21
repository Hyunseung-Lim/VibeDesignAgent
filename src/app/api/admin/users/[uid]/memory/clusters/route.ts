import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  MEMORY_VERSION,
  CLUSTERING_INPUT_VARIANT,
  generateAndStoreClusters,
  loadAfterClusterSnapshots,
  loadClusterInputItems,
  loadLatestStoredClusterDoc,
  memoryClusterItemSignature,
  pickLatestAfterSnapshot,
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

function profileMissionOrder(profile: Record<string, unknown> | null) {
  return Array.isArray(profile?.missionOrder)
    ? profile.missionOrder.map(String)
    : [];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const target = await adminTarget(request, params);
  if (!target) return Response.json({ error: "forbidden" }, { status: 403 });
  const variant = CLUSTERING_INPUT_VARIANT;

  try {
    const token = await getFirebaseAccessToken();
    const profile = await getFirestoreDocument(`users/${target.uid}`, token);
    const missionOrder = profileMissionOrder(profile);
    const items = await loadClusterInputItems(target.uid, token, missionOrder);
    const itemSignature =
      items.length > 0 ? memoryClusterItemSignature(items) : null;
    // Same contract as the self route: per-mission frozen after snapshots for
    // the session chips and the 전체 tab, latest cache doc as fallback only.
    const afterSnapshots = await loadAfterClusterSnapshots(target.uid, token);
    const lastAfter = pickLatestAfterSnapshot(afterSnapshots, missionOrder);
    const latest = await loadLatestStoredClusterDoc(target.uid, token, variant);
    return Response.json({
      clusters: latest?.graphClusters ?? [],
      edges: latest?.graphEdges ?? [],
      found: Boolean(latest?.graphClusters.length),
      stale: latest ? latest.itemSignature !== itemSignature : false,
      afterSnapshots: afterSnapshots.map((snapshot) => ({
        missionId: snapshot.missionId,
        itemIds: snapshot.itemIds,
        graphClusters: snapshot.graphClusters,
        graphEdges: snapshot.graphEdges,
        generatedAt: snapshot.generatedAt,
      })),
      lastAfterMissionId: lastAfter?.missionId ?? null,
      variant,
      memoryVersion: MEMORY_VERSION,
      itemSignature,
      generatedAt: latest?.generatedAt || null,
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
  const variant = CLUSTERING_INPUT_VARIANT;

  try {
    const token = await getFirebaseAccessToken();
    const profile = await getFirestoreDocument(`users/${target.uid}`, token);
    const items = await loadClusterInputItems(
      target.uid,
      token,
      profileMissionOrder(profile),
    );
    if (items.length < 3) {
      return Response.json(
        { error: "클러스터링에 필요한 기억이 부족합니다. (최소 3개)" },
        { status: 400 },
      );
    }

    const subjectName = String(profile?.displayName ?? "").trim();
    const { graphClusters, graphEdges } = await generateAndStoreClusters(
      target.uid,
      items,
      token,
      target.admin.email ?? target.admin.localId,
      subjectName,
      variant,
    );

    return Response.json({
      clusters: graphClusters,
      edges: graphEdges,
      found: graphClusters.length > 0,
      variant,
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
