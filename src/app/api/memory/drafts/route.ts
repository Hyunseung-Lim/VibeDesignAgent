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
const FIRST_SESSION_TURN = "This is the first turn of this session.";

type EncodedMemory = {
  keywords: string[];
  episode: string;
  semantic: string[];
};

const MEMORY_PROMPT = `# Task

Generate a structured memory record for one interaction turn in a UI/UX design agent session.
This is memory encoding, not a general summary. Analyze the full structured input — not just the user's message.

# Input Fields

earlier episodic memory:
A one-sentence summary of the interaction two turns ago.
Omitted if fewer than two prior turns exist.

previous episodic memory:
A one-sentence summary of the immediately preceding interaction.
If this is the first turn, the value is "${FIRST_SESSION_TURN}".

previous agent output:
The full response the agent gave in the immediately preceding turn.
If this is the first turn, the value is "${FIRST_SESSION_TURN}".

previous semantic memory:
Optional prior durable inference about the user.
Use as weak context only. Do not reinforce or repeat unless the current interaction clearly supports it.

user input:
The query or instruction the user sent in this turn.
May include cited references, quoted text, selected UI elements, or other contextual material.

agent response:
The response the agent generated in this turn.
May include reference analysis, visual direction, functional behavior, structural patterns, design rationale, or generated artifacts.

agent action category:
The type of action the agent performed. Use as context only.
Do not copy machine action labels into the episode unless the label itself is the user-facing subject.

agent action details:
Optional compact details of what was produced or changed.

# Reference Handling

Do not assume a cited reference is only about visual style. It may reflect layout structure, information architecture, feature behavior, interaction patterns, content tone, product framing, brand feeling, specific UI components, comparative critique, or other design rationale.

If the agent response already analyzes a cited reference, preserve the most relevant interpretation in the episode when it materially explains the interaction.

# Rules

Always:
- Write every output value in English; translate Korean or other languages into concise natural English.
- Use previous context when it changes the meaning of the current turn.
- Include the agent action, outcome, feedback, or decision in the episode.
- Return valid JSON only, no text outside it.

Never:
- Summarize only the user input.
- Invent, force, or infer user traits from simple facts; semantic items must be clearly supported inferences, not restatements of what happened.
- Include timestamps, speaker names, or generic filler words in keywords.

# Output Format

Return exactly this JSON shape:

{
  "keywords": [
    // English salient nouns, verbs, artifacts, actions, references, and design concepts.
    // Ordered from most to least important.
    // Exclude speaker names, timestamps, and generic filler words.
    // Include at least three non-redundant keywords.
  ],
  "episode": "",
  // One factual English sentence describing the interaction,
  // including the user request, relevant prior context, agent action/output,
  // and immediate outcome, feedback, or decision.

  "semantic": [
    // One-sentence English inferences about the user's intent, preferences, traits, tendencies, working style, or communication style.
    // Keep each semantic item atomic; split it into separate items if it contains multiple separable ideas.
    // Pay attention to the user's stance, tone, emphasized points, and explicitly mentioned details, and infer the underlying reasons behind them.
    // Do NOT include simple factual statements about what the user said or did.
    // Do NOT force or fabricate inferences.
    // Return [] when there is no clearly supported inference.
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
      keywords: stringArray(parsed.keywords, [
        "conversation",
        "request",
        "response",
      ]).slice(0, 10),
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
  if (interactionId.startsWith("cite-reference-")) return "reference_cite";
  if (interactionId.startsWith("delete-reference-")) return "reference_delete";
  return "agent_response";
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
  const previousSemantic = [
    ...jsonArray(olderDraft?.semanticJson),
    ...jsonArray(previousDraft?.semanticJson),
  ].filter((item, idx, arr) => arr.indexOf(item) === idx);
  const content = [
    olderDraft
      ? `earlier episodic memory: ${String(olderDraft.episode ?? "").trim()}`
      : "",
    `previous episodic memory: ${String(previousDraft?.episode ?? "").trim() || FIRST_SESSION_TURN}`,
    `previous agent output: ${String(previousDraft?.output ?? "").trim() || FIRST_SESSION_TURN}`,
    previousSemantic.length > 0
      ? `previous semantic memory: ${previousSemantic.join(" / ")}`
      : "",
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
      { role: "system", content: MEMORY_PROMPT },
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
        encoded.semantic.map((item) => item.slice(0, 2000)),
      ),
      semantic: encoded.semantic.join("\n").slice(0, 4000),
      previousEpisode: String(previousDraft?.episode ?? "").slice(0, 2000),
      previousOutput: String(previousDraft?.output ?? "").slice(0, 12000),
      agentActionCategory,
      agentActionsJson: JSON.stringify(agentActions),
      status: "draft",
      createdAt,
    },
    token,
  );

  return Response.json({ ok: true, memory: encoded });
}
