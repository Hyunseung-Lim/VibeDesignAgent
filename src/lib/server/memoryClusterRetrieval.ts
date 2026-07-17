const CLUSTER_UPLIFT_WEIGHT = 0.2;
const GLOBAL_SAFEGUARD_COUNT = 2;
const MIN_CLUSTER_ASSIGNMENT_COVERAGE = 0.5;
// Legacy member-similarity evidence — 쿼리 임베딩이 없을 때만 쓰는 폴백.
const CLUSTER_EVIDENCE_MAX_WEIGHT = 0.7;
const CLUSTER_EVIDENCE_TOP_MEAN_WEIGHT = 0.3;
const CLUSTER_EVIDENCE_MEMBER_LIMIT = 3;

type RankedMemory = {
  id: string;
  similarity: number;
  embedding?: number[];
};

type RetrievalCluster = {
  id: string;
  itemIds: string[];
};

export type ClusterRetrievalScore = {
  clusterId: string;
  score: number;
  activeMemberCount: number;
};

export type ClusterEvidenceMode = "query_centroid" | "member_similarity";

export type ClusterAwareRanking<T extends RankedMemory> = {
  items: T[];
  scoreByItemId: Map<string, number>;
  clusterScores: ClusterRetrievalScore[];
  globalTopIds: string[];
  assignedCandidateCount: number;
  assignmentCoverage: number;
  usedClusterRanking: boolean;
  evidenceMode: ClusterEvidenceMode | null;
};

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cosineSimilarity(a: number[] | Float64Array, b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 개별 cosine 순위에 클러스터 소속 근거를 얹는 hybrid rerank.
//
// 클러스터 증거는 "쿼리 ↔ 클러스터 centroid cosine"이다(query_centroid 모드).
// 후보 자신은 centroid에서 제외(leave-one-out)해 자기 강화를 막고, 증거가
// 쿼리 특이적이 되도록 한다 — 멤버 최고 유사도 기반 증거(v1)는 쿼리와 무관하게
// 늘 높은 점수를 받는 크고 일반적인 클러스터에 편향됐다(15.306).
// 쿼리 임베딩이나 멤버 임베딩이 없으면 v1 member_similarity 증거로 폴백한다.
export function rankMemoriesWithClusters<T extends RankedMemory>(
  globallyRanked: T[],
  clusters: RetrievalCluster[],
  limit: number,
  queryEmbedding?: number[],
): ClusterAwareRanking<T> {
  const safeLimit = Math.max(0, Math.min(limit, globallyRanked.length));
  const globalTopIds = globallyRanked
    .slice(0, safeLimit)
    .map((candidate) => candidate.id);
  const scoreByItemId = new Map(
    globallyRanked.map((candidate) => [candidate.id, candidate.similarity]),
  );
  const fallback = (
    clusterScores: ClusterRetrievalScore[],
    assignedCandidateCount: number,
  ): ClusterAwareRanking<T> => ({
    items: globallyRanked.slice(0, safeLimit),
    scoreByItemId,
    clusterScores,
    globalTopIds,
    assignedCandidateCount,
    assignmentCoverage:
      globallyRanked.length === 0
        ? 0
        : assignedCandidateCount / globallyRanked.length,
    usedClusterRanking: false,
    evidenceMode: null,
  });
  if (safeLimit === 0 || clusters.length === 0) {
    return fallback([], 0);
  }

  const candidateById = new Map(
    globallyRanked.map((candidate) => [candidate.id, candidate] as const),
  );
  const clusterIdByItemId = new Map<string, string>();
  const clusterScores: ClusterRetrievalScore[] = [];
  const canUseCentroid =
    Array.isArray(queryEmbedding) && queryEmbedding.length > 0;
  const evidenceMode: ClusterEvidenceMode = canUseCentroid
    ? "query_centroid"
    : "member_similarity";
  // query_centroid 모드에서 후보별 leave-one-out 증거 계산에 쓰는 합 벡터.
  const centroidStateByClusterId = new Map<
    string,
    { sum: Float64Array; count: number }
  >();

  for (const cluster of clusters) {
    const members = cluster.itemIds
      .map((itemId) => candidateById.get(itemId))
      .filter((candidate): candidate is T => Boolean(candidate))
      .sort((a, b) => b.similarity - a.similarity);
    for (const member of members) {
      if (!clusterIdByItemId.has(member.id)) {
        clusterIdByItemId.set(member.id, cluster.id);
      }
    }
    // A singleton cannot provide evidence beyond its own similarity.
    if (members.length < 2) continue;

    if (canUseCentroid) {
      const embedded = members.filter(
        (member) => (member.embedding?.length ?? 0) > 0,
      );
      if (embedded.length < 2) continue;
      const dimension = embedded[0].embedding!.length;
      const sum = new Float64Array(dimension);
      for (const member of embedded) {
        const embedding = member.embedding!;
        for (let i = 0; i < dimension; i += 1) sum[i] += embedding[i];
      }
      centroidStateByClusterId.set(cluster.id, {
        sum,
        count: embedded.length,
      });
      clusterScores.push({
        clusterId: cluster.id,
        score: cosineSimilarity(sum, queryEmbedding!),
        activeMemberCount: members.length,
      });
      continue;
    }

    const evidenceMembers = members.slice(0, CLUSTER_EVIDENCE_MEMBER_LIMIT);
    const score =
      CLUSTER_EVIDENCE_MAX_WEIGHT * evidenceMembers[0].similarity +
      CLUSTER_EVIDENCE_TOP_MEAN_WEIGHT *
        mean(evidenceMembers.map((candidate) => candidate.similarity));
    clusterScores.push({
      clusterId: cluster.id,
      score,
      activeMemberCount: members.length,
    });
  }

  if (clusterScores.length === 0) {
    return fallback([], clusterIdByItemId.size);
  }

  const assignmentCoverage = clusterIdByItemId.size / globallyRanked.length;
  if (assignmentCoverage < MIN_CLUSTER_ASSIGNMENT_COVERAGE) {
    return fallback(clusterScores, clusterIdByItemId.size);
  }

  const scoreByClusterId = new Map(
    clusterScores.map((cluster) => [cluster.clusterId, cluster.score] as const),
  );
  for (const candidate of globallyRanked) {
    const clusterId = clusterIdByItemId.get(candidate.id);
    if (!clusterId) continue;
    let evidence: number | undefined;
    if (canUseCentroid) {
      const state = centroidStateByClusterId.get(clusterId);
      const embedding = candidate.embedding;
      if (!state || !embedding || embedding.length === 0) continue;
      // Leave-one-out: 자기 임베딩을 빼고 남은 멤버들의 centroid와 쿼리를
      // 비교한다. 동료들이 실제로 쿼리와 정렬된 클러스터만 증거가 된다.
      if (state.count < 2) continue;
      const loo = new Float64Array(state.sum.length);
      for (let i = 0; i < loo.length; i += 1) {
        loo[i] = state.sum[i] - (embedding[i] ?? 0);
      }
      evidence = cosineSimilarity(loo, queryEmbedding!);
    } else {
      evidence = scoreByClusterId.get(clusterId);
    }
    if (evidence == null) continue;
    const uplift =
      CLUSTER_UPLIFT_WEIGHT * Math.max(0, evidence - candidate.similarity);
    scoreByItemId.set(candidate.id, candidate.similarity + uplift);
  }

  const globalIndexById = new Map(
    globallyRanked.map((candidate, index) => [candidate.id, index] as const),
  );
  const byHybridScore = (a: T, b: T) => {
    const scoreDelta =
      (scoreByItemId.get(b.id) ?? b.similarity) -
      (scoreByItemId.get(a.id) ?? a.similarity);
    if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
    return (globalIndexById.get(a.id) ?? 0) - (globalIndexById.get(b.id) ?? 0);
  };
  const reranked = [...globallyRanked].sort(byHybridScore);

  const selectedIds = new Set(
    globallyRanked
      .slice(0, Math.min(GLOBAL_SAFEGUARD_COUNT, safeLimit))
      .map((candidate) => candidate.id),
  );
  for (const candidate of reranked) {
    if (selectedIds.size >= safeLimit) break;
    selectedIds.add(candidate.id);
  }

  const items = globallyRanked
    .filter((candidate) => selectedIds.has(candidate.id))
    .sort(byHybridScore);

  return {
    items,
    scoreByItemId,
    clusterScores: clusterScores.sort((a, b) => b.score - a.score),
    globalTopIds,
    assignedCandidateCount: clusterIdByItemId.size,
    assignmentCoverage,
    usedClusterRanking: true,
    evidenceMode,
  };
}
