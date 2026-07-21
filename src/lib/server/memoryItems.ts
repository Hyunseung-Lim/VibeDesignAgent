import {
  getFirestoreDocument,
  listFirestoreDocumentIds,
} from "@/lib/server/firebaseAdminRest";
import {
  isInactiveMemoryWeight,
  memoryArchivedAt,
} from "@/lib/server/memoryActivity";

export const MEMORY_COLLECTION = "memories_0_1_2";

type LoadMemoryItemsOptions = {
  includeArchived?: boolean;
  includeInactive?: boolean;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function stringArray(primary: unknown, fallback?: unknown): string[] {
  const value = Array.isArray(primary)
    ? primary
    : Array.isArray(fallback)
      ? fallback
      : [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

export async function loadUserMemoryItems(
  uid: string,
  token: string,
  options: LoadMemoryItemsOptions = {},
) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  const docs = await Promise.all(
    ids.map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return {
        id,
        path: `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
        episodic: stringValue(data.episodic ?? data.episode),
        semantic: stringValue(data.semantic),
        input: stringValue(data.input),
        output: stringValue(data.output),
        originalInteractionContent: stringValue(
          data.originalInteractionContent,
        ),
        action: stringValue(data.action),
        preferenceSignal: data.preferenceSignal ?? null,
        sourceType: stringValue(data.sourceType ?? data.memorySource),
        link: stringValue(data.link),
        keywords: stringArray(data.keywords, data.keyword),
        weight: numberValue(data.weight),
        embedding: numberArray(data.embedding),
        embeddingSource: stringValue(data.embeddingSource),
        timestamp: numberValue(data.timestamp ?? data.createdAt),
        archivedAt: memoryArchivedAt(data.archivedAt),
        archiveReason: stringValue(data.archiveReason),
        inactiveReason: stringValue(data.inactiveReason),
        inactiveReasonDetail: stringValue(data.inactiveReasonDetail),
        inactive: isInactiveMemoryWeight(data.weight),
        source:
          data.source && typeof data.source === "object" ? data.source : null,
      };
    }),
  );

  return docs
    .filter(
      (item) =>
        (options.includeArchived || !item.archivedAt) &&
        (options.includeInactive || !item.inactive) &&
        Boolean(
          item.episodic ||
            item.semantic ||
            item.input ||
            item.output ||
            item.keywords.length > 0,
        ),
    )
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

