import OpenAI from "openai";
import { createHash } from "crypto";
import { memoryClusterLabelPrompt } from "@/lib/prompts";
import {
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
} from "@/lib/server/firebaseAdminRest";
import {
  embedMemoryInputs,
  ensureFreshMemoryEmbeddings,
  MEMORY_EMBEDDING_MODEL,
} from "@/lib/server/memoryEmbedding";
import { loadUserMemoryItems } from "@/lib/server/memoryItems";

export const EMBEDDING_MODEL = MEMORY_EMBEDDING_MODEL;
export const LABEL_MODEL = "gpt-5.4-mini";
export const MAX_GRAPH_CLUSTER_COUNT = 16;
export const MAX_ITEMS = 160;
export const GRAPH_MIN_SIMILARITY = 0.58;
export const GRAPH_STRONG_SIMILARITY = 0.74;
export const GRAPH_KNN_EDGES = 3;
export const GRAPH_COMMUNITY_ITERATIONS = 30;
export const CLUSTER_COLLECTION = "memoryClusters";
export const CLUSTER_SNAPSHOT_COLLECTION = "memoryClusterSnapshots";
export const CLUSTERING_METHOD_VERSION =
  "similarity-graph-v5-centered-embedding";
export const MEMORY_VERSION = "0.1.2";
export const ONBOARDING_MISSION_ID = "onboarding";

// Fixed clustering vector source: the stored memory embedding contract.
export const CLUSTERING_INPUT_VARIANTS = [
  "keyword-episodic-semantic-link",
] as const;
export type ClusteringInputVariant = (typeof CLUSTERING_INPUT_VARIANTS)[number];
export const CLUSTERING_INPUT_VARIANT: ClusteringInputVariant =
  "keyword-episodic-semantic-link";

export function normalizeClusteringInputVariant(
  value: unknown,
): ClusteringInputVariant {
  return CLUSTERING_INPUT_VARIANTS.includes(value as ClusteringInputVariant)
    ? (value as ClusteringInputVariant)
    : CLUSTERING_INPUT_VARIANT;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ClusterInputItem = {
  id: string;
  path?: string;
  action?: string;
  keyword?: string[];
  episodic?: string;
  semantic?: string;
  input?: string;
  output?: string;
  originalInteractionContent?: string;
  link?: string;
  sourceType?: string | null;
  source?: unknown;
  embedding?: number[];
  embeddingSource?: string | null;
  timestamp?: number;
};

export type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

export type SimilarityEdge = {
  source: number;
  target: number;
  weight: number;
};

export type ClusterGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
};

export type ClusterSnapshotPhase = "before" | "after";

export type StoredClusterSnapshot = {
  phase: ClusterSnapshotPhase;
  missionId: string;
  itemIds: string[];
  itemSignature: string | null;
  graphClusters: MemoryCluster[];
  graphEdges: ClusterGraphEdge[];
  generatedAt: number | null;
};

export type GraphCommunityDiagnostics = {
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
    meanCentered: boolean;
  };
};

type ClusterLabel = { id: string; label: string; summary: string };

export function clusteringMethodVersion(
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
) {
  return `${CLUSTERING_METHOD_VERSION}:${variant}`;
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

export function clusterCacheId(
  memoryVersion: string,
  itemSignature: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
) {
  const versionKey = memoryVersion.replace(/[^a-zA-Z0-9_-]/g, "_");
  const signatureHash = createHash("sha256")
    .update(`${clusteringMethodVersion(variant)}:${itemSignature}`)
    .digest("hex")
    .slice(0, 24);
  return `${versionKey}-${signatureHash}`;
}

export function clusterDocumentPath(
  uid: string,
  memoryVersion: string,
  itemSignature: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
) {
  return `users/${uid}/${CLUSTER_COLLECTION}/${clusterCacheId(
    memoryVersion,
    itemSignature,
    variant,
  )}`;
}

export function clusterSnapshotId(
  missionId: string,
  phase: ClusterSnapshotPhase,
) {
  return `${missionId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${phase}`;
}

export function clusterSnapshotDocumentPath(
  uid: string,
  missionId: string,
  phase: ClusterSnapshotPhase,
) {
  return `users/${uid}/${CLUSTER_SNAPSHOT_COLLECTION}/${clusterSnapshotId(
    missionId,
    phase,
  )}`;
}

export function memoryClusterItemSignature(items: ClusterInputItem[]) {
  return createHash("sha256")
    .update(items.map((item) => item.id).sort().join(","))
    .digest("hex")
    .slice(0, 32);
}

export function isMemoryCluster(value: unknown): value is MemoryCluster {
  const c = value as Partial<MemoryCluster>;
  return (
    Boolean(c) &&
    typeof c.id === "string" &&
    typeof c.label === "string" &&
    typeof c.summary === "string" &&
    typeof c.count === "number" &&
    Array.isArray(c.relatedActions) &&
    Array.isArray(c.itemIds) &&
    Array.isArray(c.representativeItems)
  );
}

export function parseStoredClusters(value: unknown) {
  return Array.isArray(value) ? value.filter(isMemoryCluster) : [];
}

// Best-effort load of the most recently generated cluster cache *document* for a
// user. Cluster docs are keyed by item signature and accumulate over time; we
// pick the newest by generatedAt for the requested variant and current method,
// ignoring whether the signature still matches the current memory set.
// Returns null when none exists.
// This never regenerates clusters (no LLM) — safe for the chat/retrieve hot path.
export async function loadLatestStoredClusterDoc(
  uid: string,
  token: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
): Promise<{
  graphClusters: MemoryCluster[];
  graphEdges: ClusterGraphEdge[];
  generatedAt: number;
  itemSignature: string | null;
  clusteringMethodVersion: string | null;
} | null> {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${CLUSTER_COLLECTION}`,
    token,
  );
  if (ids.length === 0) return null;
  const docs = await Promise.all(
    ids.map(async (id) => {
      const data = (await getFirestoreDocument(
        `users/${uid}/${CLUSTER_COLLECTION}/${encodeURIComponent(id)}`,
        token,
      )) as Record<string, unknown> | null;
      if (!data) return null;
      // Only consider the requested input variant so consumers (e.g. the chat
      // planner) get a consistent clustering, not a mix across variants.
      const docVariant =
        typeof data.clusteringInputVariant === "string"
          ? data.clusteringInputVariant
          : "";
      if (docVariant !== variant) return null;
      const docMethodVersion =
        typeof data.clusteringMethodVersion === "string"
          ? data.clusteringMethodVersion
          : "";
      if (docMethodVersion !== clusteringMethodVersion(variant)) return null;
      const graphClusters = parseStoredClusters(data.graphClusters);
      if (graphClusters.length === 0) return null;
      return {
        graphClusters,
        graphEdges: parseStoredGraphEdges(data.graphEdges),
        generatedAt:
          typeof data.generatedAt === "number" ? data.generatedAt : 0,
        itemSignature:
          typeof data.itemSignature === "string" ? data.itemSignature : null,
        clusteringMethodVersion: docMethodVersion,
      };
    }),
  );
  return (
    docs
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
      .sort((a, b) => b.generatedAt - a.generatedAt)[0] ?? null
  );
}

// Convenience wrapper returning just the clusters of the latest cache document.
export async function loadLatestStoredClusters(
  uid: string,
  token: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
): Promise<MemoryCluster[]> {
  const doc = await loadLatestStoredClusterDoc(uid, token, variant);
  return doc ? doc.graphClusters : [];
}

// Map each memory item id to the cluster it belongs to (first match wins).
export function clusterSummaryByItemId(clusters: MemoryCluster[]) {
  const map = new Map<
    string,
    { clusterId: string; label: string; summary: string }
  >();
  for (const cluster of clusters) {
    for (const itemId of cluster.itemIds) {
      if (!map.has(itemId)) {
        map.set(itemId, {
          clusterId: cluster.id,
          label: cluster.label,
          summary: cluster.summary,
        });
      }
    }
  }
  return map;
}

export function parseStoredGraphEdges(value: unknown): ClusterGraphEdge[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((edge) => {
      const data = edge as Partial<ClusterGraphEdge>;
      return {
        sourceId: typeof data.sourceId === "string" ? data.sourceId : "",
        targetId: typeof data.targetId === "string" ? data.targetId : "",
        weight: Number(data.weight),
      };
    })
    .filter(
      (edge) =>
        edge.sourceId &&
        edge.targetId &&
        edge.sourceId !== edge.targetId &&
        Number.isFinite(edge.weight),
    );
}

function itemSummary(item: ClusterInputItem) {
  return item.semantic || item.episodic || item.input || item.output || item.action || item.id;
}

function diverseLabelItemIds(
  ids: string[],
  itemsById: Map<string, ClusterInputItem>,
) {
  if (ids.length <= 8) return ids;
  const byTime = [...ids].sort((a, b) => {
    const aTime = itemsById.get(a)?.timestamp ?? 0;
    const bTime = itemsById.get(b)?.timestamp ?? 0;
    return aTime - bTime || a.localeCompare(b);
  });
  const picks = new Set<string>();
  byTime.slice(0, 2).forEach((id) => picks.add(id));
  byTime.slice(-3).forEach((id) => picks.add(id));
  const slots = Math.max(1, byTime.length - 1);
  for (let step = 1; picks.size < 8 && step <= 4; step += 1) {
    picks.add(byTime[Math.round((slots * step) / 5)]);
  }
  for (const id of ids) {
    if (picks.size >= 8) break;
    picks.add(id);
  }
  return Array.from(picks);
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function meanCenteredVectors(vectors: number[][]) {
  const dimension = vectors[0]?.length ?? 0;
  if (dimension === 0 || vectors.length <= 1) return vectors.map((vector) => [...vector]);

  const mean = Array.from({ length: dimension }, () => 0);
  vectors.forEach((vector) => {
    for (let i = 0; i < dimension; i += 1) mean[i] += vector[i] ?? 0;
  });
  for (let i = 0; i < dimension; i += 1) mean[i] /= vectors.length;

  return vectors.map((vector) =>
    l2Normalize(
      Array.from({ length: dimension }, (_, i) => (vector[i] ?? 0) - mean[i]),
    ),
  );
}

function meanVector(vectors: number[][], dimension: number) {
  const mean = Array.from({ length: dimension }, () => 0);
  vectors.forEach((vector) => {
    for (let i = 0; i < dimension; i += 1) mean[i] += vector[i];
  });
  return l2Normalize(mean.map((v) => v / Math.max(vectors.length, 1)));
}

function relatedActions(clusterItems: ClusterInputItem[]) {
  return Array.from(
    new Set(
      clusterItems
        .map((item) => item.action)
        .filter((a): a is string => Boolean(a)),
    ),
  );
}

function representativeItems(clusterItems: ClusterInputItem[], clusterVectors: number[][]) {
  if (clusterItems.length <= 3) return clusterItems.map(itemSummary);
  const centroid = meanVector(clusterVectors, clusterVectors[0].length);
  return clusterItems
    .map((item, index) => ({ item, similarity: cosineSimilarity(clusterVectors[index], centroid) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map(({ item }) => itemSummary(item));
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
        .map((c) => ({
          id: String(c.id ?? "").trim(),
          label: String(c.label ?? "").trim(),
          summary: String(c.summary ?? "").trim(),
        }))
        .filter((c) => c.id && c.label)
        .map((c) => [c.id, c] as const),
    );
  } catch {
    return new Map<string, ClusterLabel>();
  }
}

export async function labelClusters(
  clusters: MemoryCluster[],
  itemsById: Map<string, ClusterInputItem>,
  subjectName?: string,
) {
  if (clusters.length === 0) return clusters;
  const subject = subjectName?.trim() || "This participant";
  const completion = await openai.chat.completions.create({
    model: LABEL_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: memoryClusterLabelPrompt(subjectName),
      },
      {
        role: "user",
        content: JSON.stringify({
          clusters: clusters.map((cluster) => ({
            id: cluster.id,
            relatedActions: cluster.relatedActions,
            count: cluster.count,
            representativeItems: cluster.representativeItems,
            items: diverseLabelItemIds(cluster.itemIds, itemsById).map((id) => {
              const item = itemsById.get(id);
              return {
                id,
                action: item?.action ?? "",
                keyword: item?.keyword ?? [],
                episodic: item?.episodic ?? "",
                semantic: item?.semantic ?? "",
                input: item?.input ?? "",
                output: item?.output ?? "",
                originalInteractionContent:
                  item?.originalInteractionContent ?? "",
              };
            }),
          })),
        }),
      },
    ],
  });
  const labels = parseClusterLabels(completion.choices[0]?.message?.content ?? "{}");
  return clusters.map((cluster) => {
    const label = labels.get(cluster.id);
    return {
      ...cluster,
      label: label?.label || fallbackLabel(cluster),
      summary:
        label?.summary ||
        `${subject} shows a recurring pattern around ${(
          label?.label || fallbackLabel(cluster)
        ).toLowerCase()} across ${cluster.count} recorded interaction${
          cluster.count === 1 ? "" : "s"
        }.`,
    };
  });
}

export async function embedItems(items: ClusterInputItem[], token?: string) {
  if (token) {
    await ensureFreshMemoryEmbeddings(items, token);
  }
  const missing = items.filter(
    (item) => !Array.isArray(item.embedding) || item.embedding.length === 0,
  );
  if (missing.length > 0) {
    const embeddings = await embedMemoryInputs(missing);
    missing.forEach((item, index) => {
      item.embedding = embeddings[index] ?? [];
    });
  }
  return items.map((item) => l2Normalize(item.embedding ?? []));
}

async function generateClusterGraph(
  items: ClusterInputItem[],
  token: string,
  subjectName?: string,
) {
  if (items.length === 0) {
    return {
      graphClusters: [] as MemoryCluster[],
      graphEdges: [] as ClusterGraphEdge[],
      graphDiagnostics: null,
    };
  }
  const vectors = await embedItems(items, token);
  const graphCommunity = buildGraphCommunityClusters(items, vectors);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return {
    graphClusters: await labelClusters(
      graphCommunity.clusters,
      itemsById,
      subjectName,
    ),
    graphEdges: graphCommunity.edges,
    graphDiagnostics: graphCommunity.diagnostics,
  };
}

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
    if (!existing || edge.weight > existing.weight) edgesByKey.set(key, edge);
  };

  pairEdges.filter((e) => e.weight >= GRAPH_STRONG_SIMILARITY).forEach(addEdge);
  neighborCandidates.forEach((edges) =>
    edges
      .filter((e) => e.weight >= GRAPH_MIN_SIMILARITY)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, GRAPH_KNN_EDGES)
      .forEach(addEdge),
  );

  return Array.from(edgesByKey.values()).sort((a, b) => b.weight - a.weight);
}

function labelPropagationCommunities(nodeCount: number, edges: SimilarityEdge[]) {
  const labels = Array.from({ length: nodeCount }, (_, i) => i);
  const adjacency = Array.from({ length: nodeCount }, () => [] as { neighbor: number; weight: number }[]);

  edges.forEach((edge) => {
    adjacency[edge.source].push({ neighbor: edge.target, weight: edge.weight });
    adjacency[edge.target].push({ neighbor: edge.source, weight: edge.weight });
  });

  for (let iteration = 0; iteration < GRAPH_COMMUNITY_ITERATIONS; iteration += 1) {
    let changed = false;
    const order = Array.from({ length: nodeCount }, (_, i) => i).sort(
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

function groupsFromLabels(labels: number[]) {
  const byLabel = new Map<number, number[]>();
  labels.forEach((label, itemIndex) => {
    const current = byLabel.get(label) ?? [];
    current.push(itemIndex);
    byLabel.set(label, current);
  });
  return Array.from(byLabel.values()).sort((a, b) => b.length - a.length);
}

function communityCentroid(group: number[], vectors: number[][], dimension: number) {
  return meanVector(group.map((i) => vectors[i]), dimension);
}

function mergeCommunities(groups: number[][], vectors: number[][], maxCount: number) {
  const dimension = vectors[0]?.length ?? 0;
  const merged = groups.map((g) => [...g]);
  while (merged.length > maxCount) {
    let bestA = 0, bestB = 1, bestSimilarity = -Infinity;
    const centroids = merged.map((g) => communityCentroid(g, vectors, dimension));
    for (let a = 0; a < merged.length; a += 1) {
      for (let b = a + 1; b < merged.length; b += 1) {
        const similarity = cosineSimilarity(centroids[a], centroids[b]);
        if (similarity > bestSimilarity) { bestSimilarity = similarity; bestA = a; bestB = b; }
      }
    }
    merged[bestA] = [...merged[bestA], ...merged[bestB]];
    merged.splice(bestB, 1);
  }
  return merged;
}

export function buildGraphCommunityClusters(items: ClusterInputItem[], vectors: number[][]) {
  const clusteringVectors = meanCenteredVectors(vectors);
  const edges = similarityEdges(clusteringVectors);
  const graphEdges: ClusterGraphEdge[] = edges.map((edge) => ({
    sourceId: items[edge.source]?.id ?? "",
    targetId: items[edge.target]?.id ?? "",
    weight: Number(edge.weight.toFixed(6)),
  })).filter((edge) => edge.sourceId && edge.targetId);
  const labels = labelPropagationCommunities(items.length, edges);
  const rawGroups = groupsFromLabels(labels);
  const groups = mergeCommunities(rawGroups, clusteringVectors, MAX_GRAPH_CLUSTER_COUNT);
  const singletonCount = rawGroups.filter((g) => g.length === 1).length;

  return {
    edges: graphEdges,
    clusters: groups
      .sort((a, b) => b.length - a.length)
      .map((itemIndexes, index) => {
        const clusterItems = itemIndexes.map((i) => items[i]);
        const clusterVectors = itemIndexes.map((i) => clusteringVectors[i]);
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
      method: "embedding-similarity-graph-label-propagation-llm-labeling" as const,
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
        averageDegree: Number(((edges.length * 2) / Math.max(items.length, 1)).toFixed(3)),
        singletonCount,
        rawCommunityCount: rawGroups.length,
        cappedCommunityCount: groups.length,
        meanCentered: true,
      },
    } satisfies GraphCommunityDiagnostics,
  };
}

export async function generateAndStoreClusters(
  uid: string,
  items: ClusterInputItem[],
  token: string,
  generatedBy: string,
  subjectName?: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
) {
  const { graphClusters, graphEdges, graphDiagnostics } =
    await generateClusterGraph(items, token, subjectName);
  const completedAt = Date.now();

  const itemSignature = memoryClusterItemSignature(items);

  await patchFirestoreDocument(
    clusterDocumentPath(uid, MEMORY_VERSION, itemSignature, variant),
    {
      itemSignature,
      memoryVersion: MEMORY_VERSION,
      clusteringMethodVersion: clusteringMethodVersion(variant),
      clusteringInputVariant: variant,
      sourceItemCount: items.length,
      graphClusters,
      graphEdges,
      graphDiagnostics,
      generatedAt: completedAt,
      generatedBy,
    },
    token,
  );

  return { graphClusters, graphEdges, itemSignature };
}

function sourceMissionId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return typeof source.missionId === "string" && source.missionId.trim()
    ? source.missionId.trim()
    : null;
}

export function isWithinCumulativeMission(
  memoryMissionId: string | null | undefined,
  selectedMissionId: string,
  missionOrder: string[],
) {
  if (memoryMissionId === ONBOARDING_MISSION_ID) return true;
  if (!memoryMissionId) return false;
  const selectedIndex = missionOrder.indexOf(selectedMissionId);
  if (selectedIndex === -1) return memoryMissionId === selectedMissionId;
  const memoryIndex = missionOrder.indexOf(memoryMissionId);
  if (memoryIndex === -1) return false;
  return memoryIndex <= selectedIndex;
}

function snapshotItems(
  memories: Awaited<ReturnType<typeof loadUserMemoryItems>>,
  missionId: string,
  missionOrder: string[],
  phase: ClusterSnapshotPhase,
) {
  return memories
    .filter((item) => {
      const itemMissionId = sourceMissionId(item.source);
      if (!isWithinCumulativeMission(itemMissionId, missionId, missionOrder)) {
        return false;
      }
      if (
        phase === "before" &&
        itemMissionId === missionId &&
        item.sourceType !== "before_session"
      ) {
        return false;
      }
      return Boolean(item.episodic || item.semantic || item.keywords.length > 0);
    })
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: item.id,
      action: item.action ?? undefined,
      keyword: item.keywords,
      episodic: item.episodic ?? undefined,
      semantic: item.semantic ?? undefined,
      input: item.input ?? undefined,
      output: item.output ?? undefined,
      originalInteractionContent: item.originalInteractionContent ?? undefined,
      link: item.link ?? undefined,
      sourceType: item.sourceType,
      source: item.source,
      embedding: item.embedding,
      embeddingSource: item.embeddingSource,
      timestamp: item.timestamp ?? 0,
    }));
}

export async function generateAndStoreSessionClusterSnapshots(
  uid: string,
  missionId: string,
  missionOrder: string[],
  token: string,
  generatedBy: string,
  subjectName?: string,
  variant: ClusteringInputVariant = CLUSTERING_INPUT_VARIANT,
) {
  const memories = await loadUserMemoryItems(uid, token);
  const phases: ClusterSnapshotPhase[] = ["before", "after"];
  const snapshots = await Promise.all(
    phases.map(async (phase) => {
      const items = snapshotItems(memories, missionId, missionOrder, phase);
      const itemSignature =
        items.length > 0 ? memoryClusterItemSignature(items) : null;
      const { graphClusters, graphEdges, graphDiagnostics } =
        await generateClusterGraph(items, token, subjectName);
      const generatedAt = Date.now();
      await patchFirestoreDocument(
        clusterSnapshotDocumentPath(uid, missionId, phase),
        {
          missionId,
          phase,
          itemIds: items.map((item) => item.id),
          itemSignature,
          memoryVersion: MEMORY_VERSION,
          clusteringMethodVersion: clusteringMethodVersion(variant),
          clusteringInputVariant: variant,
          sourceItemCount: items.length,
          graphClusters,
          graphEdges,
          graphDiagnostics,
          generatedAt,
          generatedBy,
        },
        token,
      );
      return {
        phase,
        missionId,
        itemIds: items.map((item) => item.id),
        itemSignature,
        graphClusters,
        graphEdges,
        generatedAt,
      } satisfies StoredClusterSnapshot;
    }),
  );
  return {
    before: snapshots.find((snapshot) => snapshot.phase === "before") ?? null,
    after: snapshots.find((snapshot) => snapshot.phase === "after") ?? null,
  };
}

function parseStoredClusterSnapshot(
  missionId: string,
  phase: ClusterSnapshotPhase,
  data: Record<string, unknown> | null,
): StoredClusterSnapshot | null {
  if (!data) return null;
  return {
    phase,
    missionId,
    itemIds: Array.isArray(data.itemIds)
      ? data.itemIds.map(String).filter(Boolean)
      : [],
    itemSignature:
      typeof data.itemSignature === "string" ? data.itemSignature : null,
    graphClusters: parseStoredClusters(data.graphClusters),
    graphEdges: parseStoredGraphEdges(data.graphEdges),
    generatedAt: typeof data.generatedAt === "number" ? data.generatedAt : null,
  };
}

export async function loadSessionClusterSnapshots(
  uid: string,
  missionId: string,
  token: string,
) {
  const [before, after] = await Promise.all(
    (["before", "after"] as const).map(async (phase) =>
      parseStoredClusterSnapshot(
        missionId,
        phase,
        ((await getFirestoreDocument(
          clusterSnapshotDocumentPath(uid, missionId, phase),
          token,
        )) ?? null) as Record<string, unknown> | null,
      ),
    ),
  );
  return { before, after };
}
