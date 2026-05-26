import OpenAI from "openai";
import { createHash } from "crypto";
import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-large";
const LABEL_MODEL = "gpt-5.4-mini";
const MAX_TARGET_CLUSTER_COUNT = 12;
const MAX_GRAPH_CLUSTER_COUNT = 16;
const MAX_ITEMS = 160;
const MAX_KMEANS_ITERATIONS = 40;
const MAX_GRANULARITY_PAIRS = 24;
const GRAPH_MIN_SIMILARITY = 0.58;
const GRAPH_STRONG_SIMILARITY = 0.74;
const GRAPH_KNN_EDGES = 3;
const GRAPH_COMMUNITY_ITERATIONS = 30;
const CLUSTER_COLLECTION = "memoryClusters";
const CLUSTERING_METHOD_VERSION = "llm-granularity-v1";
const DEFAULT_MEMORY_VERSION = "0.1.1";

type ClusterInputItem = {
  id: string;
  semantic: string;
  episode?: string;
  input?: string;
  action?: string;
  timestamp?: number;
  keywords?: string[];
};

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

type ClusterDiagnostics = {
  duplicateItemIds: string[];
  recoveredUnassignedItemIds: string[];
  unassignedItemIds: string[];
  method: "embedding-kmeans-elbow-llm-granularity";
  embeddingModel: string;
  labelModel: string;
  requestedClusterCount: number;
  actualClusterCount: number;
  elbow?: ElbowDiagnostics;
  granularity?: GranularityDiagnostics;
};

type GraphCommunityDiagnostics = {
  duplicateItemIds: string[];
  recoveredUnassignedItemIds: string[];
  unassignedItemIds: string[];
  method: "embedding-similarity-graph-label-propagation-llm-labeling";
  embeddingModel: string;
  labelModel: string;
  requestedClusterCount: null;
  actualClusterCount: number;
  graph: {
    minSimilarity: number;
    strongSimilarity: number;
    knnEdges: number;
    nodeCount: number;
    edgeCount: number;
    averageDegree: number;
    singletonCount: number;
    rawCommunityCount: number;
    cappedCommunityCount: number;
  };
};

type ElbowPoint = {
  k: number;
  inertia: number;
  improvement: number | null;
};

type ElbowDiagnostics = {
  minK: number;
  maxK: number;
  selectedK: number;
  points: ElbowPoint[];
};

type ClusterRun = ElbowPoint & {
  assignments: number[];
};

type GranularityPair = {
  id: string;
  itemAId: string;
  itemBId: string;
  itemA: string;
  itemB: string;
};

type GranularityPrediction = {
  pairId: string;
  sameCategory: boolean;
};

type GranularityScore = {
  k: number;
  matches: number;
  total: number;
  agreement: number;
};

type GranularityDiagnostics = {
  model: string;
  selectedK: number;
  fallbackK: number;
  pairCount: number;
  scores: GranularityScore[];
};

type StoredClusterDocument = {
  clusters?: unknown;
  graphClusters?: unknown;
  diagnostics?: unknown;
  graphDiagnostics?: unknown;
  itemSignature?: unknown;
  sourceItemCount?: unknown;
  memoryVersion?: unknown;
  generatedAt?: unknown;
  generatedBy?: unknown;
};

type ClusterLabel = {
  id: string;
  label: string;
  summary: string;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function clusterCacheId(memoryVersion: string, itemSignature: string) {
  const versionKey = memoryVersion.replace(/[^a-zA-Z0-9_-]/g, "_");
  const signatureHash = createHash("sha256")
    .update(`${CLUSTERING_METHOD_VERSION}:${itemSignature}`)
    .digest("hex")
    .slice(0, 24);
  return `${versionKey}-${signatureHash}`;
}

function clusterDocumentPath(
  uid: string,
  memoryVersion: string,
  itemSignature: string,
) {
  return `users/${uid}/${CLUSTER_COLLECTION}/${clusterCacheId(
    memoryVersion,
    itemSignature,
  )}`;
}

function isMemoryCluster(value: unknown): value is MemoryCluster {
  const cluster = value as Partial<MemoryCluster>;
  return (
    Boolean(cluster) &&
    typeof cluster.id === "string" &&
    typeof cluster.label === "string" &&
    typeof cluster.summary === "string" &&
    typeof cluster.count === "number" &&
    Array.isArray(cluster.relatedActions) &&
    Array.isArray(cluster.itemIds) &&
    Array.isArray(cluster.representativeItems)
  );
}

function parseStoredClusters(value: unknown) {
  return Array.isArray(value) ? value.filter(isMemoryCluster) : [];
}

function parseStoredDiagnostics(value: unknown): ClusterDiagnostics | null {
  const diagnostics = value as Partial<ClusterDiagnostics>;
  if (
    !diagnostics ||
    !Array.isArray(diagnostics.duplicateItemIds) ||
    !Array.isArray(diagnostics.recoveredUnassignedItemIds) ||
    !Array.isArray(diagnostics.unassignedItemIds)
  ) {
    return null;
  }
  return {
    duplicateItemIds: diagnostics.duplicateItemIds.map(String),
    recoveredUnassignedItemIds:
      diagnostics.recoveredUnassignedItemIds.map(String),
    unassignedItemIds: diagnostics.unassignedItemIds.map(String),
    method: "embedding-kmeans-elbow-llm-granularity",
    embeddingModel: String(diagnostics.embeddingModel ?? EMBEDDING_MODEL),
    labelModel: String(diagnostics.labelModel ?? LABEL_MODEL),
    requestedClusterCount: Number(diagnostics.requestedClusterCount ?? 0),
    actualClusterCount: Number(diagnostics.actualClusterCount ?? 0),
    elbow: parseElbowDiagnostics(diagnostics.elbow),
    granularity: parseGranularityDiagnostics(diagnostics.granularity),
  };
}

function parseElbowDiagnostics(value: unknown): ElbowDiagnostics | undefined {
  const elbow = value as Partial<ElbowDiagnostics>;
  if (
    !elbow ||
    typeof elbow.minK !== "number" ||
    typeof elbow.maxK !== "number" ||
    typeof elbow.selectedK !== "number" ||
    !Array.isArray(elbow.points)
  ) {
    return undefined;
  }
  return {
    minK: elbow.minK,
    maxK: elbow.maxK,
    selectedK: elbow.selectedK,
    points: elbow.points
      .map((point) => {
        const candidate = point as Partial<ElbowPoint>;
        return {
          k: Number(candidate.k),
          inertia: Number(candidate.inertia),
          improvement:
            typeof candidate.improvement === "number"
              ? candidate.improvement
              : null,
        };
      })
      .filter(
        (point) => Number.isFinite(point.k) && Number.isFinite(point.inertia),
      ),
  };
}

function parseGranularityDiagnostics(
  value: unknown,
): GranularityDiagnostics | undefined {
  const granularity = value as Partial<GranularityDiagnostics>;
  if (
    !granularity ||
    typeof granularity.selectedK !== "number" ||
    !Array.isArray(granularity.scores)
  ) {
    return undefined;
  }
  return {
    model: String(granularity.model ?? LABEL_MODEL),
    selectedK: granularity.selectedK,
    fallbackK: Number(granularity.fallbackK ?? granularity.selectedK),
    pairCount: Number(granularity.pairCount ?? 0),
    scores: granularity.scores
      .map((score) => ({
        k: Number(score.k),
        matches: Number(score.matches),
        total: Number(score.total),
        agreement: Number(score.agreement),
      }))
      .filter(
        (score) =>
          Number.isFinite(score.k) &&
          Number.isFinite(score.total) &&
          Number.isFinite(score.agreement),
      ),
  };
}

function parseGraphCommunityDiagnostics(
  value: unknown,
): GraphCommunityDiagnostics | null {
  const diagnostics = value as Partial<GraphCommunityDiagnostics>;
  const graph = diagnostics?.graph as
    | Partial<GraphCommunityDiagnostics["graph"]>
    | undefined;
  if (
    !diagnostics ||
    !Array.isArray(diagnostics.duplicateItemIds) ||
    !Array.isArray(diagnostics.recoveredUnassignedItemIds) ||
    !Array.isArray(diagnostics.unassignedItemIds) ||
    !graph
  ) {
    return null;
  }

  return {
    duplicateItemIds: diagnostics.duplicateItemIds.map(String),
    recoveredUnassignedItemIds:
      diagnostics.recoveredUnassignedItemIds.map(String),
    unassignedItemIds: diagnostics.unassignedItemIds.map(String),
    method: "embedding-similarity-graph-label-propagation-llm-labeling",
    embeddingModel: String(diagnostics.embeddingModel ?? EMBEDDING_MODEL),
    labelModel: String(diagnostics.labelModel ?? LABEL_MODEL),
    requestedClusterCount: null,
    actualClusterCount: Number(diagnostics.actualClusterCount ?? 0),
    graph: {
      minSimilarity: Number(graph.minSimilarity ?? GRAPH_MIN_SIMILARITY),
      strongSimilarity: Number(
        graph.strongSimilarity ?? GRAPH_STRONG_SIMILARITY,
      ),
      knnEdges: Number(graph.knnEdges ?? GRAPH_KNN_EDGES),
      nodeCount: Number(graph.nodeCount ?? 0),
      edgeCount: Number(graph.edgeCount ?? 0),
      averageDegree: Number(graph.averageDegree ?? 0),
      singletonCount: Number(graph.singletonCount ?? 0),
      rawCommunityCount: Number(graph.rawCommunityCount ?? 0),
      cappedCommunityCount: Number(graph.cappedCommunityCount ?? 0),
    },
  };
}

function embeddingText(item: ClusterInputItem) {
  return [
    `Semantic: ${item.semantic}`,
    item.episode ? `Episode: ${item.episode}` : "",
    item.input ? `Input: ${item.input}` : "",
    item.action ? `Action: ${item.action}` : "",
    item.keywords?.length ? `Keywords: ${item.keywords.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function meanVector(vectors: number[][], dimension: number) {
  const mean = Array.from({ length: dimension }, () => 0);
  vectors.forEach((vector) => {
    for (let i = 0; i < dimension; i += 1) mean[i] += vector[i];
  });
  return l2Normalize(mean.map((value) => value / Math.max(vectors.length, 1)));
}

function chooseInitialCentroids(vectors: number[][], k: number) {
  const centroids: number[][] = [vectors[0]];
  const chosen = new Set([0]);

  while (centroids.length < k) {
    let bestIndex = -1;
    let bestDistance = -Infinity;
    vectors.forEach((vector, index) => {
      if (chosen.has(index)) return;
      const nearestSimilarity = Math.max(
        ...centroids.map((centroid) => cosineSimilarity(vector, centroid)),
      );
      const distance = 1 - nearestSimilarity;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    chosen.add(bestIndex);
    centroids.push(vectors[bestIndex]);
  }

  return centroids;
}

function assignVectors(vectors: number[][], centroids: number[][]) {
  return vectors.map((vector) => {
    let bestIndex = 0;
    let bestSimilarity = -Infinity;
    centroids.forEach((centroid, index) => {
      const similarity = cosineSimilarity(vector, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    });
    return bestIndex;
  });
}

function centroidsForAssignments(
  vectors: number[][],
  assignments: number[],
  k: number,
) {
  const dimension = vectors[0]?.length ?? 0;
  return Array.from({ length: k }, (_, clusterIndex) => {
    const clusterVectors = vectors.filter(
      (_vector, index) => assignments[index] === clusterIndex,
    );
    return clusterVectors.length > 0
      ? meanVector(clusterVectors, dimension)
      : vectors[0] ?? [];
  });
}

function clusteringInertia(
  vectors: number[][],
  assignments: number[],
  k: number,
) {
  if (vectors.length === 0) return 0;
  const centroids = centroidsForAssignments(vectors, assignments, k);
  return vectors.reduce((sum, vector, index) => {
    const centroid = centroids[assignments[index]] ?? centroids[0];
    const distance = 1 - cosineSimilarity(vector, centroid);
    return sum + distance * distance;
  }, 0);
}

function fillEmptyClusters(
  assignments: number[],
  vectors: number[][],
  centroids: number[][],
) {
  const counts = Array.from({ length: centroids.length }, (_, clusterIndex) =>
    assignments.filter((assignment) => assignment === clusterIndex).length,
  );

  counts.forEach((count, emptyClusterIndex) => {
    if (count > 0) return;
    const donor = assignments
      .map((clusterIndex, itemIndex) => {
        const ownCount = counts[clusterIndex] ?? 0;
        if (ownCount <= 1) return null;
        return {
          itemIndex,
          clusterIndex,
          distance:
            1 - cosineSimilarity(vectors[itemIndex], centroids[clusterIndex]),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.distance - a.distance)[0];

    if (!donor) return;
    assignments[donor.itemIndex] = emptyClusterIndex;
    counts[donor.clusterIndex] -= 1;
    counts[emptyClusterIndex] = 1;
  });
}

function kMeans(vectors: number[][], k: number) {
  if (vectors.length === 0) return [];
  const dimension = vectors[0].length;
  let centroids = chooseInitialCentroids(vectors, k);
  let assignments = assignVectors(vectors, centroids);

  for (let iteration = 0; iteration < MAX_KMEANS_ITERATIONS; iteration += 1) {
    fillEmptyClusters(assignments, vectors, centroids);
    const nextCentroids = centroids.map((_, clusterIndex) => {
      const clusterVectors = vectors.filter(
        (_vector, index) => assignments[index] === clusterIndex,
      );
      return clusterVectors.length > 0
        ? meanVector(clusterVectors, dimension)
        : centroids[clusterIndex];
    });
    const nextAssignments = assignVectors(vectors, nextCentroids);
    const changed = nextAssignments.some(
      (assignment, index) => assignment !== assignments[index],
    );
    centroids = nextCentroids;
    assignments = nextAssignments;
    if (!changed) break;
  }

  return assignments;
}

function elbowDistance(point: ElbowPoint, first: ElbowPoint, last: ElbowPoint) {
  const dx = last.k - first.k;
  const dy = last.inertia - first.inertia;
  const denominator = Math.sqrt(dx * dx + dy * dy);
  if (!denominator) return 0;
  return Math.abs(
    dy * point.k -
      dx * point.inertia +
      last.k * first.inertia -
      last.inertia * first.k,
  ) / denominator;
}

function selectKByElbow(vectors: number[][]) {
  const minK = 1;
  const maxK = Math.min(MAX_TARGET_CLUSTER_COUNT, vectors.length);
  const runs: ClusterRun[] = [];
  let previousInertia: number | null = null;

  for (let k = minK; k <= maxK; k += 1) {
    const assignments = kMeans(vectors, k);
    const inertia = clusteringInertia(vectors, assignments, k);
    runs.push({
      k,
      inertia: Number(inertia.toFixed(6)),
      improvement:
        previousInertia === null
          ? null
          : Number((previousInertia - inertia).toFixed(6)),
      assignments,
    });
    previousInertia = inertia;
  }

  const selectedK =
    runs.length <= 2
      ? runs.at(-1)?.k ?? 1
      : runs
          .slice(1, -1)
          .map((point) => ({
            k: point.k,
            distance: elbowDistance(
              point,
              runs[0],
              runs[runs.length - 1],
            ),
          }))
          .sort((a, b) => b.distance - a.distance)[0]?.k ?? 1;

  return {
    minK,
    maxK,
    selectedK,
    points: runs.map((run) => ({
      k: run.k,
      inertia: run.inertia,
      improvement: run.improvement,
    })),
    runs,
  };
}

function sameCluster(assignments: number[], indexA: number, indexB: number) {
  return assignments[indexA] === assignments[indexB];
}

function pairKey(indexA: number, indexB: number) {
  return indexA < indexB ? `${indexA}:${indexB}` : `${indexB}:${indexA}`;
}

function addPair(
  pairs: Map<string, [number, number]>,
  indexA: number,
  indexB: number,
) {
  if (indexA === indexB || pairs.size >= MAX_GRANULARITY_PAIRS) return;
  pairs.set(pairKey(indexA, indexB), [
    Math.min(indexA, indexB),
    Math.max(indexA, indexB),
  ]);
}

function nearestPairs(vectors: number[][], limit: number) {
  const pairs: { indexA: number; indexB: number; similarity: number }[] = [];
  for (let indexA = 0; indexA < vectors.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < vectors.length; indexB += 1) {
      pairs.push({
        indexA,
        indexB,
        similarity: cosineSimilarity(vectors[indexA], vectors[indexB]),
      });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

function farthestPairs(vectors: number[][], limit: number) {
  return nearestPairs(vectors, vectors.length * vectors.length)
    .reverse()
    .slice(0, limit);
}

function sampleGranularityPairs(
  items: ClusterInputItem[],
  vectors: number[][],
  runs: ClusterRun[],
) {
  const pairs = new Map<string, [number, number]>();
  const lowRun = runs[0];
  const highRun = runs[runs.length - 1];

  nearestPairs(vectors, Math.ceil(MAX_GRANULARITY_PAIRS / 3)).forEach(
    ({ indexA, indexB }) => addPair(pairs, indexA, indexB),
  );
  farthestPairs(vectors, Math.ceil(MAX_GRANULARITY_PAIRS / 4)).forEach(
    ({ indexA, indexB }) => addPair(pairs, indexA, indexB),
  );

  if (lowRun && highRun) {
    for (let indexA = 0; indexA < items.length; indexA += 1) {
      for (let indexB = indexA + 1; indexB < items.length; indexB += 1) {
        if (
          sameCluster(lowRun.assignments, indexA, indexB) &&
          !sameCluster(highRun.assignments, indexA, indexB)
        ) {
          addPair(pairs, indexA, indexB);
        }
        if (pairs.size >= MAX_GRANULARITY_PAIRS) break;
      }
      if (pairs.size >= MAX_GRANULARITY_PAIRS) break;
    }
  }

  return Array.from(pairs.values()).map(([indexA, indexB], index) => ({
    id: `pair-${String(index + 1).padStart(2, "0")}`,
    itemAId: items[indexA].id,
    itemBId: items[indexB].id,
    itemA: items[indexA].semantic,
    itemB: items[indexB].semantic,
  }));
}

function parseGranularityPredictions(
  raw: string,
): Map<string, GranularityPrediction> {
  try {
    const parsed = JSON.parse(raw) as {
      pairs?: Partial<GranularityPrediction>[];
    };
    return new Map(
      (parsed.pairs ?? [])
        .map((pair) => ({
          pairId: String(pair.pairId ?? "").trim(),
          sameCategory: pair.sameCategory,
        }))
        .filter(
          (pair): pair is GranularityPrediction =>
            Boolean(pair.pairId) && typeof pair.sameCategory === "boolean",
        )
        .map((pair) => [pair.pairId, pair] as const),
    );
  } catch {
    return new Map<string, GranularityPrediction>();
  }
}

async function askLlmForGranularityPairs(pairs: GranularityPair[]) {
  if (pairs.length === 0) return new Map<string, GranularityPrediction>();

  const completion = await openai.chat.completions.create({
    model: LABEL_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You judge clustering granularity for semantic memories from a design-agent research system.

For each pair, decide whether the two memory items should belong to the same category at a useful research-analysis granularity.

Answer "sameCategory": true only when a researcher would reasonably group them together under one pattern. Ignore surface wording if the underlying user need, behavior, or design-work pattern differs.

Return valid JSON only:
{
  "pairs": [
    { "pairId": "pair id", "sameCategory": true }
  ]
}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          pairs: pairs.map((pair) => ({
            pairId: pair.id,
            itemA: pair.itemA,
            itemB: pair.itemB,
          })),
        }),
      },
    ],
  });

  return parseGranularityPredictions(
    completion.choices[0]?.message?.content ?? "{}",
  );
}

function scoreGranularityRuns(
  pairs: GranularityPair[],
  predictions: Map<string, GranularityPrediction>,
  items: ClusterInputItem[],
  runs: ClusterRun[],
) {
  const itemIndexById = new Map(items.map((item, index) => [item.id, index]));
  return runs.map((run) => {
    let matches = 0;
    let total = 0;
    pairs.forEach((pair) => {
      const prediction = predictions.get(pair.id);
      const indexA = itemIndexById.get(pair.itemAId);
      const indexB = itemIndexById.get(pair.itemBId);
      if (!prediction || indexA === undefined || indexB === undefined) return;
      total += 1;
      if (
        sameCluster(run.assignments, indexA, indexB) ===
        prediction.sameCategory
      ) {
        matches += 1;
      }
    });
    return {
      k: run.k,
      matches,
      total,
      agreement: total > 0 ? Number((matches / total).toFixed(4)) : 0,
    };
  });
}

async function selectKByLlmGranularity(
  items: ClusterInputItem[],
  vectors: number[][],
  runs: ClusterRun[],
  fallbackK: number,
) {
  const pairs = sampleGranularityPairs(items, vectors, runs);
  const predictions = await askLlmForGranularityPairs(pairs);
  const scores = scoreGranularityRuns(pairs, predictions, items, runs);
  const best = scores
    .filter((score) => score.total > 0)
    .sort(
      (a, b) =>
        b.agreement - a.agreement ||
        Math.abs(a.k - fallbackK) - Math.abs(b.k - fallbackK) ||
        a.k - b.k,
    )[0];

  return {
    model: LABEL_MODEL,
    selectedK: best?.k ?? fallbackK,
    fallbackK,
    pairCount: predictions.size,
    scores,
  };
}

function relatedActions(clusterItems: ClusterInputItem[]) {
  return Array.from(
    new Set(
      clusterItems
        .map((item) => item.action)
        .filter((action): action is string => Boolean(action)),
    ),
  );
}

function representativeItems(
  clusterItems: ClusterInputItem[],
  clusterVectors: number[][],
) {
  if (clusterItems.length <= 3) {
    return clusterItems.map((item) => item.semantic);
  }
  const centroid = meanVector(clusterVectors, clusterVectors[0].length);
  return clusterItems
    .map((item, index) => ({
      item,
      similarity: cosineSimilarity(clusterVectors[index], centroid),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map(({ item }) => item.semantic);
}

function clusterId(index: number) {
  return `cluster-${String(index + 1).padStart(2, "0")}`;
}

function fallbackLabel(cluster: MemoryCluster) {
  const action = cluster.relatedActions[0];
  if (action?.includes("reference")) return "Reference Work";
  if (action?.includes("mockup")) return "Mockup Iteration";
  if (action?.includes("note")) return "Landing Page Planning";
  if (action?.includes("presentation")) return "Presentation Work";
  return "Memory Pattern";
}

function parseClusterLabels(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { clusters?: Partial<ClusterLabel>[] };
    return new Map(
      (parsed.clusters ?? [])
        .map((cluster) => ({
          id: String(cluster.id ?? "").trim(),
          label: String(cluster.label ?? "").trim(),
          summary: String(cluster.summary ?? "").trim(),
        }))
        .filter((cluster) => cluster.id && cluster.label)
        .map((cluster) => [cluster.id, cluster] as const),
    );
  } catch {
    return new Map<string, ClusterLabel>();
  }
}

async function labelClusters(
  clusters: MemoryCluster[],
  itemsById: Map<string, ClusterInputItem>,
) {
  if (clusters.length === 0) return clusters;

  const completion = await openai.chat.completions.create({
    model: LABEL_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Name semantic-memory clusters for a design-agent research admin view.

The cluster membership is already fixed by an embedding-based clustering method. Do not move, add, remove, or duplicate item ids.

Return valid JSON only:
{
  "clusters": [
    {
      "id": "cluster id",
      "label": "2-5 word English label",
      "summary": "One concise English sentence explaining the shared pattern."
    }
  ]
}

Use natural researcher-friendly labels. Avoid awkward noun stacks and avoid inventing facts beyond the provided semantic, episode, input, action, and keywords.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          clusters: clusters.map((cluster) => ({
            id: cluster.id,
            relatedActions: cluster.relatedActions,
            count: cluster.count,
            representativeItems: cluster.representativeItems,
            items: cluster.itemIds.slice(0, 8).map((id) => {
              const item = itemsById.get(id);
              return {
                id,
                semantic: item?.semantic ?? "",
                episode: item?.episode ?? "",
                input: item?.input ?? "",
                action: item?.action ?? "",
                keywords: item?.keywords ?? [],
              };
            }),
          })),
        }),
      },
    ],
  });

  const labels = parseClusterLabels(
    completion.choices[0]?.message?.content ?? "{}",
  );

  return clusters.map((cluster) => {
    const label = labels.get(cluster.id);
    return {
      ...cluster,
      label: label?.label || fallbackLabel(cluster),
      summary:
        label?.summary ||
        `This cluster contains ${cluster.count} semantically similar memory items.`,
    };
  });
}

async function embedItems(items: ClusterInputItem[]) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: items.map(embeddingText),
  });
  return response.data.map((item) => l2Normalize(item.embedding));
}

function buildClusters(
  items: ClusterInputItem[],
  vectors: number[][],
  assignments: number[],
) {
  const byCluster = new Map<number, number[]>();
  assignments.forEach((clusterIndex, itemIndex) => {
    const current = byCluster.get(clusterIndex) ?? [];
    current.push(itemIndex);
    byCluster.set(clusterIndex, current);
  });

  return Array.from(byCluster.values())
    .sort((a, b) => b.length - a.length)
    .map((itemIndexes, index) => {
      const clusterItems = itemIndexes.map((itemIndex) => items[itemIndex]);
      const clusterVectors = itemIndexes.map((itemIndex) => vectors[itemIndex]);
      return {
        id: clusterId(index),
        label: "Memory Pattern",
        summary: "",
        count: clusterItems.length,
        relatedActions: relatedActions(clusterItems),
        itemIds: clusterItems.map((item) => item.id),
        representativeItems: representativeItems(clusterItems, clusterVectors),
      };
    });
}

type SimilarityEdge = {
  source: number;
  target: number;
  weight: number;
};

function similarityEdges(vectors: number[][]) {
  const pairEdges: SimilarityEdge[] = [];
  const edgesByKey = new Map<string, SimilarityEdge>();
  const neighborCandidates = vectors.map(() => [] as SimilarityEdge[]);

  for (let source = 0; source < vectors.length; source += 1) {
    for (let target = source + 1; target < vectors.length; target += 1) {
      const weight = cosineSimilarity(vectors[source], vectors[target]);
      const edge = { source, target, weight };
      pairEdges.push(edge);
      neighborCandidates[source].push(edge);
      neighborCandidates[target].push(edge);
    }
  }

  const addEdge = (edge: SimilarityEdge) => {
    const key = `${edge.source}:${edge.target}`;
    const existing = edgesByKey.get(key);
    if (!existing || edge.weight > existing.weight) {
      edgesByKey.set(key, edge);
    }
  };

  pairEdges
    .filter((edge) => edge.weight >= GRAPH_STRONG_SIMILARITY)
    .forEach(addEdge);

  neighborCandidates.forEach((edges) => {
    edges
      .filter((edge) => edge.weight >= GRAPH_MIN_SIMILARITY)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, GRAPH_KNN_EDGES)
      .forEach(addEdge);
  });

  return Array.from(edgesByKey.values()).sort((a, b) => b.weight - a.weight);
}

function labelPropagationCommunities(nodeCount: number, edges: SimilarityEdge[]) {
  const labels = Array.from({ length: nodeCount }, (_, index) => index);
  const adjacency = Array.from({ length: nodeCount }, () => [] as {
    neighbor: number;
    weight: number;
  }[]);

  edges.forEach((edge) => {
    adjacency[edge.source].push({ neighbor: edge.target, weight: edge.weight });
    adjacency[edge.target].push({ neighbor: edge.source, weight: edge.weight });
  });

  for (
    let iteration = 0;
    iteration < GRAPH_COMMUNITY_ITERATIONS;
    iteration += 1
  ) {
    let changed = false;
    const order = Array.from({ length: nodeCount }, (_, index) => index).sort(
      (a, b) => adjacency[b].length - adjacency[a].length || a - b,
    );

    order.forEach((nodeIndex) => {
      if (adjacency[nodeIndex].length === 0) return;
      const scores = new Map<number, number>();
      adjacency[nodeIndex].forEach(({ neighbor, weight }) => {
        const label = labels[neighbor];
        scores.set(label, (scores.get(label) ?? 0) + weight);
      });

      const currentLabel = labels[nodeIndex];
      const best = Array.from(scores.entries()).sort(
        ([labelA, scoreA], [labelB, scoreB]) =>
          scoreB - scoreA ||
          (labelA === currentLabel ? -1 : labelB === currentLabel ? 1 : 0) ||
          labelA - labelB,
      )[0];
      if (best && best[0] !== currentLabel) {
        labels[nodeIndex] = best[0];
        changed = true;
      }
    });

    if (!changed) break;
  }

  return labels;
}

function communityCentroid(
  group: number[],
  vectors: number[][],
  dimension: number,
) {
  return meanVector(
    group.map((itemIndex) => vectors[itemIndex]),
    dimension,
  );
}

function mergeCommunities(
  groups: number[][],
  vectors: number[][],
  maxCount: number,
) {
  const dimension = vectors[0]?.length ?? 0;
  const merged = groups.map((group) => [...group]);

  while (merged.length > maxCount) {
    let bestA = 0;
    let bestB = 1;
    let bestSimilarity = -Infinity;

    const centroids = merged.map((group) =>
      communityCentroid(group, vectors, dimension),
    );

    for (let a = 0; a < merged.length; a += 1) {
      for (let b = a + 1; b < merged.length; b += 1) {
        const similarity = cosineSimilarity(centroids[a], centroids[b]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestA = a;
          bestB = b;
        }
      }
    }

    merged[bestA] = [...merged[bestA], ...merged[bestB]];
    merged.splice(bestB, 1);
  }

  return merged;
}

function buildGraphCommunityClusters(
  items: ClusterInputItem[],
  vectors: number[][],
) {
  const edges = similarityEdges(vectors);
  const labels = labelPropagationCommunities(items.length, edges);
  const byLabel = new Map<number, number[]>();

  labels.forEach((label, itemIndex) => {
    const current = byLabel.get(label) ?? [];
    current.push(itemIndex);
    byLabel.set(label, current);
  });

  const rawGroups = Array.from(byLabel.values()).sort(
    (a, b) => b.length - a.length,
  );
  const groups = mergeCommunities(rawGroups, vectors, MAX_GRAPH_CLUSTER_COUNT);
  const edgeNodeIds = new Set<number>();
  edges.forEach((edge) => {
    edgeNodeIds.add(edge.source);
    edgeNodeIds.add(edge.target);
  });
  const singletonCount = rawGroups.filter((group) => group.length === 1).length;

  return {
    clusters: groups
      .sort((a, b) => b.length - a.length)
      .map((itemIndexes, index) => {
        const clusterItems = itemIndexes.map((itemIndex) => items[itemIndex]);
        const clusterVectors = itemIndexes.map((itemIndex) => vectors[itemIndex]);
        return {
          id: `graph-${clusterId(index)}`,
          label: "Memory Pattern",
          summary: "",
          count: clusterItems.length,
          relatedActions: relatedActions(clusterItems),
          itemIds: clusterItems.map((item) => item.id),
          representativeItems: representativeItems(clusterItems, clusterVectors),
        };
      }),
    diagnostics: {
      duplicateItemIds: [],
      recoveredUnassignedItemIds: [],
      unassignedItemIds: [],
      method: "embedding-similarity-graph-label-propagation-llm-labeling",
      embeddingModel: EMBEDDING_MODEL,
      labelModel: LABEL_MODEL,
      requestedClusterCount: null,
      actualClusterCount: groups.length,
      graph: {
        minSimilarity: GRAPH_MIN_SIMILARITY,
        strongSimilarity: GRAPH_STRONG_SIMILARITY,
        knnEdges: GRAPH_KNN_EDGES,
        nodeCount: items.length,
        edgeCount: edges.length,
        averageDegree: Number(
          ((edges.length * 2) / Math.max(items.length, 1)).toFixed(3),
        ),
        singletonCount,
        rawCommunityCount: rawGroups.length,
        cappedCommunityCount: groups.length,
      },
    } satisfies GraphCommunityDiagnostics,
  };
}

function diagnostics(
  clusters: MemoryCluster[],
  itemCount: number,
  elbow?: ElbowDiagnostics,
  granularity?: GranularityDiagnostics,
): ClusterDiagnostics {
  return {
    duplicateItemIds: [],
    recoveredUnassignedItemIds: [],
    unassignedItemIds: [],
    method: "embedding-kmeans-elbow-llm-granularity",
    embeddingModel: EMBEDDING_MODEL,
    labelModel: LABEL_MODEL,
    requestedClusterCount:
      granularity?.selectedK ??
      elbow?.selectedK ??
      Math.min(MAX_TARGET_CLUSTER_COUNT, itemCount),
    actualClusterCount: clusters.length,
    elbow,
    granularity,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const url = new URL(request.url);
  const itemSignature = url.searchParams.get("signature") ?? "";
  const memoryVersion =
    url.searchParams.get("version") ?? DEFAULT_MEMORY_VERSION;

  if (!itemSignature) {
    return Response.json({ clusters: [], cacheHit: false });
  }

  const token = await getFirebaseAccessToken();
  const stored = (await getFirestoreDocument(
    clusterDocumentPath(uid, memoryVersion, itemSignature),
    token,
  )) as StoredClusterDocument | null;

  if (!stored || stored.itemSignature !== itemSignature) {
    return Response.json({ clusters: [], cacheHit: false });
  }

  return Response.json({
    clusters: parseStoredClusters(stored.clusters),
    graphClusters: parseStoredClusters(stored.graphClusters),
    diagnostics: parseStoredDiagnostics(stored.diagnostics),
    graphDiagnostics: parseGraphCommunityDiagnostics(stored.graphDiagnostics),
    sourceItemCount: Number(stored.sourceItemCount ?? 0),
    generatedAt: stored.generatedAt ?? null,
    generatedBy: stored.generatedBy ?? null,
    cacheHit: true,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { uid } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    items?: ClusterInputItem[];
    itemSignature?: unknown;
    memoryVersion?: unknown;
  };
  const itemSignature = String(body.itemSignature ?? "").trim();
  const memoryVersion = String(
    body.memoryVersion ?? DEFAULT_MEMORY_VERSION,
  ).trim();
  const items = (body.items ?? [])
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      semantic: String(item.semantic ?? "").trim(),
      episode: String(item.episode ?? "").trim().slice(0, 700),
      input: String(item.input ?? "").trim().slice(0, 500),
      action: String(item.action ?? "").trim(),
      timestamp: Number(item.timestamp ?? 0),
      keywords: stringArray(item.keywords).slice(0, 8),
    }))
    .filter((item) => item.id && item.semantic)
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return Response.json({
      clusters: [],
      graphClusters: [],
      diagnostics: diagnostics([], 0),
      graphDiagnostics: parseGraphCommunityDiagnostics({
        duplicateItemIds: [],
        recoveredUnassignedItemIds: [],
        unassignedItemIds: [],
        graph: {
          nodeCount: 0,
          edgeCount: 0,
          averageDegree: 0,
          singletonCount: 0,
          rawCommunityCount: 0,
          cappedCommunityCount: 0,
        },
      }),
    });
  }

  const vectors = await embedItems(items);
  const { runs, ...elbow } = selectKByElbow(vectors);
  const granularity = await selectKByLlmGranularity(
    items,
    vectors,
    runs,
    elbow.selectedK,
  );
  const assignments =
    runs.find((run) => run.k === granularity.selectedK)?.assignments ??
    runs.find((run) => run.k === elbow.selectedK)?.assignments ??
    [];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const clusters = await labelClusters(
    buildClusters(items, vectors, assignments),
    itemsById,
  );
  const graphCommunity = buildGraphCommunityClusters(items, vectors);
  const graphClusters = await labelClusters(graphCommunity.clusters, itemsById);
  const clusterDiagnostics = diagnostics(
    clusters,
    items.length,
    elbow,
    granularity,
  );
  const graphDiagnostics = {
    ...graphCommunity.diagnostics,
    actualClusterCount: graphClusters.length,
  };

  if (itemSignature) {
    const token = await getFirebaseAccessToken();
    await patchFirestoreDocument(
      clusterDocumentPath(uid, memoryVersion, itemSignature),
      {
        itemSignature,
        memoryVersion,
        sourceItemCount: items.length,
        clusters,
        graphClusters,
        diagnostics: clusterDiagnostics,
        graphDiagnostics,
        generatedAt: new Date(),
        generatedBy: admin.email ?? admin.localId,
      },
      token,
    );
  }

  return Response.json({
    clusters,
    graphClusters,
    diagnostics: clusterDiagnostics,
    graphDiagnostics,
  });
}
