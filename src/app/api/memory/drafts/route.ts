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

const MEMORY_PROMPT = `# Task

Generate a structured memory analysis for one interaction turn in a UI/UX design agent session.

Your goal is to produce a compact memory record that helps the system understand:
1. What happened in this interaction.
2. What concepts, references, artifacts, or actions mattered.
3. Whether the interaction clearly reveals any durable user preference, intent, trait, tendency, or working style.

# Context

This is not a general conversation summary task.
This is memory encoding for a design-agent research system.

You will receive a structured record containing:
- previous episodic memory
- previous agent output
- optional previous semantic memory
- current user input
- current agent response
- agent action category
- optional agent action details

Analyze the whole record, not just the user input.

# Input Fields

previous episodic memory:
A one-sentence summary of the immediately preceding interaction.
If this is the first turn, the value is "${FIRST_SESSION_TURN}".

previous agent output:
The full response the agent gave in the immediately preceding turn.
If this is the first turn, the value is "${FIRST_SESSION_TURN}".

previous semantic memory:
Optional prior durable inference about the user.
Use it only as weak context. Do not reinforce or repeat it unless the current interaction clearly supports it.

user input:
The query or instruction the user sent in this turn.
This may include cited references, quoted text, selected UI elements, or other contextual material.

agent response:
The response the agent generated in this turn.
This may include analysis of cited references, website text, visual direction, functional behavior, structural patterns, design rationale, or generated artifacts.

agent action category:
The type of action the agent performed, such as:
- agent_response
- note_create
- note_update
- mockup_generate
- mockup_edit
- references_fetch
- design_spec_create
- presentation_create
- reference_delete
- note_delete
- mockup_delete

Use agent action category as context only.
Do not copy machine action labels into the episode unless the label itself is the user-facing subject.

agent action details:
Optional compact details extracted from machine-readable action payloads.
Use this only to understand what changed or was produced.

# Reference Handling

When the user cites a reference, do not assume the reference is only about visual style.

A cited reference may be used for:
- visual mood
- layout structure
- information architecture
- feature behavior
- interaction pattern
- content tone
- product framing
- brand feeling
- specific UI components
- comparison or critique
- another design rationale

Use the user input and agent response together to infer how the reference was used.

If the agent response already analyzes a cited reference, website, image, or text, preserve the most relevant interpretation in the memory when it materially explains the interaction.

# Success Brief

A good memory record should be:
- factual
- compact
- grounded in the provided interaction
- useful for reconstructing the user's design process later
- careful about separating facts from inferences

The episode should answer:
"What happened in this turn, considering the prior context, the user's request, the agent's response, and the outcome?"

The semantic field should answer:
"Does this turn clearly reveal something durable about the user's preferences, intentions, traits, tendencies, or working style?"

Most interactions should return an empty semantic array.

# Rules

Always:
- Analyze the full structured record.
- Use previous context when it changes the meaning of the current turn.
- Include the agent action, outcome, feedback, or decision in the episode.
- Keep the episode as one factual sentence.
- Prefer concrete nouns, verbs, artifacts, references, actions, and design concepts in keywords.
- Return valid JSON only.

Never:
- Summarize only the user input.
- Treat cited references as visual style by default.
- Invent user traits, preferences, or intentions.
- Turn simple facts into semantic inferences.
- Include simple factual statements about what the user said or did in semantic.
- Include timestamps, speaker names, or generic filler words as keywords.
- Copy machine action labels into the episode unless necessary.
- Add explanations outside JSON.

# Output Format

Return exactly this JSON shape:

{
  "keywords": [
    // Salient nouns, verbs, artifacts, actions, references, and design concepts.
    // Ordered from most to least important.
    // Exclude speaker names, timestamps, and generic filler words.
    // Include at least three non-redundant keywords.
  ],
  "episode": "",
  // One factual sentence describing the interaction,
  // including the user request, relevant prior context, agent action/output,
  // and immediate outcome, feedback, or decision.

  "semantic": [
    // One-sentence inferences about the user's durable intent, preferences, traits,
    // tendencies, working style, or communication style.
    // Include only when clearly and directly supported by the current interaction.
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

async function loadPreviousDraft(
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
    )[0];
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
  const previousDraft = await loadPreviousDraft(
    user.localId,
    missionId,
    timestamp,
    token,
  );
  const agentActionCategory = inferAgentActionCategory(output, interactionId);
  const agentActions = extractAgentActions(output);
  const previousSemantic = jsonArray(previousDraft?.semanticJson);
  const content = [
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
