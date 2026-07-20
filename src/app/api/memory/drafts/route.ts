import OpenAI from "openai";
import { after } from "next/server";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  MEMORY_ENCODE_PROMPT,
  MEMORY_FEEDBACK_ENCODE_ADDENDUM,
} from "@/lib/prompts";
import type { MemoryDraftSources } from "@/lib/memory-sources";
import type { FinalDesignEnrichmentPayload } from "@/lib/memory-final-design";
import { buildFinalDesignMemoryInput } from "@/lib/server/finalDesignMemoryInput";
import {
  MEMORY_SOURCE_NORMALIZATION_VERSION,
  memorySourceFingerprint,
  normalizeMemorySources,
} from "@/lib/server/memorySourceNormalization";
import {
  REFERENCE_SOURCE_ANALYSIS_VERSION,
  analyzeReferenceSource,
  referenceSourceAnalysisFingerprint,
} from "@/lib/server/referenceSourceAnalysis";
import {
  applyAssistantFeedbackWeightAdjustment,
  type AssistantFeedbackWeightAdjustment,
} from "@/lib/server/memoryFeedbackWeights";

export const runtime = "nodejs";
export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_SCHEMA_VERSION = "0.1.2";
const FIRST_SESSION_TURN = "This is the first turn of this session.";

type AssistantFeedbackMemoryPayload = {
  vote?: "good" | "bad";
  reason?: string | null;
  targetMessageId?: string | null;
  targetUserMessageId?: string | null;
  targetActionCategory?: string | null;
};

type EncodedMemory = {
  keywords: string[];
  episode: string;
  semantic: string | null;
};

function stringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
}

function jsonStringArray(value: unknown) {
  if (Array.isArray(value)) return stringArray(value);
  if (typeof value !== "string") return [];
  try {
    return stringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseMemory(raw: string): EncodedMemory {
  try {
    const parsed = JSON.parse(raw) as Partial<EncodedMemory>;
    const semantic =
      typeof parsed.semantic === "string"
        ? parsed.semantic.trim()
        : Array.isArray(parsed.semantic)
          ? stringArray(parsed.semantic)[0]
          : null;
    return {
      keywords: stringArray(parsed.keywords, [
        "conversation",
        "request",
        "response",
      ]).slice(0, 10),
      episode: String(parsed.episode ?? "").trim(),
      semantic: semantic || null,
    };
  } catch {
    return {
      keywords: ["conversation", "request", "response"],
      episode: "",
      semantic: null,
    };
  }
}

type AgentAction = { type: string; content: string };

function extractBracketContent(output: string, tag: string): string | null {
  const marker = `[${tag}:`;
  const idx = output.indexOf(marker);
  if (idx === -1) return null;
  let depth = 1;
  let i = idx + marker.length;
  const start = i;
  while (i < output.length && depth > 0) {
    if (output[i] === "[") depth++;
    else if (output[i] === "]") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return output.slice(start, i - 1).trim();
}

function extractAgentActions(output: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const bracketTags: Array<[string, string]> = [
    ["mockup_generate", "GENERATE_MOCKUP"],
    ["mockup_edit", "EDIT_MOCKUP"],
    ["note_create", "CREATE_NOTE"],
    ["note_update", "UPDATE_NOTE"],
    ["references_fetch", "FETCH_REFERENCES"],
    ["design_spec_create", "CREATE_DESIGN_SPEC"],
    ["design_spec_edit", "EDIT_DESIGN_SPEC"],
  ];
  for (const [type, tag] of bracketTags) {
    const content = extractBracketContent(output, tag);
    if (content != null)
      actions.push({ type, content: content.slice(0, 1200) });
  }
  const presMatch = output.match(/```presentation\n([\s\S]{0,2000}?)\n```/);
  if (presMatch)
    actions.push({
      type: "presentation_create",
      content: presMatch[1].trim().slice(0, 1200),
    });
  return actions;
}

function inferAgentActionCategory(output: string, interactionId: string) {
  if (/\[CREATE_NOTE:/i.test(output)) return "note_create";
  if (/\[UPDATE_NOTE:/i.test(output)) return "note_update";
  if (/\[GENERATE_MOCKUP:/i.test(output)) return "mockup_generate";
  if (/\[EDIT_MOCKUP:/i.test(output)) return "mockup_edit";
  if (/\[CREATE_DESIGN_SPEC:/i.test(output)) return "design_spec_create";
  if (/\[EDIT_DESIGN_SPEC:/i.test(output)) return "design_spec_edit";
  if (/\[FETCH_REFERENCES:/i.test(output)) return "references_fetch";
  if (/```(?:json)?\s*\{[\s\S]*?"slides"/i.test(output))
    return "presentation_create";
  if (interactionId.startsWith("delete-idea-")) return "note_delete";
  if (interactionId.startsWith("delete-design-")) return "mockup_delete";
  if (interactionId.startsWith("fetch-reference-")) return "references_fetch";
  if (interactionId.startsWith("cite-reference-")) return "reference_cite";
  if (interactionId.startsWith("delete-reference-")) return "reference_delete";
  if (interactionId.startsWith("final-design-")) return "final_design_select";
  if (interactionId.startsWith("style-image-preference-"))
    return "style_image_preference";
  return "agent_response";
}

function timestampContext(value: unknown) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return `${timestamp} (${new Date(timestamp).toISOString()})`;
}

async function loadPreviousDrafts(
  uid: string,
  missionId: string,
  timestamp: number,
  token: string,
) {
  const draftPath = `sessions/${uid}/missions/${encodeURIComponent(missionId)}/memoryDrafts`;
  const ids = await listFirestoreDocumentIds(draftPath, token);
  const drafts: Array<Record<string, unknown> & { id: string }> =
    await Promise.all(
      ids.map(async (id) => {
        const data =
          (await getFirestoreDocument(`${draftPath}/${id}`, token)) ?? {};
        return { id, ...(data as Record<string, unknown>) };
      }),
    );
  return drafts
    .filter(
      (draft) => Number(draft.timestamp ?? draft.createdAt ?? 0) < timestamp,
    )
    .sort(
      (a, b) =>
        Number(b.timestamp ?? b.createdAt ?? 0) -
        Number(a.timestamp ?? a.createdAt ?? 0),
    )
    .slice(0, 2);
}

async function enrichReferenceSources(
  uid: string,
  sources: MemoryDraftSources | undefined,
  token: string,
) {
  const links = sources?.links ?? [];
  if (links.length === 0) {
    return { sources, analysisFingerprints: [] as string[] };
  }

  const boundedLinks = links.slice(0, 8);
  const enrichedLinks: typeof boundedLinks = new Array(boundedLinks.length);
  const analysisFingerprints: string[] = new Array(boundedLinks.length);
  let nextIndex = 0;
  const analyzeNext = async () => {
    while (nextIndex < boundedLinks.length) {
      const index = nextIndex++;
      const link = boundedLinks[index];
      const fingerprint = referenceSourceAnalysisFingerprint(link);
      analysisFingerprints[index] = fingerprint;
      const analysisPath = `users/${uid}/referenceSourceAnalyses/${fingerprint}`;
      const cached = await getFirestoreDocument(analysisPath, token);
      const canReuse =
        cached?.analysisVersion === REFERENCE_SOURCE_ANALYSIS_VERSION &&
        typeof cached?.analysisText === "string" &&
        String(cached.analysisText).trim();
      const analysis = canReuse
        ? String(cached.analysisText)
        : await analyzeReferenceSource(link);
      if (!canReuse) {
        await patchFirestoreDocument(
          analysisPath,
          {
            analysisVersion: REFERENCE_SOURCE_ANALYSIS_VERSION,
            fingerprint,
            url: String(link.url ?? "").slice(0, 2000),
            imageUrl: String(link.imageUrl ?? "").slice(0, 2000),
            referenceMode: link.referenceMode ?? "",
            searchProvider: link.searchProvider ?? "",
            analysisText: analysis,
            analyzedAt: Date.now(),
          },
          token,
        );
      }
      enrichedLinks[index] = { ...link, analysis };
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(2, boundedLinks.length) },
      () => analyzeNext(),
    ),
  );

  return {
    sources: { ...sources, links: enrichedLinks },
    analysisFingerprints,
  };
}

type AssistantFeedback = {
  vote: "good" | "bad";
  reason: string;
  targetMessageId: string;
  targetUserMessageId: string;
  targetActionCategory: string;
};

async function encodeAndSaveDraft(params: {
  uid: string;
  missionId: string;
  interactionId: string;
  fallbackInput: string;
  output: string;
  createdAt: number;
  timestamp: number;
  draftPath: string;
  sources: MemoryDraftSources | undefined;
  finalDesign: FinalDesignEnrichmentPayload | undefined;
  assistantFeedback: AssistantFeedback | null;
}) {
  const {
    uid,
    missionId,
    interactionId,
    fallbackInput,
    output,
    createdAt,
    timestamp,
    draftPath,
    sources,
    finalDesign,
    assistantFeedback,
  } = params;

  // Final-design selection turns carry the compared candidate mockups
  // and the session chat. Run the input-enrichment pass so the encoded
  // memory reflects the candidate comparison and the user's expressed
  // preference instead of a bare label. Best-effort: fall back to the
  // provided input on failure.
  const enrichedInput = finalDesign
    ? await buildFinalDesignMemoryInput(finalDesign)
    : null;
  const input = enrichedInput || fallbackInput;

  const token = await getFirebaseAccessToken();
  const existingDraft = await getFirestoreDocument(draftPath, token);
  const enriched = await enrichReferenceSources(uid, sources, token);
  const sourceFingerprint = memorySourceFingerprint(
    enriched.sources,
    input,
    output,
  );
  const canReuseNormalizedSources =
    existingDraft?.sourceNormalizationVersion ===
      MEMORY_SOURCE_NORMALIZATION_VERSION &&
    existingDraft?.sourceNormalizationFingerprint === sourceFingerprint &&
    typeof existingDraft?.normalizedSourceText === "string";
  const normalizedSources = canReuseNormalizedSources
    ? {
        text: String(existingDraft.normalizedSourceText),
        sourceTypes: jsonStringArray(existingDraft.normalizedSourceTypesJson),
      }
    : await normalizeMemorySources(enriched.sources, input, output);
  const [previousDraft, olderDraft] = await loadPreviousDrafts(
    uid,
    missionId,
    timestamp,
    token,
  );
  const inferredAgentActionCategory = inferAgentActionCategory(
    output,
    interactionId,
  );
  const agentActionCategory =
    assistantFeedback?.targetActionCategory || inferredAgentActionCategory;
  const agentActions = assistantFeedback ? [] : extractAgentActions(output);
  const originalInteractionContent = [
    `User input:\n${input}`,
    normalizedSources.text
      ? `Normalized source context:\n${normalizedSources.text}`
      : "",
    `Agent output:\n${output.slice(0, 10000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const previousEpisodes = [
    String(previousDraft?.episode ?? "").trim(),
    String(olderDraft?.episode ?? "").trim(),
  ].filter(Boolean);
  const content = [
    `current interaction timestamp: ${timestampContext(timestamp) || "unknown"}`,
    previousDraft
      ? `previous interaction timestamp: ${timestampContext(previousDraft.timestamp ?? previousDraft.createdAt) || "unknown"}`
      : "",
    olderDraft
      ? `older interaction timestamp: ${timestampContext(olderDraft.timestamp ?? olderDraft.createdAt) || "unknown"}`
      : "",
    `previous episodic memory: ${previousEpisodes.join(" / ") || FIRST_SESSION_TURN}`,
    `original interaction content:\n${originalInteractionContent}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: assistantFeedback
          ? `${MEMORY_ENCODE_PROMPT}\n\n${MEMORY_FEEDBACK_ENCODE_ADDENDUM}`
          : MEMORY_ENCODE_PROMPT,
      },
      { role: "user", content },
    ],
  });
  const encoded = parseMemory(completion.choices[0]?.message?.content ?? "{}");
  const previousAssistantFeedbackWeightAdjustment =
    existingDraft?.assistantFeedbackWeightAdjustment &&
    typeof existingDraft.assistantFeedbackWeightAdjustment === "object" &&
    !Array.isArray(existingDraft.assistantFeedbackWeightAdjustment)
      ? (existingDraft.assistantFeedbackWeightAdjustment as AssistantFeedbackWeightAdjustment)
      : null;
  const assistantFeedbackWeightAdjustment = assistantFeedback
    ? await applyAssistantFeedbackWeightAdjustment({
        uid,
        missionId,
        vote: assistantFeedback.vote,
        targetMessageId: assistantFeedback.targetMessageId || null,
        targetUserMessageId: assistantFeedback.targetUserMessageId || null,
        previousAdjustment: previousAssistantFeedbackWeightAdjustment,
        token,
        now: createdAt,
      }).catch((error) => {
        console.warn(
          "[memory/drafts] assistant feedback weight adjustment failed",
          error,
        );
        return previousAssistantFeedbackWeightAdjustment;
      })
    : null;
  await patchFirestoreDocument(
    draftPath,
    {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      missionId,
      interactionId,
      input: input.slice(0, 8000),
      output: output.slice(0, 12000),
      originalInteractionContent: originalInteractionContent.slice(0, 20000),
      normalizedSourceText: normalizedSources.text,
      sourceNormalizationVersion: MEMORY_SOURCE_NORMALIZATION_VERSION,
      sourceNormalizationFingerprint: sourceFingerprint,
      normalizedSourceTypesJson: JSON.stringify(normalizedSources.sourceTypes),
      referenceSourceAnalysisVersion: REFERENCE_SOURCE_ANALYSIS_VERSION,
      referenceSourceAnalysisFingerprintsJson: JSON.stringify(
        enriched.analysisFingerprints,
      ),
      sourceNormalizedAt: canReuseNormalizedSources
        ? Number(existingDraft?.sourceNormalizedAt ?? createdAt)
        : createdAt,
      timestamp,
      keywordsJson: JSON.stringify(encoded.keywords),
      episode: encoded.episode.slice(0, 2000),
      semanticJson: JSON.stringify(
        encoded.semantic ? [encoded.semantic.slice(0, 2000)] : [],
      ),
      semantic: encoded.semantic?.slice(0, 2000) ?? "",
      previousEpisode: String(previousDraft?.episode ?? "").slice(0, 2000),
      agentActionCategory,
      agentActionsJson: JSON.stringify(agentActions),
      assistantFeedback: assistantFeedback
        ? {
            vote: assistantFeedback.vote,
            reason: assistantFeedback.reason,
            targetMessageId: assistantFeedback.targetMessageId,
            targetUserMessageId: assistantFeedback.targetUserMessageId,
            targetActionCategory: assistantFeedback.targetActionCategory,
          }
        : null,
      preferenceSignal: assistantFeedback
        ? {
            kind: "assistant_feedback",
            vote: assistantFeedback.vote,
            reason: assistantFeedback.reason,
            targetMessageId: assistantFeedback.targetMessageId,
            targetUserMessageId: assistantFeedback.targetUserMessageId,
            targetActionCategory: agentActionCategory,
          }
        : null,
      assistantFeedbackWeightAdjustment,
      status: "draft",
      createdAt,
      lastRequestId: createdAt,
    },
    token,
    ["interpretationConfidence"],
  );
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    missionId?: string;
    interactionId?: string;
    input?: string;
    output?: string;
    timestamp?: number;
    sources?: MemoryDraftSources;
    finalDesign?: FinalDesignEnrichmentPayload;
    assistantFeedback?: AssistantFeedbackMemoryPayload;
  };
  const missionId = body.missionId?.trim();
  const interactionId = body.interactionId?.trim();
  const fallbackInput = body.input?.trim() ?? "";
  const output = body.output?.trim() ?? "";
  if (!missionId || !interactionId || !fallbackInput || !output) {
    return Response.json(
      { error: "missionId, interactionId, input, and output required" },
      { status: 400 },
    );
  }

  const assistantFeedback: AssistantFeedback | null =
    body.assistantFeedback?.vote === "good" ||
    body.assistantFeedback?.vote === "bad"
      ? {
          vote: body.assistantFeedback.vote,
          reason:
            typeof body.assistantFeedback.reason === "string"
              ? body.assistantFeedback.reason.trim().slice(0, 2000)
              : "",
          targetMessageId:
            typeof body.assistantFeedback.targetMessageId === "string"
              ? body.assistantFeedback.targetMessageId
              : "",
          targetUserMessageId:
            typeof body.assistantFeedback.targetUserMessageId === "string"
              ? body.assistantFeedback.targetUserMessageId
              : "",
          targetActionCategory:
            typeof body.assistantFeedback.targetActionCategory === "string"
              ? body.assistantFeedback.targetActionCategory
              : "",
        }
      : null;

  const createdAt = Date.now();
  const timestamp = Number(body.timestamp ?? createdAt);
  const draftPath = `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}/memoryDrafts/${encodeURIComponent(interactionId)}`;

  const pipelineParams = {
    uid: user.localId,
    missionId,
    interactionId,
    fallbackInput,
    output,
    createdAt,
    timestamp,
    draftPath,
    sources: body.sources,
    finalDesign: body.finalDesign,
    assistantFeedback,
  };

  // Only the assistant-feedback (따봉/봉따) submission defers encoding to
  // `after()` — that's the path with a UI dialog blocking on this request.
  // Every other caller (final-design selection, note/reference edits, ...)
  // keeps the original synchronous behavior: callers like completeSession
  // immediately read the memoryDrafts collection afterward (see
  // /api/memory/complete-session), so `ok: true` must still mean the draft
  // is durably written, not just "accepted."
  if (assistantFeedback) {
    after(async () => {
      try {
        await encodeAndSaveDraft(pipelineParams);
      } catch (error) {
        console.error("[memory/drafts] background encode failed", error);
        // Record the failure on the draft doc so a client that's still
        // polling it (see watchMemoryDraftFailure in page.tsx) can show a
        // real-time toast instead of silently losing the submission.
        try {
          const token = await getFirebaseAccessToken();
          await patchFirestoreDocument(
            draftPath,
            {
              status: "failed",
              lastRequestId: createdAt,
              errorMessage: String(
                error instanceof Error ? error.message : error,
              ).slice(0, 500),
              failedAt: Date.now(),
            },
            token,
          );
        } catch (patchError) {
          console.error(
            "[memory/drafts] failed to record failure status",
            patchError,
          );
        }
      }
    });
    return Response.json({ ok: true, requestId: createdAt });
  }

  await encodeAndSaveDraft(pipelineParams);
  return Response.json({ ok: true, requestId: createdAt });
}
