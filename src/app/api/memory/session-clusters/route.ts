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
  generateSessionClusterSnapshotPreview,
} from "@/lib/server/memoryClustering";

export const runtime = "nodejs";

const MAX_PREVIEW_OVERRIDE_IDS = 100;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean),
        ),
      ).slice(0, MAX_PREVIEW_OVERRIDE_IDS)
    : [];
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetUid?: unknown;
    missionId?: unknown;
    phases?: unknown;
    preview?: unknown;
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

    // Preview 모드: 리뷰 staging 중 토글을 가정한 after snapshot을 계산만 하고
    // 저장하지 않는다. 실제 snapshot/memory 문서는 리뷰 제출 시 갱신된다.
    if (body.preview && typeof body.preview === "object") {
      const preview = body.preview as Record<string, unknown>;
      const snapshot = await generateSessionClusterSnapshotPreview(
        targetUid,
        missionId,
        missionOrder,
        token,
        subjectName,
        CLUSTERING_INPUT_VARIANT,
        idList(preview.assumeActiveMemoryIds),
        idList(preview.assumeInactiveMemoryIds),
      );
      return Response.json({
        snapshot,
        variant: CLUSTERING_INPUT_VARIANT,
        memoryVersion: MEMORY_VERSION,
      });
    }

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
