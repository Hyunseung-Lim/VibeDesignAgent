import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  embedMemoryInputs,
  INTERACTION_MEMORY_EMBEDDING_SOURCE,
  MEMORY_EMBEDDING_MODEL,
} from "@/lib/server/memoryEmbedding";
import { archiveDuplicateMemoriesForTargets } from "@/lib/server/memoryForgetting";

export const runtime = "nodejs";
// 임베딩/PATCH 팬아웃이 있는 라우트인데 maxDuration이 없어 플랫폼 기본값에
// 잘리면 세션이 half-promoted 상태로 남는다 (2026-07-25 실제 발생 → 15.337).
export const maxDuration = 120;

const MEMORY_SCHEMA_VERSION = "0.1.2";
const MEMORY_COLLECTION = "memories_0_1_2";
// draft별 Firestore 쓰기 동시성 상한 (drafts 라우트의 enrichReferenceSources
// worker 패턴과 동일한 방식).
const WRITE_CONCURRENCY = 6;

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

  const memoryIdFor = (draftId: string) =>
    `during-session-${sourceId}-${draftId}`;
  const memoryPathFor = (draftId: string) =>
    `users/${user.localId}/${MEMORY_COLLECTION}/${encodeURIComponent(memoryIdFor(draftId))}`;

  // ── 1단계: draft 분류 (쓰기 없음) ─────────────────────────────────────
  // 부분 실패 후 재시도가 이미 승격된 draft를 건너뛰도록 status 기반으로
  // 멱등하게 분류한다. final-design draft만은 finalArtboardId가 시도 사이에
  // 바뀔 수 있으므로 status와 무관하게 항상 현재 선택 기준으로 재평가한다.
  type PromoteJob = {
    draft: (typeof drafts)[number];
    keywords: string[];
    semantic: string;
    episodic: string;
    input: string;
    output: string;
    originalInteractionContent: string;
    timestamp: number;
    embeddingIndex: number;
  };
  const promoteJobs: PromoteJob[] = [];
  const supersededDrafts: Array<(typeof drafts)[number]> = [];
  const skippedEmptyDrafts: Array<(typeof drafts)[number]> = [];
  const promotedMemoryIds: string[] = [];

  for (const draft of drafts) {
    const isFinalDesignDraft =
      draft.id.startsWith("final-design-") ||
      draft.agentActionCategory === "final_design_select";
    const shouldPromoteFinalDesign = finalArtboardId
      ? hasCurrentFinalDraft
        ? draft.id === currentFinalDraftId
        : draft.id === legacyFinalDraftId
      : false;
    if (isFinalDesignDraft && !shouldPromoteFinalDesign) {
      supersededDrafts.push(draft);
      continue;
    }
    if (!isFinalDesignDraft && draft.status === "skipped_empty") {
      continue;
    }
    if (draft.status === "promoted") {
      // 이전 시도에서 이미 승격됨 — 재임베딩/재쓰기 없이 duplicate cleanup
      // 대상에만 포함한다.
      promotedMemoryIds.push(memoryIdFor(draft.id));
      continue;
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
    // Promote whenever the draft carries any usable content, not only when an
    // episodic line exists. Episodic-empty drafts (UI events, final-design
    // selections and legacy semantic-only memories) were previously skipped here yet
    // still marked "promoted" below — so they silently vanished from
    // long-term memory and the agent view while remaining in the session.
    const hasContent = Boolean(
      episodic || semantic || input || output || keywords.length,
    );
    if (!hasContent) {
      skippedEmptyDrafts.push(draft);
      continue;
    }
    promoteJobs.push({
      draft,
      keywords,
      semantic,
      episodic,
      input,
      output,
      originalInteractionContent,
      timestamp,
      embeddingIndex: promoteJobs.length,
    });
  }

  // ── 2단계: 임베딩 배치 1회 ────────────────────────────────────────────
  // 종전에는 draft마다 병렬 OpenAI 호출이었고(15개 세션이면 15회 burst),
  // 하나만 reject해도 보호 없는 Promise.all이 라우트 전체를 죽였다. 배치
  // 실패 시 빈 embedding으로 승격한다 — retrieval/clustering의
  // ensureFreshMemoryEmbeddings가 같은 텍스트 계약으로 재생성해 write-back
  // 하는 자가 치유 경로가 있고, 빈 embedding은 similarity 0으로 안전하다.
  let embeddings: number[][] = [];
  if (promoteJobs.length > 0) {
    try {
      embeddings = await embedMemoryInputs(
        promoteJobs.map((job) => ({
          sourceType: "during_session",
          keyword: job.keywords,
          episodic: job.episodic,
          semantic: job.semantic,
          link: null,
        })),
      );
    } catch (error) {
      console.warn(
        "[memory/complete-session] batch embedding failed, promoting without embeddings",
        error,
      );
      embeddings = [];
    }
  }

  // ── 3단계: draft별 쓰기 (실패 격리 + 동시성 제한) ─────────────────────
  const failures: Array<{ draftId: string; message: string }> = [];
  type WriteUnit = { draftId: string; run: () => Promise<void> };
  const units: WriteUnit[] = [];

  for (const job of promoteJobs) {
    const { draft } = job;
    units.push({
      draftId: draft.id,
      run: async () => {
        const embedding = embeddings[job.embeddingIndex] ?? [];
        await patchFirestoreDocument(
          memoryPathFor(draft.id),
          {
            schemaVersion: String(draft.schemaVersion ?? MEMORY_SCHEMA_VERSION),
            type: "during_session",
            sourceType: "during_session",
            memorySource: "during_session",
            action: String(draft.agentActionCategory ?? "agent_response"),
            keyword: job.keywords,
            keywords: job.keywords,
            episodic: job.episodic,
            episode: job.episodic,
            content: job.episodic,
            ...(job.semantic
              ? { semantic: job.semantic, semanticJson: JSON.stringify([job.semantic]) }
              : {}),
            input: draft.input ?? "",
            output: draft.output ?? "",
            originalInteractionContent: job.originalInteractionContent,
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
            embedding,
            embeddingSource: INTERACTION_MEMORY_EMBEDDING_SOURCE,
            embeddingModel: MEMORY_EMBEDDING_MODEL,
            weight: 0.5,
            retrievedCount: 0,
            lastRetrievedAt: null,
            duplicateOf: null,
            archivedAt: null,
            archiveReason: null,
            timestamp: job.timestamp,
            previousEpisode: draft.previousEpisode ?? "",
            agentActionCategory: draft.agentActionCategory ?? "agent_response",
            preferenceSignal: draft.preferenceSignal ?? null,
            assistantFeedback: draft.assistantFeedback ?? null,
            source: {
              missionId,
              draftId: draft.id,
            },
            createdAt: completedAt,
            ownerUid: user.localId,
          },
          token,
          job.semantic
            ? ["interpretationConfidence"]
            : ["semantic", "semanticJson", "interpretationConfidence"],
        );
        await patchFirestoreDocument(
          `${draftPath}/${draft.id}`,
          { status: "promoted", promotedAt: completedAt },
          token,
        );
        promotedMemoryIds.push(memoryIdFor(draft.id));
      },
    });
  }

  for (const draft of skippedEmptyDrafts) {
    units.push({
      draftId: draft.id,
      run: () =>
        patchFirestoreDocument(
          `${draftPath}/${draft.id}`,
          { status: "skipped_empty", promotedAt: null },
          token,
        ),
    });
  }

  for (const draft of supersededDrafts) {
    units.push({
      draftId: draft.id,
      run: async () => {
        if (draft.status !== "skipped_superseded") {
          await patchFirestoreDocument(
            `${draftPath}/${draft.id}`,
            { status: "skipped_superseded", promotedAt: completedAt },
            token,
          );
        }
        // 이전 시도가 이 draft를 승격한 뒤 finalArtboardId가 바뀐 경우,
        // 옛 최종안 memory가 고아로 남아 세션당 최종안 1개 계약을 깬다.
        // 삭제 대신 archive로 비활성화해 이력을 보존한다.
        const orphan = (await getFirestoreDocument(
          memoryPathFor(draft.id),
          token,
        )) as Record<string, unknown> | null;
        if (orphan && !orphan.archivedAt) {
          await patchFirestoreDocument(
            memoryPathFor(draft.id),
            {
              archivedAt: completedAt,
              archiveReason: "final_design_superseded",
              updatedAt: completedAt,
            },
            token,
          );
        }
      },
    });
  }

  let nextUnitIndex = 0;
  const runNext = async () => {
    while (nextUnitIndex < units.length) {
      const unit = units[nextUnitIndex++];
      try {
        await unit.run();
      } catch (error) {
        console.warn(
          `[memory/complete-session] draft ${unit.draftId} write failed`,
          error,
        );
        failures.push({
          draftId: unit.draftId,
          message: String(error instanceof Error ? error.message : error).slice(
            0,
            300,
          ),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WRITE_CONCURRENCY, units.length) }, () =>
      runNext(),
    ),
  );

  // ── 4단계: 전부 성공했을 때만 세션을 completed로 확정 ─────────────────
  // 일부 draft가 실패했는데 completed로 만들면 남은 draft는 영영 승격되지
  // 않는다(완료 세션은 종료 버튼이 비활성). 실패 시 status를 남겨 두고
  // 명시적 실패를 반환해 재시도가 실패분만 이어서 처리하게 한다.
  if (failures.length > 0) {
    return Response.json(
      {
        error: "promotion_partially_failed",
        failedDrafts: failures,
        promoted: promotedMemoryIds.length,
      },
      { status: 500 },
    );
  }

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
