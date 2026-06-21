import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { MemoryDraftSources } from "@/lib/memory-sources";
import { MEMORY_SOURCE_IMAGE_PROMPT } from "@/lib/prompts";

export const MEMORY_SOURCE_NORMALIZATION_VERSION = "1";

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

export function memorySourceFingerprint(sources: MemoryDraftSources | undefined) {
  return createHash("sha256")
    .update(JSON.stringify(sourcePayload(sources)))
    .digest("hex");
}

async function describeImage(dataUrl: string, name?: string) {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: MEMORY_SOURCE_IMAGE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Source image name: ${compact(name, 300) || "unnamed"}` },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ],
  });
  return compact(completion.choices[0]?.message?.content, 3000);
}

async function runMemorySourceNormalization(
  sources: MemoryDraftSources | undefined,
) {
  const payload = sourcePayload(sources);
  const sections: string[] = [];
  const sourceTypes: string[] = [];

  if (payload.texts.length > 0) {
    sourceTypes.push("text");
    sections.push(`Cited text:\n${payload.texts.map((text, index) => `${index + 1}. ${text}`).join("\n")}`);
  }
  if (payload.links.length > 0) {
    sourceTypes.push("link");
    sections.push(
      `Linked sources:\n${payload.links
        .map((link, index) =>
          [
            `${index + 1}. ${link.title || link.url || "Untitled source"}`,
            link.url ? `URL: ${link.url}` : "",
            link.description ? `Description: ${link.description}` : "",
            link.rationale ? `Rationale: ${link.rationale}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .join("\n")}`,
    );
  }
  if (payload.uiResult) {
    sourceTypes.push("ui_result");
    sections.push(
      [
        "Selected UI result:",
        payload.uiResult.artboardId ? `Artboard: ${payload.uiResult.artboardId}` : "",
        payload.uiResult.selector ? `Selector: ${payload.uiResult.selector}` : "",
        payload.uiResult.html ? `HTML and visible content: ${payload.uiResult.html}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const imageDataUrl = safeImageDataUrl(sources?.image?.dataUrl);
  const imageName = compact(sources?.image?.name, 300);
  if (imageDataUrl) {
    sourceTypes.push("image");
    try {
      const description = await describeImage(
        imageDataUrl,
        imageName,
      );
      sections.push(
        `Attached image${imageName ? ` (${imageName})` : ""}:\n${description || "Image content could not be described."}`,
      );
    } catch (error) {
      console.warn("[memory/drafts] image source normalization failed", error);
      sections.push(
        `Attached image: ${imageName || "unnamed image"}`,
      );
    }
  }

  return {
    text: sections.join("\n\n").slice(0, 16000),
    sourceTypes,
  };
}

export function normalizeMemorySources(sources: MemoryDraftSources | undefined) {
  const fingerprint = memorySourceFingerprint(sources);
  const inFlight = inFlightNormalizations.get(fingerprint);
  if (inFlight) return inFlight;

  const normalization = runMemorySourceNormalization(sources).finally(() => {
    inFlightNormalizations.delete(fingerprint);
  });
  inFlightNormalizations.set(fingerprint, normalization);
  return normalization;
}
