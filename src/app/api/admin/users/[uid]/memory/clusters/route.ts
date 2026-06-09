import OpenAI from "openai";
import { createHash } from "crypto";
import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-large";
const LABEL_MODEL = "gpt-5.4-mini";
const MAX_GRAPH_CLUSTER_COUNT = 16;
const MAX_ITEMS = 160;
const GRAPH_MIN_SIMILARITY = 0.58;
const GRAPH_STRONG_SIMILARITY = 0.74;
const GRAPH_KNN_EDGES = 3;
const GRAPH_COMMUNITY_ITERATIONS = 30;
const CLUSTER_COLLECTION = "memoryClusters";
const CLUSTERING_METHOD_VERSION = "similarity-graph-v2";
const DEFAULT_MEMORY_VERSION = "0.1.2";

type ClusterInputItem = {
  id: string;
  action?: string;
  keyword?: string[];
  episodic?: string;
  semantic?: string;
  input?: string;
  output?: string;
  originalInteractionContent?: string;
  link?: string;
  timestamp?: number;
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

type StoredClusterDocument = {
  graphClusters?: unknown;
  graphEdges?: unknown;
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

type SimilarityEdge = {
  source: number;
  target: number;
  weight: number;
};

type ClusterGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
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

function parseStoredGraphEdges(value: unknown): ClusterGraphEdge[] {
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
  // Cluster vectors are semantic only; timestamp stays available as metadata.
  const originalInteractionContent =
    item.originalInteractionContent ||
    [
      item.input ? `User input:\n${item.input}` : "",
      item.output ? `Agent output:\n${item.output}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  return [
    item.keyword?.length ? `Keywords: ${item.keyword.join(", ")}` : "",
    item.episodic ? `Episodic: ${item.episodic}` : "",
    item.semantic ? `Semantic: ${item.semantic}` : "",
    originalInteractionContent
      ? `Original interaction content:\n${originalInteractionContent}`
      : "",
    item.link ? `Link: ${item.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function itemSummary(item: ClusterInputItem) {
  return item.semantic || item.episodic || item.input || item.output || item.action || item.id;
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
    return clusterItems.map(itemSummary);
  }
  const centroid = meanVector(clusterVectors, clusterVectors[0].length);
  return clusterItems
    .map((item, index) => ({
      item,
      similarity: cosineSimilarity(clusterVectors[index], centroid),
    }))
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

Use natural researcher-friendly labels. Avoid awkward noun stacks and avoid inventing facts beyond the provided semantic memory, episode, original interaction content, and keywords. Treat action labels as optional metadata only, not as the cluster meaning.`,
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
  const graphEdges: ClusterGraphEdge[] = edges
    .map((edge) => ({
      sourceId: items[edge.source]?.id ?? "",
      targetId: items[edge.target]?.id ?? "",
      weight: Number(edge.weight.toFixed(6)),
    }))
    .filter((edge) => edge.sourceId && edge.targetId);
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
  const singletonCount = rawGroups.filter((group) => group.length === 1).length;

  return {
    edges: graphEdges,
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
    return Response.json({ graphClusters: [], graphEdges: [], cacheHit: false });
  }

  const token = await getFirebaseAccessToken();

  // Try exact signature match first
  let stored = (await getFirestoreDocument(
    clusterDocumentPath(uid, memoryVersion, itemSignature),
    token,
  )) as StoredClusterDocument | null;

  // Fallback: pick best available cluster document by sourceItemCount proximity.
  // This handles the case where clusters were generated by a different code path
  // (e.g. session completion) that uses a different signature format.
  if (!stored || stored.itemSignature !== itemSignature) {
    const clusterIds = await listFirestoreDocumentIds(
      `users/${uid}/${CLUSTER_COLLECTION}`,
      token,
    );
    const clusterDocs = (
      await Promise.all(
        clusterIds.map(async (id) => {
          const doc = (await getFirestoreDocument(
            `users/${uid}/${CLUSTER_COLLECTION}/${encodeURIComponent(id)}`,
            token,
          )) as StoredClusterDocument | null;
          return doc;
        }),
      )
    ).filter(
      (doc): doc is StoredClusterDocument =>
        Boolean(doc) &&
        Array.isArray((doc as StoredClusterDocument).graphClusters) &&
        ((doc as StoredClusterDocument).graphClusters as unknown[]).length > 0,
    );

    // Pick the document whose sourceItemCount is closest to current item count
    const itemCount = url.searchParams.get("itemCount")
      ? Number(url.searchParams.get("itemCount"))
      : null;
    if (clusterDocs.length > 0) {
      stored = clusterDocs.sort((a, b) => {
        const countA = Number(a.sourceItemCount ?? 0);
        const countB = Number(b.sourceItemCount ?? 0);
        const ref = itemCount ?? 0;
        const diffA = Math.abs(ref - countA);
        const diffB = Math.abs(ref - countB);
        if (diffA !== diffB) return diffA - diffB;
        return Number(b.generatedAt ?? 0) - Number(a.generatedAt ?? 0);
      })[0] ?? null;
    }
  }

  if (!stored) {
    return Response.json({ graphClusters: [], graphEdges: [], cacheHit: false });
  }

  return Response.json({
    graphClusters: parseStoredClusters(stored.graphClusters),
    graphEdges: parseStoredGraphEdges(stored.graphEdges),
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
      action: String(item.action ?? "").trim(),
      keyword: stringArray(item.keyword).slice(0, 8),
      episodic: String(item.episodic ?? "").trim().slice(0, 700),
      semantic: String(item.semantic ?? "").trim() || undefined,
      input: String(item.input ?? "").trim().slice(0, 500),
      output: String(item.output ?? "").trim().slice(0, 500),
      originalInteractionContent:
        typeof item.originalInteractionContent === "string"
          ? item.originalInteractionContent.trim().slice(0, 20000)
          : undefined,
      link: String(item.link ?? "").trim().slice(0, 300) || undefined,
      timestamp: Number(item.timestamp ?? 0),
    }))
    .filter(
      (item) =>
        item.id &&
        (item.action || item.episodic || item.semantic || item.input || item.output || item.keyword.length > 0),
    )
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return Response.json({
      graphClusters: [],
      graphEdges: [],
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
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const graphCommunity = buildGraphCommunityClusters(items, vectors);
  const graphClusters = await labelClusters(graphCommunity.clusters, itemsById);
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
        graphClusters,
        graphEdges: graphCommunity.edges,
        graphDiagnostics,
        generatedAt: new Date(),
        generatedBy: admin.email ?? admin.localId,
      },
      token,
    );
  }

  return Response.json({
    graphClusters,
    graphEdges: graphCommunity.edges,
    graphDiagnostics,
  });
}
