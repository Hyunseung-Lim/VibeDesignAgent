import OpenAI from "openai";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { archiveDuplicateMemoriesForTargets } from "@/lib/server/memoryForgetting";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_SCHEMA_VERSION = "0.1.2";
const MEMORY_COLLECTION = "memories_0_1_2";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_SOURCE = "during_session_record_text";

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
  const session =
    ((await getFirestoreDocument(sessionPath, token)) ?? {}) as Record<
      string,
      unknown
    >;
  const finalArtboardId = String(session.finalArtboardId ?? "").trim();
  const draftIds = await listFirestoreDocumentIds(draftPath, token);
  const drafts: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    draftIds.map(async (id) => {
      const data = (await getFirestoreDocument(`${draftPath}/${id}`, token)) ?? {};
      return { id, ...(data as Record<string, unknown>) };
    }),
  );
  const completedAt = Date.now();
  const currentFinalDraftId = finalArtboardId
    ? `final-design-selection-${finalArtboardId}`
    : "";
  const legacyFinalDraftId = finalArtboardId
    ? `final-design-${finalArtboardId}`
    : "";
  const hasCurrentFinalDraft = drafts.some(
    (draft) => draft.id === currentFinalDraftId,
  );

  const promotedMemoryIds = (
    await Promise.all(
      drafts.map(async (draft) => {
        const isFinalDesignDraft =
          draft.id.startsWith("final-design-") ||
          draft.agentActionCategory === "final_design_select";
        const shouldPromoteFinalDesign = finalArtboardId
          ? hasCurrentFinalDraft
            ? draft.id === currentFinalDraftId
            : draft.id === legacyFinalDraftId
          : false;
        if (isFinalDesignDraft && !shouldPromoteFinalDesign) {
          await patchFirestoreDocument(
            `${draftPath}/${draft.id}`,
            { status: "skipped_superseded", promotedAt: completedAt },
            token,
          );
          return null;
        }
        const timestamp = Number(draft.timestamp ?? draft.createdAt ?? completedAt);
        const keywords = jsonArray(draft.keywordsJson);
        const semantic =
          String(draft.semantic ?? "").trim() || jsonArray(draft.semanticJson)[0] || "";
        const episodic = String(draft.episode ?? "").trim();
        const input = String(draft.input ?? "").trim();
        const output = String(draft.output ?? "").trim();
        const originalInteractionContent =
          String(draft.originalInteractionContent ?? "").trim() ||
          [`User input:\n${input}`, `Agent output:\n${output}`]
            .filter((section) => !section.endsWith("\n"))
            .join("\n\n");
        // Keep timestamp as metadata only; vector similarity should stay content-based.
        const embeddingText = [
          keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
          episodic ? `Episodic: ${episodic}` : "",
          semantic ? `Semantic: ${semantic}` : "",
          originalInteractionContent
            ? `Original interaction content:\n${originalInteractionContent}`
            : "",
        ].filter(Boolean).join("\n");
        const [embedding] = await embedMemoryTexts(embeddingText ? [embeddingText] : []);
        // Promote whenever the draft carries any usable content, not only when an
        // episodic line exists. Episodic-empty drafts (UI events, final-design
        // selections and legacy semantic-only memories) were previously skipped here yet
        // still marked "promoted" below — so they silently vanished from
        // long-term memory and the agent view while remaining in the session.
        const hasContent = Boolean(
          episodic || semantic || input || output || keywords.length,
        );
        let memoryId: string | null = null;
        if (hasContent) {
          memoryId = `during-session-${sourceId}-${draft.id}`;
          await patchFirestoreDocument(
            `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryId)}`,
            {
              schemaVersion: String(draft.schemaVersion ?? MEMORY_SCHEMA_VERSION),
              type: "during_session",
              sourceType: "during_session",
              memorySource: "during_session",
              action: String(draft.agentActionCategory ?? "agent_response"),
              keyword: keywords,
              keywords,
              episodic,
              episode: episodic,
              content: episodic,
              ...(semantic
                ? { semantic, semanticJson: JSON.stringify([semantic]) }
                : {}),
              input: draft.input ?? "",
              output: draft.output ?? "",
              originalInteractionContent,
              normalizedSourceText: draft.normalizedSourceText ?? "",
              sourceNormalizationVersion:
                draft.sourceNormalizationVersion ?? null,
              sourceNormalizationFingerprint:
                draft.sourceNormalizationFingerprint ?? null,
              normalizedSourceTypesJson:
                draft.normalizedSourceTypesJson ?? "[]",
              sourceNormalizedAt: draft.sourceNormalizedAt ?? null,
              referenceSourceAnalysisVersion:
                draft.referenceSourceAnalysisVersion ?? null,
              referenceSourceAnalysisFingerprintsJson:
                draft.referenceSourceAnalysisFingerprintsJson ?? "[]",
              link: null,
              embedding: embedding ?? [],
              embeddingSource: EMBEDDING_SOURCE,
              embeddingModel: EMBEDDING_MODEL,
              weight: 0.5,
              retrievedCount: 0,
              lastRetrievedAt: null,
              duplicateOf: null,
              archivedAt: null,
              archiveReason: null,
              timestamp,
              previousEpisode: draft.previousEpisode ?? "",
              agentActionCategory: draft.agentActionCategory ?? "agent_response",
              source: {
                missionId,
                draftId: draft.id,
              },
              createdAt: completedAt,
              ownerUid: user.localId,
            },
            token,
            semantic
              ? ["interpretationConfidence"]
              : ["semantic", "semanticJson", "interpretationConfidence"],
          );
        }
        await patchFirestoreDocument(
          `${draftPath}/${draft.id}`,
          hasContent
            ? { status: "promoted", promotedAt: completedAt }
            : { status: "skipped_empty", promotedAt: null },
          token,
        );
        return memoryId;
      }),
    )
  ).filter((id): id is string => Boolean(id));

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

  let duplicateCleanup:
    | { archived: number; error?: undefined }
    | { archived: 0; error: string } = { archived: 0 };
  try {
    const archived = await archiveDuplicateMemoriesForTargets(
      user.localId,
      promotedMemoryIds,
      token,
    );
    duplicateCleanup = { archived: archived.length };
  } catch (error) {
    console.warn("[memory/complete-session] duplicate cleanup failed", error);
    duplicateCleanup = {
      archived: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return Response.json({
    ok: true,
    promoted: promotedMemoryIds.length,
    completedAt,
    duplicateCleanup,
  });
}
