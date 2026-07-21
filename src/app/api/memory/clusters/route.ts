import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  MEMORY_VERSION,
  generateAndStoreClusters,
  loadAfterClusterSnapshots,
  loadClusterInputItems,
  loadLatestStoredClusterDoc,
  memoryClusterItemSignature,
  pickLatestAfterSnapshot,
  CLUSTERING_INPUT_VARIANT,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

function profileMissionOrder(profile: Record<string, unknown> | null) {
  return Array.isArray(profile?.missionOrder)
    ? profile.missionOrder.map(String)
    : [];
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const variant = CLUSTERING_INPUT_VARIANT;
  try {
    const token = await getFirebaseAccessToken();
    const profile = await getFirestoreDocument(`users/${user.localId}`, token);
    const missionOrder = profileMissionOrder(profile);
    const items = await loadClusterInputItems(user.localId, token, missionOrder);
    const itemSignature =
      items.length > 0 ? memoryClusterItemSignature(items) : null;
    // Per-mission frozen after snapshots: the memory view renders these for the
    // session chips and the 전체 tab (= last completed mission), so it matches
    // the session review exactly. The latest cache doc stays as the fallback
    // for missions without a snapshot; `stale` flags signature drift.
    const afterSnapshots = await loadAfterClusterSnapshots(user.localId, token);
    const lastAfter = pickLatestAfterSnapshot(afterSnapshots, missionOrder);
    const latest = await loadLatestStoredClusterDoc(
      user.localId,
      token,
      variant,
    );
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
  } catch (err) {
    console.error("[api/memory/clusters GET]", err);
    return Response.json({ error: "failed to load clusters" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const variant = CLUSTERING_INPUT_VARIANT;
  try {
    const token = await getFirebaseAccessToken();
    const profile = await getFirestoreDocument(`users/${user.localId}`, token);
    const items = await loadClusterInputItems(
      user.localId,
      token,
      profileMissionOrder(profile),
    );
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
  } catch (err) {
    console.error("[api/memory/clusters POST]", err);
    return Response.json({ error: "클러스터 생성에 실패했습니다." }, { status: 500 });
  }
}
