import OpenAI from "openai";
import { patchFirestoreDocument } from "@/lib/server/firebaseAdminRest";

export const MEMORY_EMBEDDING_MODEL = "text-embedding-3-large";
export const INTERACTION_MEMORY_EMBEDDING_SOURCE =
  "during_session_record_text_v2";
export const BEFORE_SESSION_MEMORY_EMBEDDING_SOURCE =
  "before_session_unit_text";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type MemoryEmbeddingInput = {
  path?: string;
  keyword?: string[];
  keywords?: string[];
  episodic?: string | null;
  semantic?: string | null;
  link?: string | null;
  sourceType?: string | null;
  source?: unknown;
  embedding?: number[];
  embeddingSource?: string | null;
};

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function sourceText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const source = value as Record<string, unknown>;
  return typeof source.sourceText === "string" ? source.sourceText.trim() : "";
}

export function memoryEmbeddingSourceFor(input: MemoryEmbeddingInput) {
  return input.sourceType === "before_session"
    ? BEFORE_SESSION_MEMORY_EMBEDDING_SOURCE
    : INTERACTION_MEMORY_EMBEDDING_SOURCE;
}

export function buildMemoryEmbeddingText(input: MemoryEmbeddingInput) {
  const keywords = input.keyword?.length ? input.keyword : input.keywords ?? [];
  const beforeSessionSource =
    input.sourceType === "before_session" ? sourceText(input.source) : "";
  return [
    beforeSessionSource ? `Source: ${beforeSessionSource}` : "",
    keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
    input.episodic ? `Episodic: ${input.episodic}` : "",
    input.semantic ? `Semantic: ${input.semantic}` : "",
    input.link ? `Link: ${input.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function embedMemoryTexts(texts: string[]) {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({
    model: MEMORY_EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => l2Normalize(item.embedding));
}

export async function embedMemoryInputs(inputs: MemoryEmbeddingInput[]) {
  return embedMemoryTexts(
    inputs.map((input) => buildMemoryEmbeddingText(input) || "Memory"),
  );
}

function hasFreshEmbedding(input: MemoryEmbeddingInput) {
  return (
    Array.isArray(input.embedding) &&
    input.embedding.length > 0 &&
    input.embeddingSource === memoryEmbeddingSourceFor(input)
  );
}

export async function ensureFreshMemoryEmbeddings<
  T extends MemoryEmbeddingInput,
>(inputs: T[], token: string) {
  const stale = inputs.filter((input) => !hasFreshEmbedding(input));
  if (stale.length === 0) return inputs;

  const now = Date.now();
  const embeddings = await embedMemoryInputs(stale);
  await Promise.all(
    stale.map((input, index) => {
      const embedding = embeddings[index] ?? [];
      const embeddingSource = memoryEmbeddingSourceFor(input);
      input.embedding = embedding;
      input.embeddingSource = embeddingSource;
      if (!input.path) return Promise.resolve();
      return patchFirestoreDocument(
        input.path,
        {
          embedding,
          embeddingSource,
          embeddingModel: MEMORY_EMBEDDING_MODEL,
          updatedAt: now,
        },
        token,
      );
    }),
  );

  return inputs;
}
