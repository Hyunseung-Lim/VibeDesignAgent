import {
  getFirestoreDocument,
  listFirestoreDocumentIds,
} from "@/lib/server/firebaseAdminRest";
import type { ClusterInputItem } from "@/lib/server/memoryClustering";

export const MEMORY_COLLECTION = "memories_0_1_2";

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

export async function loadUserMemoryItems(uid: string, token: string) {
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
        episodic: stringValue(data.episodic ?? data.episode),
        semantic: stringValue(data.semantic),
        input: stringValue(data.input),
        output: stringValue(data.output),
        originalInteractionContent: stringValue(
          data.originalInteractionContent,
        ),
        action: stringValue(data.action),
        sourceType: stringValue(data.sourceType ?? data.memorySource),
        keywords: stringArray(data.keywords, data.keyword),
        weight: numberValue(data.weight),
        embedding: numberArray(data.embedding),
        timestamp: numberValue(data.timestamp ?? data.createdAt),
        archivedAt: numberValue(data.archivedAt),
        archiveReason: stringValue(data.archiveReason),
        interpretationConfidence: numberValue(data.interpretationConfidence),
        source:
          data.source && typeof data.source === "object" ? data.source : null,
      };
    }),
  );

  return docs
    .filter(
      (item) =>
        item.episodic ||
        item.semantic ||
        item.input ||
        item.output ||
        item.keywords.length > 0,
    )
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

export async function loadClusterInputItems(
  uid: string,
  token: string,
  maxItems: number,
): Promise<ClusterInputItem[]> {
  const memories = await loadUserMemoryItems(uid, token);
  return memories
    .filter(
      (item) =>
        Boolean(item.episodic || item.semantic || item.keywords.length > 0),
    )
    .slice(0, maxItems)
    .map((item) => ({
      id: item.id,
      action: item.action ?? undefined,
      keyword: item.keywords,
      episodic: item.episodic ?? undefined,
      semantic: item.semantic ?? undefined,
      input: item.input ?? undefined,
      output: item.output ?? undefined,
      originalInteractionContent: item.originalInteractionContent ?? undefined,
      timestamp: item.timestamp ?? 0,
    }));
}
