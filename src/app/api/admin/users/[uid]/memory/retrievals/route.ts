import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const MEMORY_COLLECTION = "memories_0_1_2";
const LEGACY_MEMORY_COLLECTION = "memories_0_1_1";
const RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs";
const MAX_LOGS = 100;

type SemanticItem = {
  id?: unknown;
  semantic?: unknown;
  weight?: unknown;
  retentionScore?: unknown;
  retrievedCount?: unknown;
  archivedAt?: unknown;
};

type MemoryDoc = Record<string, unknown> & {
  id: string;
  semanticItems?: SemanticItem[];
};

type RetrievalLogDoc = Record<string, unknown> & {
  id: string;
};

type NormalizedSemanticItem = {
  id: string;
  semantic: string;
  weight?: number;
  retrievedCount: number;
  archivedAt?: number;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function semanticItemsForDoc(doc: MemoryDoc): NormalizedSemanticItem[] {
  if (doc.schemaVersion === "0.1.2" || typeof doc.episodic === "string") {
    return [
      {
        id: String(doc.id),
        semantic:
          typeof doc.semantic === "string" && doc.semantic.trim()
            ? doc.semantic
            : String(doc.episodic ?? doc.content ?? ""),
        weight: typeof doc.weight === "number" ? doc.weight : undefined,
        retrievedCount:
          typeof doc.retrievedCount === "number" ? doc.retrievedCount : 0,
        archivedAt:
          typeof doc.archivedAt === "number" ? doc.archivedAt : undefined,
      },
    ];
  }
  const semanticItems = Array.isArray(doc.semanticItems)
    ? doc.semanticItems
    : [];
  const semantic = Array.isArray(doc.semantic)
    ? doc.semantic.map(String)
    : [];

  if (semanticItems.length > 0) {
    return semanticItems.map((item, index) => ({
      id: String(item.id ?? `semantic-${index}`),
      semantic: String(item.semantic ?? semantic[index] ?? ""),
      weight:
        typeof (item.weight ?? item.retentionScore) === "number"
          ? Number(item.weight ?? item.retentionScore)
          : undefined,
      retrievedCount:
        typeof item.retrievedCount === "number" ? item.retrievedCount : 0,
      archivedAt:
        typeof item.archivedAt === "number" ? item.archivedAt : undefined,
    }));
  }

  return semantic.map((item, index) => ({
    id: `semantic-${index}`,
    semantic: item,
    retrievedCount: 0,
  }));
}

async function loadMemoryIndex(uid: string, token: string) {
  const docs = (
    await Promise.all(
      [MEMORY_COLLECTION, LEGACY_MEMORY_COLLECTION].map(async (collection) => {
        const ids = await listFirestoreDocumentIds(`users/${uid}/${collection}`, token);
        return Promise.all(
          ids.map(async (id) => {
            const data =
              ((await getFirestoreDocument(
                `users/${uid}/${collection}/${id}`,
                token,
              )) ?? {}) as Record<string, unknown>;
            return { id, ...data } as MemoryDoc;
          }),
        );
      }),
    )
  ).flat();
  const index = new Map<string, ReturnType<typeof semanticItemsForDoc>[number] & {
    memoryId: string;
    source?: unknown;
    timestamp?: unknown;
    keywords?: string[];
  }>();

  docs.forEach((doc) => {
    semanticItemsForDoc(doc).forEach((item) => {
      index.set(doc.schemaVersion === "0.1.2" ? doc.id : `${doc.id}:${item.id}`, {
        ...item,
        memoryId: doc.id,
        source: doc.source,
        timestamp: doc.timestamp ?? doc.occurredAt ?? doc.createdAt,
        keywords: stringArray(doc.keywords),
      });
    });
  });

  return index;
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
  const token = await getFirebaseAccessToken();
  const [logIds, memoryIndex] = await Promise.all([
    listFirestoreDocumentIds(`users/${uid}/${RETRIEVAL_LOG_COLLECTION}`, token),
    loadMemoryIndex(uid, token),
  ]);

  const logs: RetrievalLogDoc[] = await Promise.all(
    logIds.slice(-MAX_LOGS).map(async (id) => {
      const data =
        ((await getFirestoreDocument(
          `users/${uid}/${RETRIEVAL_LOG_COLLECTION}/${id}`,
          token,
        )) ?? {}) as Record<string, unknown>;
      return { id, ...data };
    }),
  );

  return Response.json({
    retrievals: logs
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .map((log) => {
        const retrievedMemoryIds = stringArray(log.retrievedMemoryIds);
        const similarities = numberArray(log.similarities);
        return {
          id: log.id,
          query: String(log.query ?? ""),
          missionId: log.missionId ? String(log.missionId) : null,
          queryEmbeddingModel: String(log.queryEmbeddingModel ?? ""),
          createdAt: Number(log.createdAt ?? 0),
          scoreDeltas: Array.isArray(log.scoreDeltas)
            ? log.scoreDeltas
            : [],
          retrieved: retrievedMemoryIds.map((memoryKey, index) => {
            const item = memoryIndex.get(memoryKey);
            const [memoryId, semanticItemId] = memoryKey.split(":");
            return {
              id: memoryKey,
              memoryId: item?.memoryId ?? memoryId,
              semanticItemId: item?.id ?? semanticItemId,
              semantic: item?.semantic ?? "",
              similarity: similarities[index] ?? null,
              weight: item?.weight ?? null,
              retrievedCount: item?.retrievedCount ?? 0,
              archivedAt: item?.archivedAt ?? null,
              source: item?.source ?? null,
              timestamp: item?.timestamp ?? null,
            };
          }),
        };
      }),
  });
}
