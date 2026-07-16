import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  type ClusterSnapshotPhase,
  CLUSTERING_INPUT_VARIANT,
  MEMORY_VERSION,
  generateAndStoreSessionClusterSnapshots,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetUid?: unknown;
    missionId?: unknown;
    phases?: unknown;
  };
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const requestedTargetUid = stringOrNull(body.targetUid);
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const phases: ClusterSnapshotPhase[] = Array.isArray(body.phases)
    ? Array.from(
        new Set(
          body.phases.filter(
            (phase): phase is ClusterSnapshotPhase =>
              phase === "before" || phase === "after",
          ),
        ),
      )
    : ["before", "after"];
  if (phases.length === 0) {
    return Response.json({ error: "valid phase required" }, { status: 400 });
  }

  try {
    const token = await getFirebaseAccessToken();
    const profile = (await getFirestoreDocument(`users/${targetUid}`, token)) as
      | Record<string, unknown>
      | null;
    const missionOrder = Array.isArray(profile?.missionOrder)
      ? profile.missionOrder.map(String)
      : [];
    const subjectName = String(
      profile?.displayName ?? user.displayName ?? "",
    ).trim();
    const snapshots = await generateAndStoreSessionClusterSnapshots(
      targetUid,
      missionId,
      missionOrder,
      token,
      user.email ?? user.localId,
      subjectName,
      CLUSTERING_INPUT_VARIANT,
      phases,
    );

    return Response.json({
      snapshots,
      variant: CLUSTERING_INPUT_VARIANT,
      memoryVersion: MEMORY_VERSION,
    });
  } catch (error) {
    console.error("[api/memory/session-clusters POST]", error);
    return Response.json(
      { error: "세션 클러스터 스냅샷 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
