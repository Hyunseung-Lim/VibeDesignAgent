import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { loadClusterInputItems } from "@/lib/server/memoryItems";
import {
  MAX_ITEMS,
  MEMORY_VERSION,
  generateAndStoreClusters,
  loadLatestStoredClusterDoc,
  memoryClusterItemSignature,
  normalizeClusteringInputVariant,
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
  const variant = normalizeClusteringInputVariant(
    new URL(request.url).searchParams.get("variant"),
  );

  try {
    const token = await getFirebaseAccessToken();
    const items = await loadClusterInputItems(target.uid, token, MAX_ITEMS);
    const itemSignature =
      items.length > 0 ? memoryClusterItemSignature(items) : null;
    // Unified with the session review: always return the latest cache doc for
    // this variant (by generatedAt), regardless of signature match, so both
    // screens resolve to the same document per variant. `stale` flags drift.
    const latest = await loadLatestStoredClusterDoc(target.uid, token, variant);
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
  const body = (await request.json().catch(() => ({}))) as { variant?: unknown };
  const variant = normalizeClusteringInputVariant(body.variant);

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
