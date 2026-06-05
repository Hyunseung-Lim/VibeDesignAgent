import OpenAI from "openai";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { MEMORY_ENCODE_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MEMORY_SCHEMA_VERSION = "0.1.2";
const FIRST_SESSION_TURN = "This is the first turn of this session.";

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
  if (/\[FETCH_REFERENCES:/i.test(output)) return "references_fetch";
  if (/```(?:json)?\s*\{[\s\S]*?"slides"/i.test(output))
    return "presentation_create";
  if (interactionId.startsWith("delete-idea-")) return "note_delete";
  if (interactionId.startsWith("delete-design-")) return "mockup_delete";
  if (interactionId.startsWith("fetch-reference-")) return "references_fetch";
  if (interactionId.startsWith("cite-reference-")) return "reference_cite";
  if (interactionId.startsWith("delete-reference-")) return "reference_delete";
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

export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    missionId?: string;
    interactionId?: string;
    input?: string;
    output?: string;
    timestamp?: number;
  };
  const missionId = body.missionId?.trim();
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
  const [previousDraft, olderDraft] = await loadPreviousDrafts(
    user.localId,
    missionId,
    timestamp,
    token,
  );
  const agentActionCategory = inferAgentActionCategory(output, interactionId);
  const agentActions = extractAgentActions(output);
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
    `user input: ${input}`,
    `agent response: ${output.slice(0, 10000)}`,
    `agent action category: ${agentActionCategory}${agentActions.length > 0 ? ` (${agentActions.map((a) => a.type).join(", ")})` : ""}`,
    agentActions.length > 0
      ? `agent action details: ${agentActions.map((action) => `${action.type}: ${action.content}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MEMORY_ENCODE_PROMPT },
      { role: "user", content },
    ],
  });
  const encoded = parseMemory(completion.choices[0]?.message?.content ?? "{}");
  await patchFirestoreDocument(
    `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}/memoryDrafts/${encodeURIComponent(interactionId)}`,
    {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      missionId,
      interactionId,
      input: input.slice(0, 8000),
      output: output.slice(0, 12000),
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
      status: "draft",
      createdAt,
    },
    token,
  );

  return Response.json({ ok: true, memory: encoded });
}
