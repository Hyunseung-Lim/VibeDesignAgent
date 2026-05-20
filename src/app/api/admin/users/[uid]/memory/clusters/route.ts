import OpenAI from "openai";
import { verifyFirebaseIdToken } from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseClusters(raw: string): MemoryCluster[] {
  try {
    const parsed = JSON.parse(raw) as { clusters?: Partial<MemoryCluster>[] };
    return (parsed.clusters ?? [])
      .map((cluster, index) => ({
        id: String(cluster.id || `cluster-${index + 1}`),
        label: String(cluster.label ?? "Untitled cluster").trim(),
        summary: String(cluster.summary ?? "").trim(),
        count: Number(cluster.count ?? stringArray(cluster.itemIds).length),
        relatedActions: stringArray(cluster.relatedActions),
        itemIds: stringArray(cluster.itemIds),
        representativeItems: stringArray(cluster.representativeItems).slice(
          0,
          5,
        ),
      }))
      .filter((cluster) => cluster.itemIds.length > 0);
  } catch {
    return [];
  }
}

function clusterItemRecords(cluster: MemoryCluster, items: ClusterInputItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return cluster.itemIds
    .map((id) => byId.get(id))
    .filter((item): item is ClusterInputItem => Boolean(item));
}

function isCommunicationStyleCluster(cluster: MemoryCluster) {
  return /communication|concise|direct|iterative|workflow|working style|prompt style/i.test(
    `${cluster.id} ${cluster.label} ${cluster.summary}`,
  );
}

function isReferenceManagementItem(item: ClusterInputItem) {
  return (
    item.action === "reference_cite" ||
    item.action === "reference_delete" ||
    /reference|레퍼런스|인용|삭제/i.test(
      `${item.semantic} ${item.episode ?? ""} ${item.input ?? ""}`,
    )
  );
}

function createClusterFromItems(
  id: string,
  label: string,
  summary: string,
  clusterItems: ClusterInputItem[],
): MemoryCluster {
  return {
    id,
    label,
    summary,
    count: clusterItems.length,
    relatedActions: Array.from(
      new Set(
        clusterItems
          .map((item) => item.action)
          .filter((action): action is string => Boolean(action)),
      ),
    ),
    itemIds: clusterItems.map((item) => item.id),
    representativeItems: clusterItems.map((item) => item.semantic).slice(0, 5),
  };
}

function refreshClusterStats(
  clusters: MemoryCluster[],
  items: ClusterInputItem[],
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return clusters.map((cluster) => {
    const relatedActions = Array.from(
      new Set(
        cluster.itemIds
          .map((id) => byId.get(id)?.action ?? "")
          .filter(Boolean),
      ),
    );
    return {
      ...cluster,
      count: cluster.itemIds.length,
      relatedActions,
    };
  });
}

function mergeClusterIntoBestTarget(
  source: MemoryCluster,
  targets: MemoryCluster[],
  items: ClusterInputItem[],
) {
  const sourceItems = clusterItemRecords(source, items);
  const sourceActions = new Set(sourceItems.map((item) => item.action));
  const sourceKeywords = new Set(sourceItems.flatMap((item) => item.keywords ?? []));
  const target =
    targets
      .map((candidate) => {
        const candidateItems = clusterItemRecords(candidate, items);
        const actionOverlap = candidateItems.filter((item) =>
          sourceActions.has(item.action),
        ).length;
        const keywordOverlap = candidateItems.reduce(
          (score, item) =>
            score +
            (item.keywords ?? []).filter((keyword) =>
              sourceKeywords.has(keyword),
            ).length,
          0,
        );
        return {
          candidate,
          score: actionOverlap * 4 + keywordOverlap + candidate.itemIds.length,
        };
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate ?? targets[0];

  if (!target) return false;
  target.itemIds = [...target.itemIds, ...source.itemIds];
  target.count = target.itemIds.length;
  target.relatedActions = Array.from(
    new Set([...target.relatedActions, ...source.relatedActions]),
  );
  target.representativeItems = [
    ...target.representativeItems,
    ...source.representativeItems,
  ].slice(0, 5);
  return true;
}

function normalizeClusters(
  clusters: MemoryCluster[],
  items: ClusterInputItem[],
) {
  const validIds = new Set(items.map((item) => item.id));
  const assigned = new Set<string>();
  const duplicateItemIds = new Set<string>();
  let normalized = clusters
    .map((cluster) => {
      const itemIds: string[] = [];
      for (const id of cluster.itemIds) {
        if (!validIds.has(id)) continue;
        if (assigned.has(id)) {
          duplicateItemIds.add(id);
          continue;
        }
        assigned.add(id);
        itemIds.push(id);
      }
      return {
        ...cluster,
        itemIds,
        count: itemIds.length,
        relatedActions: Array.from(
          new Set(
            itemIds
              .map((id) => items.find((item) => item.id === id)?.action ?? "")
              .filter(Boolean),
          ),
        ),
      };
    })
    .filter((cluster) => cluster.itemIds.length > 0);

  const concreteClusters = normalized.filter(
    (cluster) =>
      !(isCommunicationStyleCluster(cluster) && cluster.itemIds.length < 3) &&
      cluster.itemIds.length > 1,
  );
  const clustersToMerge = normalized.filter(
    (cluster) =>
      (isCommunicationStyleCluster(cluster) && cluster.itemIds.length < 3) ||
      cluster.itemIds.length === 1,
  );
  for (const cluster of clustersToMerge) {
    const targets = concreteClusters.filter((target) => target.id !== cluster.id);
    if (!mergeClusterIntoBestTarget(cluster, targets, items)) {
      concreteClusters.push(cluster);
    }
  }
  normalized = concreteClusters.map((cluster) => ({
    ...cluster,
    count: cluster.itemIds.length,
  }));

  const omittedItemIds = items
    .map((item) => item.id)
    .filter((id) => !assigned.has(id));

  if (omittedItemIds.length > 0) {
    const omittedItems = items.filter((item) =>
      omittedItemIds.includes(item.id),
    );

    const referenceItems = omittedItems.filter(isReferenceManagementItem);
    const remainingItems = omittedItems.filter(
      (item) => !referenceItems.includes(item),
    );

    if (referenceItems.length > 1) {
      const source = createClusterFromItems(
        "reference-management",
        "Reference Management",
        "Items about citing, deleting, or curating reference sources during the design process.",
        referenceItems,
      );
      const existingReferenceCluster = normalized.find((cluster) =>
        /reference/i.test(`${cluster.id} ${cluster.label}`),
      );
      if (existingReferenceCluster) {
        mergeClusterIntoBestTarget(source, [existingReferenceCluster], items);
      } else {
        normalized.push(source);
      }
    } else if (referenceItems.length === 1) {
      remainingItems.push(referenceItems[0]);
    }

    for (const item of remainingItems) {
      const source = createClusterFromItems(
        `recovered-${item.id}`,
        "Recovered Item",
        "Item recovered after the model omitted it from the cluster assignment.",
        [item],
      );
      if (!mergeClusterIntoBestTarget(source, normalized, items)) {
        normalized.push(source);
      }
    }
  }

  normalized = refreshClusterStats(normalized, items);

  const finalAssignedIds = new Set(
    normalized.flatMap((cluster) => cluster.itemIds),
  );
  const unassignedItemIds = items
    .map((item) => item.id)
    .filter((id) => !finalAssignedIds.has(id));

  if (unassignedItemIds.length > 0) {
    const fallbackItems = items.filter((item) => unassignedItemIds.includes(item.id));
    normalized.push(
      createClusterFromItems(
        "other-patterns",
        "Other Patterns",
        "Semantic items that could not be assigned to a more specific cluster.",
        fallbackItems,
      ),
    );
  }

  const diagnostics: ClusterDiagnostics = {
    duplicateItemIds: Array.from(duplicateItemIds),
    recoveredUnassignedItemIds: omittedItemIds.filter((id) =>
      normalized.some((cluster) => cluster.itemIds.includes(id)),
    ),
    unassignedItemIds: items
      .map((item) => item.id)
      .filter(
        (id) => !normalized.some((cluster) => cluster.itemIds.includes(id)),
      ),
  };
  return {
    clusters: refreshClusterStats(normalized, items),
    diagnostics,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await verifyFirebaseIdToken(request);
  if (!admin || !isAdminEmail(admin.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  await params;
  const body = (await request.json().catch(() => ({}))) as {
    items?: ClusterInputItem[];
  };
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
    .slice(0, 160);

  if (items.length === 0) {
    return Response.json({ clusters: [] });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Cluster semantic memory items for a design-agent research admin view.

Return valid JSON only:
{
  "clusters": [
    {
      "id": "short-kebab-case-id",
      "label": "2-5 word English label",
      "summary": "One concise English sentence explaining the shared pattern.",
      "count": 0,
      "relatedActions": ["action_type"],
      "itemIds": ["item id"],
      "representativeItems": ["semantic sentence"]
    }
  ]
}

Rules:
- Cluster by shared user intent, preference, workflow pattern, research concern, or design-process theme.
- Prefer 3-8 clusters unless there are very few items.
- Avoid one-item clusters unless the item is truly unrelated to every other item.
- Every input item id must appear in exactly one cluster.
- Use natural, readable English labels useful to a researcher. Prefer labels like "Reference Research and Comparison" or "Landing Page Planning" over awkward noun stacks.
- Avoid creating a communication-style cluster unless at least three items primarily describe communication style rather than the design task itself.
- If communication style is mixed with a concrete workflow theme, assign the item to the concrete workflow theme.
- Do not invent facts beyond the provided semantic, episode, input, action, and keywords.`,
      },
      {
        role: "user",
        content: JSON.stringify({ items }),
      },
    ],
  });

  const parsedClusters = parseClusters(
    completion.choices[0]?.message?.content ?? "{}",
  );
  const { clusters, diagnostics } = normalizeClusters(parsedClusters, items);
  return Response.json({ clusters, diagnostics });
}
