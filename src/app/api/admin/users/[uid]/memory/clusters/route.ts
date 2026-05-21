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
const TARGET_CLUSTER_COUNT = 10;
const MAX_ITEMS = 160;
const MAX_KMEANS_ITERATIONS = 40;
const CLUSTER_COLLECTION = "memoryClusters";
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
  method: "embedding-kmeans";
  embeddingModel: string;
  labelModel: string;
  requestedClusterCount: number;
  actualClusterCount: number;
};

type StoredClusterDocument = {
  clusters?: unknown;
  diagnostics?: unknown;
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
    .update(itemSignature)
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
    method: "embedding-kmeans",
    embeddingModel: String(diagnostics.embeddingModel ?? EMBEDDING_MODEL),
    labelModel: String(diagnostics.labelModel ?? LABEL_MODEL),
    requestedClusterCount: Number(
      diagnostics.requestedClusterCount ?? TARGET_CLUSTER_COUNT,
    ),
    actualClusterCount: Number(diagnostics.actualClusterCount ?? 0),
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

The cluster membership is already fixed by embeddings and k-means. Do not move, add, remove, or duplicate item ids.

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

function diagnostics(clusters: MemoryCluster[], itemCount: number): ClusterDiagnostics {
  return {
    duplicateItemIds: [],
    recoveredUnassignedItemIds: [],
    unassignedItemIds: [],
    method: "embedding-kmeans",
    embeddingModel: EMBEDDING_MODEL,
    labelModel: LABEL_MODEL,
    requestedClusterCount: Math.min(TARGET_CLUSTER_COUNT, itemCount),
    actualClusterCount: clusters.length,
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
    diagnostics: parseStoredDiagnostics(stored.diagnostics),
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
      diagnostics: diagnostics([], 0),
    });
  }

  const k = Math.min(TARGET_CLUSTER_COUNT, items.length);
  const vectors = await embedItems(items);
  const assignments = kMeans(vectors, k);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const clusters = await labelClusters(
    buildClusters(items, vectors, assignments),
    itemsById,
  );
  const clusterDiagnostics = diagnostics(clusters, items.length);

  if (itemSignature) {
    const token = await getFirebaseAccessToken();
    await patchFirestoreDocument(
      clusterDocumentPath(uid, memoryVersion, itemSignature),
      {
        itemSignature,
        memoryVersion,
        sourceItemCount: items.length,
        clusters,
        diagnostics: clusterDiagnostics,
        generatedAt: new Date(),
        generatedBy: admin.email ?? admin.localId,
      },
      token,
    );
  }

  return Response.json({
    clusters,
    diagnostics: clusterDiagnostics,
  });
}
