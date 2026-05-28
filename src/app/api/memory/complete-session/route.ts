import OpenAI from "openai";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_SCHEMA_VERSION = "0.1.2";
const MEMORY_COLLECTION = "memories_0_1_2";
const EMBEDDING_MODEL = "text-embedding-3-large";

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

async function embedMemoryTexts(texts: string[]) {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => l2Normalize(item.embedding));
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { missionId?: string };
  const missionId = body.missionId?.trim();
  if (!missionId) return Response.json({ error: "missionId required" }, { status: 400 });

  const token = await getFirebaseAccessToken();
  const sessionPath = `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}`;
  const sourceId = missionId;
  const draftPath = `${sessionPath}/memoryDrafts`;
  const draftIds = await listFirestoreDocumentIds(draftPath, token);
  const drafts: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    draftIds.map(async (id) => {
      const data = (await getFirestoreDocument(`${draftPath}/${id}`, token)) ?? {};
      return { id, ...(data as Record<string, unknown>) };
    }),
  );
  const completedAt = Date.now();

  await Promise.all(
    drafts.map(async (draft) => {
      const timestamp = Number(draft.timestamp ?? draft.createdAt ?? completedAt);
      const keywords = jsonArray(draft.keywordsJson);
      const semantic =
        String(draft.semantic ?? "").trim() || jsonArray(draft.semanticJson)[0] || "";
      const episodic = String(draft.episode ?? "").trim();
      const action = String(draft.agentActionCategory ?? "agent_response");
      const input = String(draft.input ?? "").trim();
      const output = String(draft.output ?? "").trim();
      const embeddingText = [
        action ? `Action: ${action}` : "",
        keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
        episodic ? `Episodic: ${episodic}` : "",
        semantic ? `Semantic: ${semantic}` : "",
        input ? `Input: ${input}` : "",
        output ? `Output: ${output}` : "",
      ].filter(Boolean).join("\n");
      const [embedding] = await embedMemoryTexts(embeddingText ? [embeddingText] : []);
      if (episodic) {
        await patchFirestoreDocument(
          `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(`interaction-${sourceId}-${draft.id}`)}`,
          {
            schemaVersion: String(draft.schemaVersion ?? MEMORY_SCHEMA_VERSION),
            type: "interaction",
            action: String(draft.agentActionCategory ?? "agent_response"),
            keyword: keywords,
            keywords,
            episodic,
            episode: episodic,
            content: episodic,
            semantic: semantic || null,
            input: draft.input ?? "",
            output: draft.output ?? "",
            link: null,
            embedding: embedding ?? [],
            embeddingSource: "combined",
            embeddingModel: EMBEDDING_MODEL,
            weight: 0.5,
            retrievedCount: 0,
            lastRetrievedAt: null,
            duplicateOf: null,
            archivedAt: null,
            archiveReason: null,
            timestamp,
            previousEpisode: draft.previousEpisode ?? "",
            previousOutput: draft.previousOutput ?? "",
            agentActionCategory: draft.agentActionCategory ?? "agent_response",
            source: {
              missionId,
              draftId: draft.id,
            },
            createdAt: completedAt,
            ownerUid: user.localId,
          },
          token,
        );
      }
      await patchFirestoreDocument(
        `${draftPath}/${draft.id}`,
        { status: "promoted", promotedAt: completedAt },
        token,
      );
    }),
  );

  await patchFirestoreDocument(
    sessionPath,
    {
      missionId,
      status: "completed",
      endedAt: completedAt,
      updatedAt: completedAt,
    },
    token,
  );
  return Response.json({ ok: true, promoted: drafts.length, completedAt });
}
