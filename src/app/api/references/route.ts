import OpenAI from "openai";
import {
  REFERENCE_MODE_CLASSIFY_PROMPT,
  referenceQueryBuilderPrompt,
  referenceProductSearchPrompt,
  referenceStyleSearchPrompt,
} from "@/lib/prompts";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const QUERY_MODEL = "gpt-5.4";
const SEARCH_MODEL = "gpt-5.4";
const FINAL_REFERENCE_COUNT = 3;
// Upper bound when the user asks for a specific number of references. Keeps
// "100개" style requests from degrading search quality / flooding the panel.
const MAX_REFERENCE_COUNT = 6;

type ReferenceMode = "style" | "product";
// All references now come from a single OpenAI web_search path.
type SearchProvider = "openai-web";

const STRUCTURE_REFERENCE_PATTERN =
  /구조\s*참고|구조|레이아웃\s*참고|섹션\s*구성|화면\s*구성|정보\s*구조|와이어프레임|layout\s+reference|layout|structure|section\s+structure|content\s+structure|information\s+architecture|wireframe/i;

function safeImageDataUrl(value: unknown) {
  const dataUrl = String(value ?? "");
  return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(dataUrl) &&
    dataUrl.length <= 5_000_000
    ? dataUrl
    : "";
}

function canonicalUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.searchParams.sort();
    const pathname =
      url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function domainFor(link: string, fallback = "") {
  try {
    return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return fallback.replace(/^www\./, "").toLowerCase();
  }
}

function stripFictionalPersonaNames(text: string, names: string[]) {
  return names.reduce((current, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return current
      .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
      .replace(/\s+/g, " ")
      .trim();
  }, text);
}

function fictionalPersonaNames(...parts: Array<string | null | undefined>) {
  const text = parts.filter(Boolean).join("\n");
  const names = new Set<string>();
  const optionMatch = text.match(
    /선택된\s*옵션\s*:\s*(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/u,
  );
  if (optionMatch?.[1]) names.add(optionMatch[1].trim());

  for (const match of text.matchAll(
    /(?:^|\n)\s*(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+[—-]\s+/gu,
  )) {
    if (match[1]) names.add(match[1].trim());
  }

  const fictionSignals =
    /가상|인물\s*중|선택된\s*옵션|아래\s*세\s*명|미션\s*브리핑|persona|fictional/i.test(
      text,
    );
  return fictionSignals ? Array.from(names) : [];
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Proper JSON array extraction: handles nested brackets and quoted strings.
// Fixes the lazy /\[[\s\S]*?\]/ regex which breaks on URLs containing [] characters.
function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Cache compiled regex patterns to avoid recreating them on every metaContent call
const metaContentRegexCache = new Map<string, RegExp>();

function metaContent(html: string, key: string) {
  let pattern = metaContentRegexCache.get(key);
  if (!pattern) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(
      `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`,
      "i",
    );
    metaContentRegexCache.set(key, pattern);
  }
  return html.match(pattern)?.[1] ?? "";
}

function pageTitle(html: string) {
  return decodeHtml(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
  );
}

// Truncate user-supplied strings to limit prompt injection attack surface
function sanitizeInput(value: unknown, maxLength = 3000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function compactReferencePreferenceContext(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.scope !== "mission") return null;
  const compactItems = (items: unknown, signal: string) =>
    Array.isArray(items)
      ? items
          .slice(-8)
          .map((item) => {
            const reference = item as Record<string, unknown>;
            return {
              signal,
              title: sanitizeInput(reference.title, 120),
              description: sanitizeInput(reference.description, 220),
              rationale: sanitizeInput(reference.rationale, 220),
              tag: sanitizeInput(reference.tag, 80),
              url: sanitizeInput(reference.url, 180),
              referenceMode: sanitizeInput(reference.referenceMode, 20),
              searchProvider: sanitizeInput(reference.searchProvider, 30),
            };
          })
          .filter((item) => item.title || item.url || item.description)
      : [];
  const context = {
    scope: "same_mission_only",
    missionId: sanitizeInput(record.missionId, 120),
    cited: compactItems(record.cited, "strong_positive_cited"),
    kept: compactItems(record.kept, "weak_positive_kept"),
    deleted: compactItems(record.deleted, "negative_deleted"),
  };
  if (
    context.cited.length === 0 &&
    context.kept.length === 0 &&
    context.deleted.length === 0
  ) {
    return null;
  }
  return context;
}

async function describeStyleImageForSearch(
  dataUrl: string,
  context: {
    missionTitle: string;
    missionBrief: string;
    customQuery: string | null;
    userRequest: string | null;
  },
) {
  if (!dataUrl) return "";
  try {
    const completion = await openai.chat.completions.create({
      model: QUERY_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Analyze the attached UI/design reference image for web search. Return one compact English phrase under 80 words that can be appended to a design reference search query. Focus only on visible style cues: UI artifact type, layout, composition, color palette, typography, image treatment, density, spacing, surface style, and mood. Do not identify people or infer private traits. Do not mention that it is an attached image.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Mission title: ${context.missionTitle}`,
                `Mission brief: ${context.missionBrief.slice(0, 1200)}`,
                `User request: ${context.userRequest ?? context.customQuery ?? ""}`,
                "Describe the visible design style as reusable search cues for finding similar UI/UX references.",
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "low" },
            },
          ],
        },
      ],
    });
    return sanitizeInput(completion.choices[0]?.message?.content, 600);
  } catch (error) {
    console.warn("[references] style image analysis failed", error);
    return "";
  }
}

// Run async tasks with bounded concurrency to avoid overwhelming external services
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

async function inferReferenceMode(
  missionTitle: string,
  missionBrief: string,
  customQuery: string | null,
): Promise<ReferenceMode> {
  const text = [missionTitle, missionBrief, customQuery]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const styleSignal =
    /(무드|분위기|스타일|색감|비주얼|예쁜|감각|톤앤매너|레퍼런스 이미지|히어로\s*섹션|포트폴리오\s*히어로|inspiration|mood|style|visual|aesthetic|look and feel|hero section|portfolio hero|color|typography)/i.test(
      text,
    );
  const productSignal =
    /(실제|사례|제품|서비스|사이트|웹사이트|앱|기능|구조|ux|flow|온보딩|가격|네비게이션|대시보드|시안|메모|product|website|case study|feature|structure|layout|user flow|decision)/i.test(
      text,
    );
  if (STRUCTURE_REFERENCE_PATTERN.test(text)) return "product";
  if (styleSignal && !productSignal) return "style";
  if (productSignal && !styleSignal) return "product";

  try {
    const res = await openai.chat.completions.create({
      model: QUERY_MODEL,
      messages: [
        {
          role: "system",
          content: REFERENCE_MODE_CLASSIFY_PROMPT,
        },
        {
          role: "user",
          content: `Mission title: ${missionTitle}\nMission brief: ${missionBrief}\nUser request: ${customQuery ?? ""}`,
        },
      ],
    });
    const content = res.choices[0]?.message?.content ?? "";
    const objMatch = content.match(/\{[\s\S]*?\}/);
    if (!objMatch) return "product";
    const parsed = JSON.parse(objMatch[0]);
    return parsed?.mode === "style" ? "style" : "product";
  } catch {
    return "product";
  }
}

function isLowQualityListing(title: string, link: string, source: string) {
  const text = `${title} ${link} ${source}`.toLowerCase();
  return (
    /browse thousands/.test(text) ||
    /freepik|shutterstock|istockphoto|alamy|pngtree|vecteezy|depositphotos|stock photo/.test(
      text,
    ) ||
    /pinterest\./.test(text) ||
    /\/search\/?/.test(text) ||
    /\/tags?\//.test(text) ||
    /\/topics?\//.test(text)
  );
}

function isLowQualityProductReference(
  title: string,
  link: string,
  source: string,
) {
  const text = `${title} ${link} ${source}`.toLowerCase();
  return (
    isLowQualityListing(title, link, source) ||
    /dashboard case study/.test(text) ||
    /case study saas/.test(text) ||
    /\/collections?\//.test(text) ||
    /\/boards?\//.test(text) ||
    /instagram\.com|facebook\.com|x\.com|twitter\.com|threads\.net|tiktok\.com/.test(
      text,
    ) ||
    /\/p\/|\/reel\/|\/status\//.test(text)
  );
}

// Style references are allowed to come from galleries/collections, so only the
// clearly-unusable sources (stock, social, raw search/tag indexes) are filtered.
function isLowQualityStyleReference(
  title: string,
  link: string,
  source: string,
) {
  const text = `${title} ${link} ${source}`.toLowerCase();
  return (
    isLowQualityListing(title, link, source) ||
    /instagram\.com|facebook\.com|x\.com|twitter\.com|threads\.net|tiktok\.com/.test(
      text,
    )
  );
}

async function buildSearchQueries(
  missionTitle: string,
  missionBrief: string,
  customQuery: string | null,
  mode: ReferenceMode,
  omittedNames: string[],
  referencePreferenceContext: unknown,
  userRequest: string | null,
): Promise<string[]> {
  const fallbackQuery =
    stripFictionalPersonaNames(
      customQuery || missionTitle || "mobile app UI",
      omittedNames,
    ) || "portfolio hero section UI";
  const res = await openai.chat.completions.create({
    model: QUERY_MODEL,
    messages: [
      {
        role: "system",
        content: referenceQueryBuilderPrompt(mode, omittedNames),
      },
      {
        role: "user",
        content: `Mission title: ${missionTitle ?? ""}\nMission brief: ${missionBrief ?? ""}\nCurrent user request (authoritative for this turn; may contain corrections or exclusions): ${userRequest ?? customQuery ?? ""}\nAssembled search context: ${customQuery ?? ""}\nSame-mission reference preference context: ${JSON.stringify(referencePreferenceContext ?? null)}`,
      },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const arrayText = extractFirstJsonArray(text);
  if (!arrayText) return [fallbackQuery];
  try {
    const parsed = JSON.parse(arrayText);
    const queries = Array.isArray(parsed)
      ? parsed
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const sanitized = queries
      .map((query) => stripFictionalPersonaNames(query, omittedNames))
      .filter(Boolean);
    const uniqueQueries = Array.from(new Set(sanitized)).slice(0, 3);
    return uniqueQueries.length > 0 ? uniqueQueries : [fallbackQuery];
  } catch {
    return [fallbackQuery];
  }
}

type WebReference = {
  url: string;
  title?: string;
  description?: string;
  rationale?: string;
  imageUrl?: string | null;
  source?: string;
};

type ReferenceCard = {
  id: string;
  title: string;
  description: string;
  rationale?: string;
  tag: string;
  url: string;
  imageUrl?: string;
  referenceMode: ReferenceMode;
  searchProvider: SearchProvider;
};

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
      // Accept both "output_text" (responses API) and "text" (potential future variants)
      if (content.type === "output_text" || content.type === "text") {
        text += content.text ?? "";
      }
    }
  }
  return text;
}

function parseWebReferences(text: string): WebReference[] {
  const arrayText = extractFirstJsonArray(text);
  if (!arrayText) return [];
  try {
    const parsed = JSON.parse(arrayText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        url: String(item?.url ?? ""),
        title: item?.title ? String(item.title) : undefined,
        description: item?.description ? String(item.description) : undefined,
        rationale: item?.rationale ? String(item.rationale) : undefined,
        imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
        source: item?.source ? String(item.source) : undefined,
      }))
      .filter((item) => item.url);
  } catch {
    return [];
  }
}

async function hydrateReferenceMetadata(reference: WebReference) {
  let url: URL;
  try {
    url = new URL(reference.url);
  } catch {
    return reference;
  }
  if (!["http:", "https:"].includes(url.protocol)) return reference;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 VibeDesignAgent reference search",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return reference;
    const html = (await res.text()).slice(0, 300_000);
    const title =
      decodeHtml(metaContent(html, "og:title")) ||
      decodeHtml(metaContent(html, "twitter:title")) ||
      pageTitle(html) ||
      reference.title;
    const image =
      decodeHtml(metaContent(html, "og:image")) ||
      decodeHtml(metaContent(html, "twitter:image")) ||
      decodeHtml(metaContent(html, "twitter:image:src"));
    return {
      ...reference,
      title: title || reference.title,
      imageUrl:
        reference.imageUrl || (image ? new URL(image, url).toString() : null),
    };
  } catch {
    return reference;
  }
}

// Single OpenAI web_search path for both style and product references. The mode
// selects the system prompt and the quality filter; thumbnails come from the
// page og:image via hydrateReferenceMetadata.
async function searchWebReferences(
  mode: ReferenceMode,
  keywords: string[],
  searchContext: string,
  blockedUrls: Set<string>,
  omittedNames: string[],
  referencePreferenceContext: unknown,
  targetCount: number,
  userRequest: string | null,
) {
  try {
    const systemPrompt =
      mode === "style"
        ? referenceStyleSearchPrompt(omittedNames)
        : referenceProductSearchPrompt(omittedNames);
    const isLowQuality =
      mode === "style"
        ? isLowQualityStyleReference
        : isLowQualityProductReference;
    const response = await openai.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            searchContext,
            searchQueries: keywords,
            currentUserRequest: userRequest,
            omittedFictionalNames: omittedNames,
            sameMissionReferencePreferenceContext: referencePreferenceContext,
          }),
        },
      ],
    });
    const seen = new Set<string>();
    const parsed = parseWebReferences(responseText(response)).filter(
      (reference) => {
        const canonical = canonicalUrl(reference.url);
        if (!canonical || seen.has(canonical) || blockedUrls.has(canonical)) {
          return false;
        }
        seen.add(canonical);
        return !isLowQuality(
          reference.title ?? "",
          reference.url,
          reference.source ?? "",
        );
      },
    );
    // Limit concurrency to 3 to avoid hammering external sites simultaneously
    const hydrated = await withConcurrency(
      parsed.slice(0, 6).map((ref) => () => hydrateReferenceMetadata(ref)),
      3,
    );
    return hydrated.slice(0, targetCount);
  } catch (error) {
    console.error(`[references] ${mode} web search failed`, error);
    return [];
  }
}

export async function POST(request: Request) {
  // Parse body separately so malformed JSON returns a 400 instead of an unhandled 500
  let body: {
    missionTitle?: unknown;
    missionBrief?: unknown;
    customQuery?: unknown;
    userRequest?: unknown;
    existingReferences?: unknown;
    referencePreferenceContext?: unknown;
    requestedCount?: unknown;
    styleImage?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Sanitize all user inputs before any use in LLM prompts
  const missionTitle = sanitizeInput(body.missionTitle);
  const missionBrief = sanitizeInput(body.missionBrief);
  const customQuery = sanitizeInput(body.customQuery) || null;
  // The raw latest user message. Authoritative for the current turn's intent and
  // may carry corrections/exclusions ("브랜드 말고 개인 포트폴리오") that the
  // assembled customQuery cannot express on its own.
  const userRequest = sanitizeInput(body.userRequest) || null;
  const { existingReferences } = body;
  // Honor an explicit requested count (clamped); default to FINAL_REFERENCE_COUNT.
  const rawCount = Number(body.requestedCount);
  const targetCount =
    Number.isFinite(rawCount) && rawCount > 0
      ? Math.min(Math.floor(rawCount), MAX_REFERENCE_COUNT)
      : FINAL_REFERENCE_COUNT;
  const referencePreferenceContext = compactReferencePreferenceContext(
    body.referencePreferenceContext,
  );
  const styleImageRecord =
    body.styleImage && typeof body.styleImage === "object"
      ? (body.styleImage as Record<string, unknown>)
      : null;
  const styleImageDataUrl = safeImageDataUrl(styleImageRecord?.dataUrl);

  if (!missionTitle && !missionBrief && !customQuery) {
    return Response.json(
      { error: "missionTitle, missionBrief, or customQuery required" },
      { status: 400 },
    );
  }

  try {
    const blockedUrls = new Set<string>();
    if (Array.isArray(existingReferences)) {
      existingReferences.forEach((reference) => {
        const url = canonicalUrl(String(reference?.url ?? ""));
        if (url) blockedUrls.add(url);
      });
    }

    const imageStyleSearchCues = await describeStyleImageForSearch(
      styleImageDataUrl,
      {
        missionTitle,
        missionBrief,
        customQuery,
        userRequest,
      },
    );
    const imageStyleContext = imageStyleSearchCues
      ? `Attached style image search cues: ${imageStyleSearchCues}`
      : "";
    const searchContext = [
      missionTitle,
      missionBrief,
      customQuery,
      imageStyleContext,
    ]
      .filter(Boolean)
      .join(" ");
    const omittedNames = fictionalPersonaNames(
      missionTitle,
      missionBrief,
      customQuery,
      imageStyleSearchCues,
    );
    const referenceMode = await inferReferenceMode(
      missionTitle,
      missionBrief,
      [customQuery, imageStyleContext].filter(Boolean).join(" ") || null,
    );
    const keywords = await buildSearchQueries(
      missionTitle,
      missionBrief,
      [customQuery, imageStyleContext].filter(Boolean).join(" ") || null,
      referenceMode,
      omittedNames,
      referencePreferenceContext,
      userRequest,
    );

    const found = await searchWebReferences(
      referenceMode,
      keywords,
      searchContext,
      blockedUrls,
      omittedNames,
      referencePreferenceContext,
      targetCount,
      userRequest,
    );

    const defaultDescription =
      referenceMode === "style"
        ? "비주얼 스타일 참고 레퍼런스"
        : "실제 제품/UX 의사결정 참고 레퍼런스";
    const defaultRationale =
      referenceMode === "style"
        ? "현재 미션의 비주얼 방향을 잡는 데 참고하기 좋습니다."
        : "현재 미션의 제품/UX 의사결정에 참고하기 좋습니다.";

    const references = found.slice(0, targetCount).map(
      (reference): ReferenceCard => ({
        id: `ref-${crypto.randomUUID()}`,
        title: reference.title || reference.url,
        description: reference.description || defaultDescription,
        rationale:
          reference.rationale || reference.description || defaultRationale,
        tag: domainFor(reference.url, reference.source),
        url: reference.url,
        imageUrl: reference.imageUrl || undefined,
        referenceMode,
        searchProvider: "openai-web",
      }),
    );

    return Response.json({
      mode: referenceMode,
      references,
      imageStyleSearchCues: imageStyleSearchCues || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
