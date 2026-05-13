import OpenAI from "openai";
import {
  getFirebaseAccessToken,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type EncodedMemory = {
  category: string[];
  subcategory: string[];
  keywords: string[];
  episode: string;
  semantic: string;
};

const MEMORY_PROMPT = `Generate a structured analysis of the following content by:
1. Identifying the most salient keywords (focus on nouns, verbs, and key concepts)
2. Creating categorical tags at two levels of granularity (broad category + finer subcategory)
3. Extracting core themes and contextual elements (Extract specific events, and User profile)

Format the response as a JSON object:
{
  "category": [
    // broad categories/themes for classification
    // ONLY one category word
  ],
  "subcategory": [
    // finer-grained sub-labels nested under category
    // More specific than category but still classifying (not specific instances)
    // At least two, no redundancy with category items
  ],
  "keywords": [
    // several specific, distinct keywords that capture key concepts and terminology
    // Order from most to least important
    // At least three keywords, but don't be too redundant.
  ],
  "episode":
    // one sentence summarizing the event factually
  ,
  "semantic":
    // one sentence extracting a generalizable fact about the user
    // Leave as empty string if no new user-level knowledge appears
}`;

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
}

function parseMemory(raw: string): EncodedMemory {
  try {
    const parsed = JSON.parse(raw) as Partial<EncodedMemory>;
    return {
      category: stringArray(parsed.category, ["session"]).slice(0, 1),
      subcategory: stringArray(parsed.subcategory, ["interaction", "design"]).slice(0, 6),
      keywords: stringArray(parsed.keywords, ["conversation", "request", "response"]).slice(0, 10),
      episode: String(parsed.episode ?? "").trim(),
      semantic: String(parsed.semantic ?? "").trim(),
    };
  } catch {
    return {
      category: ["session"],
      subcategory: ["interaction", "design"],
      keywords: ["conversation", "request", "response"],
      episode: "",
      semantic: "",
    };
  }
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

  const content = [
    `timestamp: ${new Date(body.timestamp ?? Date.now()).toISOString()}`,
    `speaker: user\ninput: ${input}`,
    `speaker: agent\noutput: ${output}`,
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
  const createdAt = Date.now();
  const token = await getFirebaseAccessToken();
  await patchFirestoreDocument(
    `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}/memoryDrafts/${encodeURIComponent(interactionId)}`,
    {
      missionId,
      interactionId,
      input: input.slice(0, 8000),
      output: output.slice(0, 12000),
      timestamp: Number(body.timestamp ?? createdAt),
      categoryJson: JSON.stringify(encoded.category),
      subcategoryJson: JSON.stringify(encoded.subcategory),
      keywordsJson: JSON.stringify(encoded.keywords),
      episode: encoded.episode.slice(0, 2000),
      semantic: encoded.semantic.slice(0, 2000),
      status: "draft",
      createdAt,
    },
    token,
  );

  return Response.json({ ok: true, memory: encoded });
}
