const CLUSTER_EVIDENCE_MAX_WEIGHT = 0.7;
const CLUSTER_EVIDENCE_TOP_MEAN_WEIGHT = 0.3;
const CLUSTER_UPLIFT_WEIGHT = 0.2;
const GLOBAL_SAFEGUARD_COUNT = 2;
const CLUSTER_EVIDENCE_MEMBER_LIMIT = 3;
const MIN_CLUSTER_ASSIGNMENT_COVERAGE = 0.5;

type RankedMemory = {
  id: string;
  similarity: number;
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

export type ClusterAwareRanking<T extends RankedMemory> = {
  items: T[];
  scoreByItemId: Map<string, number>;
  clusterScores: ClusterRetrievalScore[];
  globalTopIds: string[];
  assignedCandidateCount: number;
  assignmentCoverage: number;
  usedClusterRanking: boolean;
};

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function rankMemoriesWithClusters<T extends RankedMemory>(
  globallyRanked: T[],
  clusters: RetrievalCluster[],
  limit: number,
): ClusterAwareRanking<T> {
  const safeLimit = Math.max(0, Math.min(limit, globallyRanked.length));
  const globalTopIds = globallyRanked
    .slice(0, safeLimit)
    .map((candidate) => candidate.id);
  const scoreByItemId = new Map(
    globallyRanked.map((candidate) => [candidate.id, candidate.similarity]),
  );
  if (safeLimit === 0 || clusters.length === 0) {
    return {
      items: globallyRanked.slice(0, safeLimit),
      scoreByItemId,
      clusterScores: [],
      globalTopIds,
      assignedCandidateCount: 0,
      assignmentCoverage: 0,
      usedClusterRanking: false,
    };
  }

  const candidateById = new Map(
    globallyRanked.map((candidate) => [candidate.id, candidate] as const),
  );
  const clusterIdByItemId = new Map<string, string>();
  const clusterScores: ClusterRetrievalScore[] = [];

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
    return {
      items: globallyRanked.slice(0, safeLimit),
      scoreByItemId,
      clusterScores: [],
      globalTopIds,
      assignedCandidateCount: clusterIdByItemId.size,
      assignmentCoverage: clusterIdByItemId.size / globallyRanked.length,
      usedClusterRanking: false,
    };
  }

  const assignmentCoverage =
    clusterIdByItemId.size / globallyRanked.length;
  if (assignmentCoverage < MIN_CLUSTER_ASSIGNMENT_COVERAGE) {
    return {
      items: globallyRanked.slice(0, safeLimit),
      scoreByItemId,
      clusterScores,
      globalTopIds,
      assignedCandidateCount: clusterIdByItemId.size,
      assignmentCoverage,
      usedClusterRanking: false,
    };
  }

  const scoreByClusterId = new Map(
    clusterScores.map((cluster) => [cluster.clusterId, cluster.score] as const),
  );
  for (const candidate of globallyRanked) {
    const clusterId = clusterIdByItemId.get(candidate.id);
    const clusterScore = clusterId
      ? scoreByClusterId.get(clusterId)
      : undefined;
    if (clusterScore == null) continue;
    const uplift =
      CLUSTER_UPLIFT_WEIGHT *
      Math.max(0, clusterScore - candidate.similarity);
    scoreByItemId.set(candidate.id, candidate.similarity + uplift);
  }

  const globalIndexById = new Map(
    globallyRanked.map((candidate, index) => [candidate.id, index] as const),
  );
  const reranked = [...globallyRanked].sort((a, b) => {
    const scoreDelta =
      (scoreByItemId.get(b.id) ?? b.similarity) -
      (scoreByItemId.get(a.id) ?? a.similarity);
    if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
    return (globalIndexById.get(a.id) ?? 0) - (globalIndexById.get(b.id) ?? 0);
  });

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
    .sort((a, b) => {
      const scoreDelta =
        (scoreByItemId.get(b.id) ?? b.similarity) -
        (scoreByItemId.get(a.id) ?? a.similarity);
      if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
      return (globalIndexById.get(a.id) ?? 0) - (globalIndexById.get(b.id) ?? 0);
    });

  return {
    items,
    scoreByItemId,
    clusterScores: clusterScores.sort((a, b) => b.score - a.score),
    globalTopIds,
    assignedCandidateCount: clusterIdByItemId.size,
    assignmentCoverage,
    usedClusterRanking: true,
  };
}
