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
const MEMORY_SCHEMA_VERSION = "0.1.1";
const FIRST_SESSION_TURN = "해당 세션의 첫 대화입니다.";

type EncodedMemory = {
  keywords: string[];
  episode: string;
  semantic: string[];
};

const MEMORY_PROMPT = `Generate a structured analysis of the following content by:
1. Extract key concepts from the content.
2. Summarize the specific interaction as a factual episode.
3. Infer the user’s implicit intent and traits only when clearly supported.

Return the response as a JSON object:
{
  "keywords": [
    // Salient nouns, verbs, and key concepts.
    // Ordered from most to least important.
    // Exclude speaker names, timestamps, and generic filler words.
    // Include at least three non-redundant keywords.
  ],
  "episode": "",
  // A single factual sentence describing what happened in this interaction,
  // including the user/agent action and the immediate outcome, feedback, or decision.

  "semantic": [
    // One-sentence inferences about the user's implicit intent, preferences, traits, tendencies, working style, or communication style.
    // Include only inferences clearly supported by the content.
    // Do not include simple factual statements about what the user said or did.
    // Do not force or fabricate inferences.
    // Return an empty array if there is no clearly supported inference about the user.
  ]
}`;

function stringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
}

function jsonArray(value: unknown) {
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
    return {
      keywords: stringArray(parsed.keywords, ["conversation", "request", "response"]).slice(0, 10),
      episode: String(parsed.episode ?? "").trim(),
      semantic: stringArray(parsed.semantic).slice(0, 6),
    };
  } catch {
    return {
      keywords: ["conversation", "request", "response"],
      episode: "",
      semantic: [],
    };
  }
}

function inferAgentActionCategory(output: string, interactionId: string) {
  if (/\[CREATE_NOTE:/i.test(output)) return "note_create";
  if (/\[UPDATE_NOTE:/i.test(output)) return "note_update";
  if (/\[GENERATE_MOCKUP:/i.test(output)) return "mockup_generate";
  if (/\[EDIT_MOCKUP:/i.test(output)) return "mockup_edit";
  if (/\[CREATE_DESIGN_SPEC:/i.test(output)) return "design_spec_create";
  if (/\[FETCH_REFERENCES:/i.test(output)) return "references_fetch";
  if (/```(?:json)?\s*\{[\s\S]*?"slides"/i.test(output)) return "presentation_create";
  if (interactionId.startsWith("delete-idea-")) return "note_delete";
  if (interactionId.startsWith("delete-design-")) return "mockup_delete";
  if (interactionId.startsWith("cite-reference-")) return "reference_cite";
  if (interactionId.startsWith("delete-reference-")) return "reference_delete";
  return "agent_response";
}

async function loadPreviousDraft(
  uid: string,
  missionId: string,
  sessionRunId: string | undefined,
  timestamp: number,
  token: string,
) {
  const draftPath = sessionRunId
    ? `sessions/${uid}/missionRuns/${encodeURIComponent(sessionRunId)}/memoryDrafts`
    : `sessions/${uid}/missions/${encodeURIComponent(missionId)}/memoryDrafts`;
  const ids = await listFirestoreDocumentIds(draftPath, token);
  const drafts: Array<Record<string, unknown> & { id: string }> = await Promise.all(
    ids.map(async (id) => {
      const data = (await getFirestoreDocument(`${draftPath}/${id}`, token)) ?? {};
      return { id, ...(data as Record<string, unknown>) };
    }),
  );
  return drafts
    .filter((draft) => Number(draft.timestamp ?? draft.createdAt ?? 0) < timestamp)
    .sort(
      (a, b) =>
        Number(b.timestamp ?? b.createdAt ?? 0) -
        Number(a.timestamp ?? a.createdAt ?? 0),
    )[0];
}

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    missionId?: string;
    sessionRunId?: string | null;
    interactionId?: string;
    input?: string;
    output?: string;
    timestamp?: number;
  };
  const missionId = body.missionId?.trim();
  const sessionRunId = body.sessionRunId?.trim() || undefined;
  const interactionId = body.interactionId?.trim();
  const input = body.input?.trim() ?? "";
  const output = body.output?.trim() ?? "";
  if (!missionId || !interactionId || !input || !output) {
    return Response.json(
      { error: "missionId, interactionId, input, and output required" },
      { status: 400 },
    );
  }

  const createdAt = Date.now();
  const timestamp = Number(body.timestamp ?? createdAt);
  const token = await getFirebaseAccessToken();
  const previousDraft = await loadPreviousDraft(
    user.localId,
    missionId,
    sessionRunId,
    timestamp,
    token,
  );
  const agentActionCategory = inferAgentActionCategory(output, interactionId);
  const previousSemantic = jsonArray(previousDraft?.semanticJson);
  const content = [
    `previous episodic memory: ${String(previousDraft?.episode ?? "").trim() || FIRST_SESSION_TURN}`,
    `previous agent output: ${String(previousDraft?.output ?? "").trim() || FIRST_SESSION_TURN}`,
    `user input: ${input}`,
    `agent action category: ${agentActionCategory}`,
    previousSemantic.length > 0
      ? `previous semantic memory: ${previousSemantic.join(" / ")}`
      : "",
  ].join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MEMORY_PROMPT },
      { role: "user", content: `Content for analysis:\n${content}` },
    ],
  });
  const encoded = parseMemory(completion.choices[0]?.message?.content ?? "{}");
  await patchFirestoreDocument(
    `${sessionRunId
      ? `sessions/${user.localId}/missionRuns/${encodeURIComponent(sessionRunId)}`
      : `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}`
    }/memoryDrafts/${encodeURIComponent(interactionId)}`,
    {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      missionId,
      sessionRunId: sessionRunId ?? null,
      interactionId,
      input: input.slice(0, 8000),
      output: output.slice(0, 12000),
      timestamp,
      keywordsJson: JSON.stringify(encoded.keywords),
      episode: encoded.episode.slice(0, 2000),
      semanticJson: JSON.stringify(encoded.semantic.map((item) => item.slice(0, 2000))),
      semantic: encoded.semantic.join("\n").slice(0, 4000),
      previousEpisode: String(previousDraft?.episode ?? "").slice(0, 2000),
      previousOutput: String(previousDraft?.output ?? "").slice(0, 12000),
      agentActionCategory,
      status: "draft",
      createdAt,
    },
    token,
  );

  return Response.json({ ok: true, memory: encoded });
}
