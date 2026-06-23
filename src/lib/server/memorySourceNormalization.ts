import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { MemoryDraftSources } from "@/lib/memory-sources";
import { MEMORY_SOURCE_NORMALIZATION_PROMPT } from "@/lib/prompts";

export const MEMORY_SOURCE_NORMALIZATION_VERSION = "2";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const inFlightNormalizations = new Map<
  string,
  Promise<{ text: string; sourceTypes: string[] }>
>();

function compact(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeImageDataUrl(value: unknown) {
  const dataUrl = String(value ?? "");
  return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) &&
    dataUrl.length <= 5_000_000
    ? dataUrl
    : "";
}

function sourcePayload(sources: MemoryDraftSources | undefined) {
  const imageDataUrl = safeImageDataUrl(sources?.image?.dataUrl);
  return {
    texts: (sources?.texts ?? []).map((text) => compact(text, 2000)).filter(Boolean).slice(0, 8),
    links: (sources?.links ?? []).slice(0, 8).map((link) => ({
      title: compact(link.title, 300),
      url: compact(link.url, 2000),
      description: compact(link.description, 1000),
      rationale: compact(link.rationale, 1000),
      imageUrl: compact(link.imageUrl, 2000),
      referenceMode: compact(link.referenceMode, 20),
      searchProvider: compact(link.searchProvider, 40),
      referencePurpose: compact(link.referencePurpose, 100),
      referencePurposeLabel: compact(link.referencePurposeLabel, 200),
      analysis: compact(link.analysis, 7000),
    })),
    image: imageDataUrl
      ? {
          name: compact(sources?.image?.name, 300),
          hash: createHash("sha256")
            .update(imageDataUrl)
            .digest("hex"),
        }
      : null,
    uiResult: sources?.uiResult
      ? {
          artboardId: compact(sources.uiResult.artboardId, 300),
          selector: compact(sources.uiResult.selector, 1000),
          html: compact(sources.uiResult.html, 8000),
        }
      : null,
  };
}

export function memorySourceFingerprint(
  sources: MemoryDraftSources | undefined,
  input = "",
  output = "",
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sources: sourcePayload(sources),
        input: compact(input, 8000),
        output: compact(output, 10000),
      }),
    )
    .digest("hex");
}

type NormalizedReferenceInterpretation = {
  sourceSummary: string;
  interactionUse: string;
  relevantAspects: string[];
  agentInterpretation: string;
  scope:
    | "durable_candidate"
    | "mission_specific"
    | "negative_mission_evidence"
    | "unclear";
  scopeRationale: string;
  negativeEvidence: boolean;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => compact(item, 100)).filter(Boolean).slice(0, 8)
    : [];
}

function parseReferenceInterpretation(
  raw: string,
): NormalizedReferenceInterpretation | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const allowedScopes = new Set<NormalizedReferenceInterpretation["scope"]>([
      "durable_candidate",
      "mission_specific",
      "negative_mission_evidence",
      "unclear",
    ]);
    const parsedScope = String(parsed.scope ?? "unclear");
    const scope = allowedScopes.has(
      parsedScope as NormalizedReferenceInterpretation["scope"],
    )
      ? (parsedScope as NormalizedReferenceInterpretation["scope"])
      : "unclear";
    const sourceSummary = compact(parsed.sourceSummary, 2000);
    const interactionUse = compact(parsed.interactionUse, 2000);
    const agentInterpretation = compact(parsed.agentInterpretation, 2000);
    if (!sourceSummary && !interactionUse && !agentInterpretation) return null;
    return {
      sourceSummary,
      interactionUse,
      relevantAspects: stringArray(parsed.relevantAspects),
      agentInterpretation,
      scope,
      scopeRationale: compact(parsed.scopeRationale, 1000),
      negativeEvidence:
        parsed.negativeEvidence === true || scope === "negative_mission_evidence",
    };
  } catch {
    return null;
  }
}

function rawSourceText(payload: ReturnType<typeof sourcePayload>, imageName: string) {
  const sections: string[] = [];

  if (payload.texts.length > 0) {
    sections.push(
      `Cited text:\n${payload.texts.map((text, index) => `${index + 1}. ${text}`).join("\n")}`,
    );
  }
  if (payload.links.length > 0) {
    sections.push(
      `Linked sources:\n${payload.links
        .map((link, index) =>
          [
            `${index + 1}. ${link.title || link.url || "Untitled source"}`,
            link.url ? `URL: ${link.url}` : "",
            link.description ? `Description: ${link.description}` : "",
            link.rationale ? `Rationale: ${link.rationale}` : "",
            link.referenceMode ? `Mode: ${link.referenceMode}` : "",
            link.searchProvider ? `Provider: ${link.searchProvider}` : "",
            link.referencePurpose
              ? `Selected purpose: ${link.referencePurposeLabel || link.referencePurpose}`
              : "",
            link.analysis ? `Source analysis: ${link.analysis}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .join("\n")}`,
    );
  }
  if (payload.uiResult) {
    sections.push(
      [
        "Selected UI result:",
        payload.uiResult.artboardId
          ? `Artboard: ${payload.uiResult.artboardId}`
          : "",
        payload.uiResult.selector
          ? `Selector: ${payload.uiResult.selector}`
          : "",
        payload.uiResult.html
          ? `HTML and visible content: ${payload.uiResult.html}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (payload.image) {
    sections.push(`Attached image: ${imageName || "unnamed image"}`);
  }

  return sections.join("\n\n");
}

function formatReferenceInterpretation(
  interpretation: NormalizedReferenceInterpretation,
) {
  return [
    "Normalized reference interpretation:",
    interpretation.sourceSummary
      ? `Source summary: ${interpretation.sourceSummary}`
      : "",
    interpretation.interactionUse
      ? `Interaction use: ${interpretation.interactionUse}`
      : "",
    interpretation.relevantAspects.length > 0
      ? `Relevant aspects: ${interpretation.relevantAspects.join(", ")}`
      : "",
    interpretation.agentInterpretation
      ? `Agent interpretation: ${interpretation.agentInterpretation}`
      : "",
    `Scope: ${interpretation.scope}`,
    interpretation.scopeRationale
      ? `Scope rationale: ${interpretation.scopeRationale}`
      : "",
    `Negative evidence: ${interpretation.negativeEvidence ? "yes" : "no"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function interpretSources(
  rawSources: string,
  input: string,
  output: string,
  dataUrl: string,
) {
  const userText = [
    `User input:\n${compact(input, 8000)}`,
    `Agent output:\n${compact(output, 10000)}`,
    `Structured source material:\n${rawSources}`,
  ].join("\n\n");
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: userText },
  ];
  if (dataUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: dataUrl, detail: "low" },
    });
  }
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MEMORY_SOURCE_NORMALIZATION_PROMPT },
      {
        role: "user",
        content: userContent,
      },
    ],
  });
  return parseReferenceInterpretation(
    completion.choices[0]?.message?.content ?? "{}",
  );
}

async function runMemorySourceNormalization(
  sources: MemoryDraftSources | undefined,
  input: string,
  output: string,
) {
  const payload = sourcePayload(sources);
  const sourceTypes: string[] = [];

  if (payload.texts.length > 0) {
    sourceTypes.push("text");
  }
  if (payload.links.length > 0) {
    sourceTypes.push("link");
  }
  if (payload.uiResult) {
    sourceTypes.push("ui_result");
  }
  const imageDataUrl = safeImageDataUrl(sources?.image?.dataUrl);
  const imageName = compact(sources?.image?.name, 300);
  if (imageDataUrl) {
    sourceTypes.push("image");
  }
  if (sourceTypes.length === 0) {
    return { text: "", sourceTypes };
  }

  const rawSources = rawSourceText(payload, imageName);
  try {
    const interpretation = await interpretSources(
      rawSources,
      input,
      output,
      imageDataUrl,
    );
    if (interpretation) {
      return {
        text: `${formatReferenceInterpretation(interpretation)}\n\nSource evidence:\n${rawSources}`.slice(
          0,
          16000,
        ),
        sourceTypes,
      };
    }
  } catch (error) {
    console.warn("[memory/drafts] source normalization failed", error);
  }

  return {
    text: rawSources.slice(0, 16000),
    sourceTypes,
  };
}

export function normalizeMemorySources(
  sources: MemoryDraftSources | undefined,
  input: string,
  output: string,
) {
  const fingerprint = memorySourceFingerprint(sources, input, output);
  const inFlight = inFlightNormalizations.get(fingerprint);
  if (inFlight) return inFlight;

  const normalization = runMemorySourceNormalization(
    sources,
    input,
    output,
  ).finally(() => {
    inFlightNormalizations.delete(fingerprint);
  });
  inFlightNormalizations.set(fingerprint, normalization);
  return normalization;
}
