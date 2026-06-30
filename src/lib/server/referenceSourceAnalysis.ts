import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { MemorySourceLink } from "@/lib/memory-sources";
import {
  REFERENCE_SOURCE_VISION_ANALYSIS_PROMPT,
  REFERENCE_SOURCE_WEB_ANALYSIS_PROMPT,
} from "@/lib/prompts";

export const REFERENCE_SOURCE_ANALYSIS_VERSION = "1";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CURATION_HOST_PATTERN =
  /(?:^|\.)(?:pinterest\.|pinimg\.|awwwards\.|siteinspire\.|cssdesignawards\.|godly\.|mobbin\.|refero\.|dribbble\.|behance\.)/i;

type ReferenceSourceAnalysis = {
  sourceType: string;
  summary: string;
  cases: string[];
  capabilities: string[];
  positioning: string;
  uxPatterns: string[];
  visualEvidence: string[];
  limitations: string;
};

function compact(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactArray(value: unknown, maxItems = 6) {
  return Array.isArray(value)
    ? value
        .map((item) => compact(item, 500))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function canonicalUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:utm_|fbclid|gclid|igshid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

function sourceIdentity(link: MemorySourceLink) {
  return {
    url: canonicalUrl(link.url),
    imageUrl: canonicalUrl(link.imageUrl),
    title: compact(link.title, 300),
    description: compact(link.description, 1000),
    rationale: compact(link.rationale, 1000),
    referenceMode: compact(link.referenceMode, 20),
    searchProvider: compact(link.searchProvider, 40),
  };
}

export function referenceSourceAnalysisFingerprint(link: MemorySourceLink) {
  const identity = sourceIdentity(link);
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: REFERENCE_SOURCE_ANALYSIS_VERSION,
        url: identity.url,
        imageUrl: identity.imageUrl,
        fallbackTitle:
          identity.url || identity.imageUrl ? "" : identity.title,
        referenceMode: identity.referenceMode,
        searchProvider: identity.searchProvider,
      }),
    )
    .digest("hex");
}

function responseText(response: unknown) {
  let text = "";
  const output = (
    response as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    }
  ).output;
  for (const item of output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" || content.type === "text") {
        text += content.text ?? "";
      }
    }
  }
  return text;
}

function parseAnalysis(raw: string): ReferenceSourceAnalysis | null {
  const objectText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!objectText) return null;
  try {
    const parsed = JSON.parse(objectText) as Record<string, unknown>;
    const analysis = {
      sourceType: compact(parsed.sourceType, 80) || "other",
      summary: compact(parsed.summary, 2000),
      cases: compactArray(parsed.cases),
      capabilities: compactArray(parsed.capabilities),
      positioning: compact(parsed.positioning, 1000),
      uxPatterns: compactArray(parsed.uxPatterns),
      visualEvidence: compactArray(parsed.visualEvidence),
      limitations: compact(parsed.limitations, 1000),
    };
    return analysis.summary || analysis.cases.length || analysis.visualEvidence.length
      ? analysis
      : null;
  } catch {
    return null;
  }
}

function formatAnalysis(analysis: ReferenceSourceAnalysis) {
  return [
    `Source type: ${analysis.sourceType}`,
    analysis.summary ? `Source summary: ${analysis.summary}` : "",
    analysis.cases.length ? `Cases: ${analysis.cases.join(" | ")}` : "",
    analysis.capabilities.length
      ? `Capabilities: ${analysis.capabilities.join(" | ")}`
      : "",
    analysis.positioning ? `Positioning: ${analysis.positioning}` : "",
    analysis.uxPatterns.length
      ? `UX and IA patterns: ${analysis.uxPatterns.join(" | ")}`
      : "",
    analysis.visualEvidence.length
      ? `Visual evidence: ${analysis.visualEvidence.join(" | ")}`
      : "",
    analysis.limitations ? `Limitations: ${analysis.limitations}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 7000);
}

function shouldUseVision(link: MemorySourceLink) {
  const imageUrl = canonicalUrl(link.imageUrl);
  if (!imageUrl) return false;
  let hostname = "";
  try {
    hostname = new URL(canonicalUrl(link.url)).hostname;
  } catch {
    // The image remains usable even when the page URL is absent.
  }
  return (
    link.referenceMode === "style" ||
    CURATION_HOST_PATTERN.test(hostname)
  );
}

async function analyzeVisionSource(link: MemorySourceLink) {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REFERENCE_SOURCE_VISION_ANALYSIS_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(sourceIdentity(link)),
          },
          {
            type: "image_url",
            image_url: { url: canonicalUrl(link.imageUrl), detail: "low" },
          },
        ],
      },
    ],
  });
  return parseAnalysis(completion.choices[0]?.message?.content ?? "{}");
}

async function analyzeWebSource(link: MemorySourceLink) {
  const response = await openai.responses.create({
    model: "gpt-4o",
    tools: [{ type: "web_search_preview" }],
    tool_choice: "required",
    input: [
      { role: "system", content: REFERENCE_SOURCE_WEB_ANALYSIS_PROMPT },
      {
        role: "user",
        content: JSON.stringify(sourceIdentity(link)),
      },
    ],
  });
  return parseAnalysis(responseText(response));
}

function metadataFallback(link: MemorySourceLink) {
  return [
    "Source analysis fallback:",
    link.title ? `Title: ${compact(link.title, 300)}` : "",
    link.url ? `URL: ${compact(link.url, 2000)}` : "",
    link.description
      ? `Description: ${compact(link.description, 1000)}`
      : "",
    link.rationale ? `Rationale: ${compact(link.rationale, 1000)}` : "",
    "Limitations: The source could not be inspected beyond supplied metadata.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function analyzeReferenceSource(link: MemorySourceLink) {
  try {
    const analysis = shouldUseVision(link)
      ? await analyzeVisionSource(link)
      : await analyzeWebSource(link);
    return analysis ? formatAnalysis(analysis) : metadataFallback(link);
  } catch (error) {
    console.warn("[memory/drafts] reference source analysis failed", error);
    return metadataFallback(link);
  }
}
