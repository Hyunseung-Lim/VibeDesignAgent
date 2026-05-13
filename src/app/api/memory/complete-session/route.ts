import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { missionId?: string };
  const missionId = body.missionId?.trim();
  if (!missionId) return Response.json({ error: "missionId required" }, { status: 400 });

  const token = await getFirebaseAccessToken();
  const draftPath = `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}/memoryDrafts`;
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
      const base = {
        sourceDraftId: draft.id,
        sourceMissionId: missionId,
        input: draft.input ?? "",
        output: draft.output ?? "",
        timestamp: Number(draft.timestamp ?? draft.createdAt ?? completedAt),
        categoryJson: draft.categoryJson ?? "[]",
        subcategoryJson: draft.subcategoryJson ?? "[]",
        keywordsJson: draft.keywordsJson ?? "[]",
        createdAt: completedAt,
      };
      await patchFirestoreDocument(
        `users/${user.localId}/episodicMemories/${encodeURIComponent(`${missionId}-${draft.id}`)}`,
        { ...base, episode: draft.episode ?? "" },
        token,
      );
      if (typeof draft.semantic === "string" && draft.semantic.trim()) {
        await patchFirestoreDocument(
          `users/${user.localId}/semanticMemories/${encodeURIComponent(`${missionId}-${draft.id}`)}`,
          { ...base, semantic: draft.semantic },
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
    `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}`,
    { status: "completed", endedAt: completedAt, updatedAt: completedAt },
    token,
  );
  return Response.json({ ok: true, promoted: drafts.length, completedAt });
}
