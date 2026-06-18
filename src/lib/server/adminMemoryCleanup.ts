import {
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreDocumentIds,
} from "@/lib/server/firebaseAdminRest";

export const ADMIN_MEMORY_COLLECTION = "memories_0_1_2";
export const ADMIN_MEMORY_CLUSTER_COLLECTION = "memoryClusters";
export const ADMIN_MEMORY_RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";

function sourceMissionId(doc: Record<string, unknown>) {
  const source = doc.source;
  if (source && typeof source === "object") {
    const missionId = (source as Record<string, unknown>).missionId;
    if (typeof missionId === "string" && missionId.trim()) {
      return missionId.trim();
    }
  }
  const missionId = doc.missionId;
  return typeof missionId === "string" && missionId.trim()
    ? missionId.trim()
    : null;
}

export async function deleteUserCollection(
  uid: string,
  collection: string,
  token: string,
) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
  await Promise.all(
    ids.map((id) =>
      deleteFirestoreDocument(`users/${uid}/${collection}/${id}`, token),
    ),
  );
  return ids.length;
}

async function matchingMissionDocumentIds(
  uid: string,
  collection: string,
  missionId: string,
  token: string,
) {
  const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
  const docs = await Promise.all(
    ids.map(async (id) => ({
      id,
      data:
        ((await getFirestoreDocument(
          `users/${uid}/${collection}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>,
    })),
  );
  return docs
    .filter((doc) => sourceMissionId(doc.data) === missionId)
    .map((doc) => doc.id);
}

export async function deleteMissionScopedMemoryData(
  uid: string,
  missionId: string,
  token: string,
) {
  const memoryIds = await matchingMissionDocumentIds(
    uid,
    ADMIN_MEMORY_COLLECTION,
    missionId,
    token,
  );
  await Promise.all(
    memoryIds.map((id) =>
      deleteFirestoreDocument(
        `users/${uid}/${ADMIN_MEMORY_COLLECTION}/${id}`,
        token,
      ),
    ),
  );

  const retrievalLogIds = await matchingMissionDocumentIds(
    uid,
    ADMIN_MEMORY_RETRIEVAL_LOG_COLLECTION,
    missionId,
    token,
  );
  await Promise.all(
    retrievalLogIds.map((id) =>
      deleteFirestoreDocument(
        `users/${uid}/${ADMIN_MEMORY_RETRIEVAL_LOG_COLLECTION}/${id}`,
        token,
      ),
    ),
  );

  // Cluster documents are cache entries over the full memory item signature.
  // Once any mission-scoped memory is removed, every old cluster cache can be
  // stale, so clear them all and let /agent regenerate on demand.
  const deletedMemoryClusters = await deleteUserCollection(
    uid,
    ADMIN_MEMORY_CLUSTER_COLLECTION,
    token,
  );

  return {
    deletedMemories: memoryIds.length,
    deletedMemoryClusters,
    deletedMemoryRetrievalLogs: retrievalLogIds.length,
  };
}
