import OpenAI from "openai";
import { createHash } from "crypto";
import { isAdminEmail } from "@/lib/admin";
import {
  deleteFirestoreDocument,
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { PROFILE_MEMORY_DERIVE_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_COLLECTION = "memories_0_1_2";
const PROFILE_MEMORY_SCHEMA_VERSION = "0.1.2-profile";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_SOURCE = "combined_no_timestamp";
const PROFILE_MEMORY_MAX_ITEMS = 5;
const PROFILE_MEMORY_MAX_CHARS = 240;
const PROFILE_MEMORY_MAX_RAW_CHARS = 6000;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateProfileInput(value: string) {
  return value.slice(0, PROFILE_MEMORY_MAX_CHARS);
}

function numberOrNow(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

type ProfileMemoryItem = {
  id: string;
  input: string;
  createdAt: number;
  updatedAt: number;
};

type DerivedProfileMemory = {
  keywords: string[];
  episodic: string;
  semantic: string | null;
};

function sanitizeItem(raw: unknown): ProfileMemoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const input = stringOrNull(item.input);
  const id = stringOrNull(item.id);
  if (!input || !id) return null;
  return {
    id,
    input: truncateProfileInput(input),
    createdAt: numberOrNow(item.createdAt),
    updatedAt: numberOrNow(item.updatedAt),
  };
}

function isProfileMemoryItem(item: ProfileMemoryItem | null): item is ProfileMemoryItem {
  return Boolean(item);
}

function itemsChanged(
  previousItems: ProfileMemoryItem[],
  nextItems: ProfileMemoryItem[],
  previousRawMarkdown: string,
  nextRawMarkdown: string,
) {
  return (
    JSON.stringify(previousItems.map(({ id, input }) => ({ id, input }))) !==
      JSON.stringify(nextItems.map(({ id, input }) => ({ id, input }))) ||
    previousRawMarkdown !== nextRawMarkdown
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => l2Normalize(item.embedding));
}

function buildEmbeddingText(memory: DerivedProfileMemory, rawInput: string) {
  // Keep profile revision timestamps as metadata only; vectors use semantic content.
  return [
    memory.keywords.length ? `Keywords: ${memory.keywords.join(", ")}` : "",
    memory.episodic ? `Episodic: ${memory.episodic}` : "",
    memory.semantic ? `Semantic: ${memory.semantic}` : "",
    rawInput ? `Input: ${rawInput}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDerivedProfileMemory(raw: string): DerivedProfileMemory[] {
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map((item) => {
        const record = item as Record<string, unknown>;
        const episodic = String(record.episodic ?? record.episode ?? "").trim();
        const semantic =
          typeof record.semantic === "string" && record.semantic.trim()
            ? record.semantic.trim()
            : null;
        if (!episodic && !semantic) return null;
        return {
          keywords: stringArray(record.keywords ?? record.keyword).slice(0, 6),
          episodic: episodic.slice(0, 1200),
          semantic: semantic?.slice(0, 1200) ?? null,
        };
      })
      .filter((item): item is DerivedProfileMemory => Boolean(item))
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function deriveProfileMemories(rawMarkdown: string) {
  const input = rawMarkdown.trim().slice(0, PROFILE_MEMORY_MAX_RAW_CHARS);
  if (!input) return [];
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROFILE_MEMORY_DERIVE_PROMPT },
      { role: "user", content: input },
    ],
  });
  return parseDerivedProfileMemory(
    completion.choices[0]?.message?.content ?? "{}",
  );
}

async function deleteProfileDerivedMemories(
  uid: string,
  missionId: string,
  token: string,
) {
  const ids = await listFirestoreDocumentIds(
    `users/${uid}/${MEMORY_COLLECTION}`,
    token,
  );
  await Promise.all(
    ids.map(async (id) => {
      const path = `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`;
      const doc = (await getFirestoreDocument(path, token)) as Record<
        string,
        unknown
      > | null;
      const source = doc?.source as Record<string, unknown> | undefined;
      const isProfileForMission =
        (doc?.sourceType === "profile" || doc?.memorySource === "profile") &&
        source?.missionId === missionId;
      if (isProfileForMission) await deleteFirestoreDocument(path, token);
    }),
  );
}

async function writeProfileDerivedMemories(
  uid: string,
  missionId: string,
  rawMarkdown: string,
  items: ProfileMemoryItem[],
  token: string,
  now: number,
) {
  await deleteProfileDerivedMemories(uid, missionId, token);
  const derived = await deriveProfileMemories(rawMarkdown);
  if (derived.length === 0) return { count: 0, ids: [] as string[] };
  const embeddings = await embedTexts(
    derived.map((memory) => buildEmbeddingText(memory, rawMarkdown)),
  );
  const ids = await Promise.all(
    derived.map(async (memory, index) => {
      const id = `profile-${missionId}-${stableHash(
        `${index}:${memory.episodic}:${memory.semantic ?? ""}`,
      )}`;
      await patchFirestoreDocument(
        `users/${uid}/${MEMORY_COLLECTION}/${encodeURIComponent(id)}`,
        {
          schemaVersion: PROFILE_MEMORY_SCHEMA_VERSION,
          type: "profile",
          sourceType: "profile",
          memorySource: "profile",
          action: "",
          agentActionCategory: "",
          keyword: memory.keywords,
          keywords: memory.keywords,
          episodic: memory.episodic,
          episode: memory.episodic,
          content: memory.episodic,
          semantic: memory.semantic,
          input: rawMarkdown.slice(0, PROFILE_MEMORY_MAX_RAW_CHARS),
          output: "",
          link: null,
          embedding: embeddings[index] ?? [],
          embeddingSource: EMBEDDING_SOURCE,
          embeddingModel: EMBEDDING_MODEL,
          weight: 0.5,
          retrievedCount: 0,
          lastRetrievedAt: null,
          duplicateOf: null,
          archivedAt: null,
          archiveReason: null,
          timestamp: now,
          source: {
            kind: "user_profile",
            missionId,
            profileItemIds: items.map((item) => item.id),
          },
          createdAt: now,
          ownerUid: uid,
        },
        token,
      );
      return id;
    }),
  );
  return { count: ids.length, ids };
}

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const missionId = url.searchParams.get("missionId");
  if (!missionId?.trim()) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const requestedTargetUid = url.searchParams.get("targetUid");
  const includeRevisions = url.searchParams.get("includeRevisions") === "1";
  const targetUid = requestedTargetUid ?? user.localId;
  if (targetUid !== user.localId && !isAdminEmail(user.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const doc = (await getFirestoreDocument(
    `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}`,
    token,
  )) as Record<string, unknown> | null;

  const items = Array.isArray(doc?.items)
    ? doc.items.map(sanitizeItem).filter(isProfileMemoryItem)
    : [];

  const revisions = includeRevisions
    ? (
        await Promise.all(
          (
            await listFirestoreDocumentIds(
              `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}/revisions`,
              token,
            )
          ).map(async (id) => {
            const revision =
              ((await getFirestoreDocument(
                `users/${targetUid}/profile_memories/${encodeURIComponent(missionId)}/revisions/${encodeURIComponent(id)}`,
                token,
              )) ?? {}) as Record<string, unknown>;
            return { id, ...revision };
          }),
        )
      ).sort(
        (a, b) =>
          Number((b as Record<string, unknown>).createdAt ?? 0) -
          Number((a as Record<string, unknown>).createdAt ?? 0),
      )
    : undefined;

  return Response.json({
    missionId,
    items,
    rawMarkdown: stringOrNull(doc?.rawMarkdown) ?? "",
    revisions,
  });
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const missionId = stringOrNull(body.missionId);
  if (!missionId) {
    return Response.json({ error: "missionId required" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map(sanitizeItem)
    .filter(isProfileMemoryItem)
    .slice(0, PROFILE_MEMORY_MAX_ITEMS);
  const rawMarkdown =
    stringOrNull(body.rawMarkdown) ??
    stringOrNull(body.markdown) ??
    items.map((item) => `- ${item.input}`).join("\n");

  const token = await getFirebaseAccessToken();
  const documentPath = `users/${user.localId}/profile_memories/${encodeURIComponent(missionId)}`;
  const previousDoc = (await getFirestoreDocument(
    documentPath,
    token,
  )) as Record<string, unknown> | null;
  const previousItems = Array.isArray(previousDoc?.items)
    ? previousDoc.items.map(sanitizeItem).filter(isProfileMemoryItem)
    : [];
  const now = Date.now();
  const nextRawMarkdown = rawMarkdown.slice(0, PROFILE_MEMORY_MAX_RAW_CHARS);
  const previousRawMarkdown = stringOrNull(previousDoc?.rawMarkdown) ?? "";

  await patchFirestoreDocument(
    documentPath,
    {
      missionId,
      items,
      rawMarkdown: nextRawMarkdown,
      updatedAt: now,
    },
    token,
  );

  let revisionId: string | null = null;
  if (itemsChanged(previousItems, items, previousRawMarkdown, nextRawMarkdown)) {
    revisionId = String(now);
    await patchFirestoreDocument(
      `${documentPath}/revisions/${revisionId}`,
      {
        missionId,
        previousItems,
        nextItems: items,
        previousRawMarkdown,
        nextRawMarkdown,
        previousCount: previousItems.length,
        nextCount: items.length,
        createdAt: now,
        actorUid: user.localId,
        source: "session-start-profile-upsert",
      },
      token,
    );
  }

  let derivedResult: { count: number; ids: string[]; error?: string } = {
    count: 0,
    ids: [],
  };
  try {
    derivedResult = await writeProfileDerivedMemories(
      user.localId,
      missionId,
      rawMarkdown,
      items,
      token,
      now,
    );
  } catch (error) {
    console.warn("[memory/profile] failed to write derived memories", error);
    derivedResult = {
      count: 0,
      ids: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return Response.json({
    ok: true,
    missionId,
    count: items.length,
    rawMarkdown: nextRawMarkdown,
    derivedCount: derivedResult.count,
    derivedMemoryIds: derivedResult.ids,
    derivedError: derivedResult.error,
    revisionId,
  });
}
