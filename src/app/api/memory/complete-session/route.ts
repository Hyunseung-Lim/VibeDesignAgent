import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MEMORY_SCHEMA_VERSION = "0.1.1";
const MEMORY_COLLECTION = "memories_0_1_1";

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

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    missionId?: string;
    sessionRunId?: string | null;
  };
  const missionId = body.missionId?.trim();
  const sessionRunId = body.sessionRunId?.trim() || undefined;
  if (!missionId) return Response.json({ error: "missionId required" }, { status: 400 });

  const token = await getFirebaseAccessToken();
  const sessionPath = sessionRunId
    ? `sessions/${user.localId}/missionRuns/${encodeURIComponent(sessionRunId)}`
    : `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}`;
  const sourceId = sessionRunId ?? missionId;
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
      const semantic = jsonArray(draft.semanticJson);
      const episode = String(draft.episode ?? "");
      const base = {
        sourceDraftId: draft.id,
        sourceMissionId: missionId,
        sourceSessionRunId: sessionRunId ?? null,
        input: draft.input ?? "",
        output: draft.output ?? "",
        timestamp,
        categoryJson: draft.categoryJson ?? "[]",
        subcategoryJson: draft.subcategoryJson ?? "[]",
        keywordsJson: JSON.stringify(keywords),
        createdAt: completedAt,
      };
      await patchFirestoreDocument(
        `users/${user.localId}/episodicMemories/${encodeURIComponent(`${sourceId}-${draft.id}`)}`,
        { ...base, episode },
        token,
      );
      if (semantic.length > 0 || (typeof draft.semantic === "string" && draft.semantic.trim())) {
        await patchFirestoreDocument(
          `users/${user.localId}/semanticMemories/${encodeURIComponent(`${sourceId}-${draft.id}`)}`,
          { ...base, semantic: semantic.join("\n") || draft.semantic },
          token,
        );
      }
      if (episode.trim() || semantic.length > 0) {
        await patchFirestoreDocument(
          `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(`interaction-${sourceId}-${draft.id}`)}`,
          {
            schemaVersion: String(draft.schemaVersion ?? MEMORY_SCHEMA_VERSION),
            type: "interaction",
            content: episode,
            keywords,
            semantic,
            input: draft.input ?? "",
            output: draft.output ?? "",
            timestamp,
            previousEpisode: draft.previousEpisode ?? "",
            previousOutput: draft.previousOutput ?? "",
            agentActionCategory: draft.agentActionCategory ?? "agent_response",
            source: {
              missionId,
              sessionRunId: sessionRunId ?? null,
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
      sessionRunId: sessionRunId ?? null,
      status: "completed",
      endedAt: completedAt,
      updatedAt: completedAt,
    },
    token,
  );
  return Response.json({ ok: true, promoted: drafts.length, completedAt });
}
