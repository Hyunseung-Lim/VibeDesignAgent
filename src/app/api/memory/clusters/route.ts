import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { loadClusterInputItems } from "@/lib/server/memoryItems";
import {
  MEMORY_VERSION,
  MAX_ITEMS,
  generateAndStoreClusters,
  loadLatestStoredClusterDoc,
  memoryClusterItemSignature,
  CLUSTERING_INPUT_VARIANT,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const variant = CLUSTERING_INPUT_VARIANT;
  try {
    const token = await getFirebaseAccessToken();
    const items = await loadClusterInputItems(user.localId, token, MAX_ITEMS);
    const itemSignature =
      items.length > 0 ? memoryClusterItemSignature(items) : null;
    // Unified with the session review: always return the latest cache doc for
    // this variant (by generatedAt), regardless of signature match. Both screens
    // use this same rule so they resolve to the same document per variant.
    // `stale` flags signature drift (current memory set no longer matches).
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
