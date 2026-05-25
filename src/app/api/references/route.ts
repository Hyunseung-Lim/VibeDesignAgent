import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const QUERY_MODEL = "gpt-5.4";
const RERANK_MODEL = "gpt-4o";
const MAX_RERANK_CANDIDATES = 18;
const FINAL_REFERENCE_COUNT = 3;

// Verified via Serper /search test: these domains return results with site: operator
const CURATION_DOMAINS = [
  "awwwards.com",
  "siteinspire.com",
  "cssdesignawards.com",
  "godly.website",
  "mobbin.com",
  "refero.design",
  "siteofsites.co",
  "craftwork.design",
  "component.gallery",
];

type ReferenceMode = "style" | "product";
type SearchProvider = "openai-web" | "serper-image";

const STRUCTURE_REFERENCE_PATTERN =
  /구조\s*참고|구조|레이아웃\s*참고|섹션\s*구성|화면\s*구성|정보\s*구조|와이어프레임|layout\s+reference|layout|structure|section\s+structure|content\s+structure|information\s+architecture|wireframe/i;

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

const GENERIC_SEARCH_TERMS = new Set([
  "reference",
  "references",
  "design",
  "style",
  "landing",
  "page",
  "desktop",
  "mobile",
  "website",
  "web",
  "app",
  "product",
  "service",
  "high",
  "quality",
  "premium",
  "editorial",
  "serif",
  "beige",
  "bright",
  "clean",
  "quiet",
  "luxury",
  "recommendation",
  "photography",
  "mockup",
  "case",
  "study",
  "dashboard",
  "saas",
]);

function significantQueryTerms(...parts: Array<string | null | undefined>) {
  return (
    parts
      .join(" ")
      .toLowerCase()
      .match(/[a-z0-9가-힣]{4,}/g)
      ?.filter((term) => !GENERIC_SEARCH_TERMS.has(term))
      .slice(0, 6) ?? []
  );
}

function requiredDomainPattern(...parts: Array<string | null | undefined>) {
  const text = parts.join(" ").toLowerCase();
  if (/wine|winery|vineyard|sommelier|vino|vivino|pour/.test(text)) {
    return /wine|winery|vineyard|sommelier|vino|vivino|pour|oenolog|cellar|grape/i;
  }
  if (/fashion|outfit|wardrobe|styling|clothing|apparel/.test(text)) {
    return /fashion|outfit|wardrobe|styling|clothing|apparel|lookbook/i;
  }
  if (/wellness|mental|health|meditation|therapy|fitness/.test(text)) {
    return /wellness|mental|health|meditation|therapy|fitness|mindfulness/i;
  }
  return null;
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
          content: `Classify the reference search intent.
Return ONLY {"mode":"style"} or {"mode":"product"}.

style: user wants visual mood, aesthetic inspiration, color, typography, beautiful images for design style.
product: user wants real products, websites, apps, UX flows, feature/structure/layout examples, case studies, references for product decisions or writing a design memo.
If the request asks for 구조 참고, layout reference, structure, section composition, information architecture, or wireframe, choose product even if it mentions hero sections.`,
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
    /dashboard case study/.test(text) ||
    /case study saas/.test(text) ||
    /freepik|shutterstock|istockphoto|alamy|pngtree|vecteezy|depositphotos|stock photo/.test(
      text,
    ) ||
    /pinterest\./.test(text) ||
    /\/search\/?/.test(text) ||
    /\/tags?\//.test(text) ||
    /\/topics?\//.test(text) ||
    /\/collections?\//.test(text) ||
    /\/boards?\//.test(text)
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
    /instagram\.com|facebook\.com|x\.com|twitter\.com|threads\.net|tiktok\.com/.test(
      text,
    ) ||
    /\/p\/|\/reel\/|\/status\//.test(text)
  );
}

function matchesReferenceIntent(
  img: SerperImage,
  domain: string,
  requiredPattern: RegExp | null,
  significantTerms: string[],
) {
  const haystack =
    `${img.title} ${img.source} ${img.link} ${domain}`.toLowerCase();
  if (isLowQualityListing(img.title, img.link, img.source)) return false;
  if (requiredPattern && !requiredPattern.test(haystack)) return false;
  if (significantTerms.length === 0) return true;
  return significantTerms.some((term) => haystack.includes(term));
}

function isAcceptableFallbackCandidate(
  img: SerperImage,
  domain: string,
  requiredPattern: RegExp | null,
  significantTerms: string[],
) {
  const haystack =
    `${img.title} ${img.source} ${img.link} ${domain}`.toLowerCase();
  if (isLowQualityListing(img.title, img.link, img.source)) return false;
  if (requiredPattern?.test(haystack)) return true;
  return significantTerms.some((term) => haystack.includes(term));
}

async function buildSearchQueries(
  missionTitle: string,
  missionBrief: string,
  customQuery: string | null,
  mode: ReferenceMode,
  omittedNames: string[],
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
        content: `Create 3 high-quality Google search queries for finding ${mode === "style" ? "visual style inspiration images" : "real product, website, app, UX, or case-study references"}.
Return ONLY a JSON array of strings.
Each query should be specific, concrete, and include the product domain, target platform, UI artifact, and desired visual or structural direction when available.
${mode === "style" ? "Prefer image-rich style references, design galleries, portfolios, app screenshots, landing page screenshots, visual systems, and mood references." : "Prefer official websites, product pages, app pages, landing pages, design systems, concrete UX flows, specific case studies, and reputable design articles."}
Every query must preserve the concrete domain nouns from the user request, such as "wine", "sommelier", "fashion", or "wellness".
If the mission contains a fictional persona or selected option name, DO NOT search the exact name. Search by role, domain, mood, medium, and UI artifact instead.
Do not include these fictional names in any query: ${omittedNames.join(", ") || "(none)"}.
Avoid generic dashboard, B2B SaaS, or broad gallery-browse queries unless the user explicitly requested those.
When the user provided a custom query, refine it instead of replacing it.
Keep each query under 12 words when possible.
Do not include duplicate queries.`,
      },
      {
        role: "user",
        content: `Mission title: ${missionTitle ?? ""}\nMission brief: ${missionBrief ?? ""}\nUser requested reference search: ${customQuery ?? ""}`,
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

type SerperImage = {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  source: string;
  link: string;
};

type ReferenceCandidate = {
  kwIdx: number;
  i: number;
  img: SerperImage;
  domain: string;
};

type RankedReference = {
  url: string;
  title?: string;
  description?: string;
  score?: number;
};

type ProductReference = {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string | null;
  source?: string;
};

type ReferenceCard = {
  id: string;
  title: string;
  description: string;
  tag: string;
  url: string;
  imageUrl?: string;
  referenceMode: ReferenceMode;
  searchProvider: SearchProvider;
};

type RankedReferenceCandidate = ReferenceCandidate & {
  ranked?: RankedReference | null;
};

async function searchCurationSites(
  keywords: string[],
): Promise<SerperImage[]> {
  if (!SERPER_API_KEY) return [];
  const siteFilter = CURATION_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  const queries = keywords.slice(0, 2).map((kw) => `${kw} ${siteFilter}`);
  const batches = await Promise.all(
    queries.map(async (q) => {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q, num: 8 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.organic ?? []) as Array<{
        link?: string;
        title?: string;
        snippet?: string;
        displayLink?: string;
      }>;
    }),
  );
  const seen = new Set<string>();
  const images: SerperImage[] = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (!item.link || seen.has(item.link)) continue;
      const domain = domainFor(item.link, item.displayLink);
      // Discard results that leaked outside the curation domains (Serper doesn't always respect site:)
      if (!CURATION_DOMAINS.some((d) => domain.endsWith(d))) continue;
      seen.add(item.link);
      images.push({
        title: item.title ?? "",
        imageUrl: "",         // filled later via hydrateReferenceMetadata
        thumbnailUrl: "",
        source: domain,
        link: item.link,
      });
    }
  }
  return images;
}

async function searchImages(
  query: string,
  context: string,
  mode: ReferenceMode,
): Promise<SerperImage[]> {
  if (!SERPER_API_KEY) {
    console.error("[references] SERPER_API_KEY is not configured");
    return [];
  }
  const requiredPattern = requiredDomainPattern(context, query);
  const q = requiredPattern
    ? mode === "style"
      ? `${query} UI visual inspiration screenshot -stock`
      : `${query} real product UI layout structure reference -dashboard -B2B -SaaS -pinterest -instagram -template`
    : mode === "style"
      ? `${query} UI visual style inspiration app website screenshot -stock`
      : `${query} real product UI website app layout structure reference -pinterest -instagram -template -stock`;
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, num: 20 }),
  });
  if (!res.ok) {
    console.error("[Serper API Error]", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.images ?? []) as SerperImage[];
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
      // Accept both "output_text" (responses API) and "text" (potential future variants)
      if (content.type === "output_text" || content.type === "text") {
        text += content.text ?? "";
      }
    }
  }
  return text;
}

function parseRankedReferences(text: string): RankedReference[] {
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
        score:
          typeof item?.score === "number" && Number.isFinite(item.score)
            ? item.score
            : undefined,
      }))
      .filter((item) => item.url);
  } catch {
    return [];
  }
}

function parseProductReferences(text: string): ProductReference[] {
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
        imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
        source: item?.source ? String(item.source) : undefined,
      }))
      .filter((item) => item.url);
  } catch {
    return [];
  }
}

async function hydrateReferenceMetadata(reference: ProductReference) {
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

async function rerankReferenceCandidates(
  candidates: ReferenceCandidate[],
  keywords: string[],
  searchContext: string,
  mode: ReferenceMode,
): Promise<RankedReferenceCandidate[]> {
  if (candidates.length === 0) return [];
  try {
    const candidatePayload = candidates.map(({ img, domain }, index) => ({
      id: index,
      title: img.title,
      url: img.link,
      source: img.source,
      domain,
      imageUrl: img.imageUrl || img.thumbnailUrl,
    }));
    const response = await openai.responses.create({
      model: RERANK_MODEL,
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "system",
          content: `You rank UI/UX design references for a design tool.
Return ONLY a JSON array with up to ${FINAL_REFERENCE_COUNT} objects:
[{"url":"...","title":"...","description":"...","score":0.0}]

${mode === "style" ? "Choose references with strong visual style, useful mood, layout, color, typography, and aesthetic inspiration. Image quality matters." : "Choose concrete, inspectable references useful for product decisions, UX structure, feature patterns, writing a design memo, or comparing real products."}
${mode === "style" ? "Design galleries, portfolios, screenshots, and visual case studies are acceptable when they are relevant and image-rich." : "Prefer real product pages, official websites, design systems, specific case studies, specific app/screen pages, and reputable editorial design articles."}
Avoid stock asset pages, generic search/tag/category pages, thin SEO listicles, irrelevant dashboards, and pages unrelated to the user's product domain.${mode === "style" ? "" : " Avoid Pinterest pins/boards."}
Use web search when needed to verify what a candidate URL actually is.
Descriptions must be short Korean phrases explaining why it is useful as a reference.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            searchContext,
            searchQueries: keywords,
            candidates: candidatePayload,
          }),
        },
      ],
    });
    const ranked = parseRankedReferences(responseText(response));
    const byUrl = new Map(
      candidates.map((candidate) => [
        canonicalUrl(candidate.img.link),
        candidate,
      ]),
    );
    const selected: RankedReferenceCandidate[] = [];
    ranked.forEach((item) => {
      const candidate = byUrl.get(canonicalUrl(item.url));
      if (candidate) selected.push({ ...candidate, ranked: item });
    });
    return selected.slice(0, FINAL_REFERENCE_COUNT);
  } catch (error) {
    console.error("[references] rerank failed", error);
    return [];
  }
}

async function searchProductReferences(
  keywords: string[],
  searchContext: string,
  blockedUrls: Set<string>,
  omittedNames: string[],
) {
  try {
    const response = await openai.responses.create({
      model: RERANK_MODEL,
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "system",
          content: `Find high-quality UI/UX product references for a design tool.
Return ONLY a JSON array with up to 6 objects:
[{"url":"...","title":"...","description":"...","imageUrl":null,"source":"..."}]

Find actual pages that help a designer make product or UX decisions: official product pages, app pages, landing pages, design systems, concrete case studies, UX flow examples, or reputable design articles.
If the project brief contains fictional people/personas, do not search or return pages for the exact fictional name. Use the persona's role, domain, mood, medium, and UI artifact instead.
Never return pages for these fictional names: ${omittedNames.join(", ") || "(none)"}.
Avoid stock image sites, Pinterest, Instagram/social posts, generic tag/search pages, template marketplaces, and thin SEO listicles.
Descriptions must be short Korean phrases explaining the concrete design/UX value.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            searchContext,
            searchQueries: keywords,
            omittedFictionalNames: omittedNames,
          }),
        },
      ],
    });
    const seen = new Set<string>();
    const parsed = parseProductReferences(responseText(response)).filter(
      (reference) => {
        const canonical = canonicalUrl(reference.url);
        if (!canonical || seen.has(canonical) || blockedUrls.has(canonical)) {
          return false;
        }
        seen.add(canonical);
        return !isLowQualityProductReference(
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
    return hydrated.slice(0, FINAL_REFERENCE_COUNT);
  } catch (error) {
    console.error("[references] product web search failed", error);
    return [];
  }
}

export async function POST(request: Request) {
  // Parse body separately so malformed JSON returns a 400 instead of an unhandled 500
  let body: {
    missionTitle?: unknown;
    missionBrief?: unknown;
    customQuery?: unknown;
    existingReferences?: unknown;
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
  const { existingReferences } = body;

  if (!missionTitle && !missionBrief && !customQuery) {
    return Response.json(
      { error: "missionTitle, missionBrief, or customQuery required" },
      { status: 400 },
    );
  }

  try {
    const blockedUrls = new Set<string>();
    const blockedImages = new Set<string>();
    if (Array.isArray(existingReferences)) {
      existingReferences.forEach((reference) => {
        const url = canonicalUrl(String(reference?.url ?? ""));
        const imageUrl = canonicalUrl(String(reference?.imageUrl ?? ""));
        if (url) blockedUrls.add(url);
        if (imageUrl) blockedImages.add(imageUrl);
      });
    }

    const searchContext = [missionTitle, missionBrief, customQuery]
      .filter(Boolean)
      .join(" ");
    const omittedNames = fictionalPersonaNames(
      missionTitle,
      missionBrief,
      customQuery,
    );
    const referenceMode = await inferReferenceMode(
      missionTitle,
      missionBrief,
      customQuery,
    );
    const keywords = await buildSearchQueries(
      missionTitle,
      missionBrief,
      customQuery,
      referenceMode,
      omittedNames,
    );

    const productReferences =
      referenceMode === "product"
        ? await searchProductReferences(
            keywords,
            searchContext,
            blockedUrls,
            omittedNames,
          )
        : [];
    if (productReferences.length >= FINAL_REFERENCE_COUNT) {
      return Response.json({
        mode: referenceMode,
        references: productReferences.map(
          (reference): ReferenceCard => ({
            id: `ref-${crypto.randomUUID()}`,
            title: reference.title || reference.url,
            description:
              reference.description || "실제 제품/UX 의사결정 참고 레퍼런스",
            tag: domainFor(reference.url, reference.source),
            url: reference.url,
            imageUrl: reference.imageUrl || undefined,
            referenceMode,
            searchProvider: "openai-web",
          }),
        ),
      });
    }

    const requiredPattern = requiredDomainPattern(searchContext);
    const significantTerms = significantQueryTerms(searchContext);

    // For style mode, search curation galleries in parallel with regular image search
    const [imageResults, curationImages] = await Promise.all([
      Promise.all(keywords.map((kw) => searchImages(kw, searchContext, referenceMode))),
      referenceMode === "style" ? searchCurationSites(keywords) : Promise.resolve([] as SerperImage[]),
    ]);
    // Curation results appended as an extra batch (kwIdx = keywords.length)
    const results = curationImages.length > 0
      ? [...imageResults, curationImages]
      : imageResults;

    const seen = new Set<string>();
    const candidates: ReferenceCandidate[] = [];
    const fallbackCandidates: typeof candidates = [];
    const emergencyCandidates: typeof candidates = [];

    results.forEach((images, kwIdx) => {
      images.forEach((img, i) => {
        const url = canonicalUrl(img.link);
        const imageUrl = canonicalUrl(img.imageUrl || img.thumbnailUrl);
        if (!img.link || !url || seen.has(url) || blockedUrls.has(url)) return;
        if (imageUrl && blockedImages.has(imageUrl)) return;
        seen.add(url);
        const domain = domainFor(img.link, img.source);
        if (!isLowQualityListing(img.title, img.link, img.source)) {
          emergencyCandidates.push({ kwIdx, i, img, domain });
        }
        if (
          !matchesReferenceIntent(
            img,
            domain,
            requiredPattern,
            significantTerms,
          )
        ) {
          if (
            isAcceptableFallbackCandidate(
              img,
              domain,
              requiredPattern,
              significantTerms,
            )
          ) {
            fallbackCandidates.push({ kwIdx, i, img, domain });
          }
          return;
        }
        candidates.push({ kwIdx, i, img, domain });
      });
    });

    const candidatePool = (
      candidates.length > 0
        ? candidates
        : fallbackCandidates.length > 0
          ? fallbackCandidates
          : emergencyCandidates
    ).slice(0, MAX_RERANK_CANDIDATES);

    const rankedCandidates = await rerankReferenceCandidates(
      candidatePool,
      keywords,
      searchContext,
      referenceMode,
    );
    const selectedCandidates =
      rankedCandidates.length > 0
        ? rankedCandidates
        : candidatePool
            .slice(0, FINAL_REFERENCE_COUNT)
            .map((candidate) => ({ ...candidate, ranked: null }));

    const resolved = await Promise.all(
      selectedCandidates.map(async (candidate) => {
        const { kwIdx, img, domain } = candidate;
        let imageUrl = img.imageUrl || img.thumbnailUrl;
        // Curation site pages (awwwards, godly, etc.) have no Serper imageUrl —
        // try fetching the og:image from the actual page
        if (!imageUrl && CURATION_DOMAINS.some((d) => domain.endsWith(d))) {
          const hydrated = await hydrateReferenceMetadata({ url: img.link, title: img.title });
          imageUrl = hydrated.imageUrl ?? "";
        }
        if (!imageUrl) return null;
        const canonicalImage = canonicalUrl(imageUrl);
        if (canonicalImage && blockedImages.has(canonicalImage)) return null;
        const ranked = candidate.ranked;
        const kwLabel = keywords[kwIdx] ?? searchContext.slice(0, 40);
        return {
          id: `ref-${crypto.randomUUID()}`,
          title: ranked?.title || img.title || kwLabel,
          description: ranked?.description || `${kwLabel} 관련 UI 레퍼런스`,
          tag: domain,
          url: img.link,
          imageUrl,
          referenceMode,
          searchProvider: "serper-image" as const,
        } satisfies ReferenceCard;
      }),
    );

    const productCards = productReferences.map(
      (reference): ReferenceCard => ({
        id: `ref-${crypto.randomUUID()}`,
        title: reference.title || reference.url,
        description:
          reference.description || "실제 제품/UX 의사결정 참고 레퍼런스",
        tag: domainFor(reference.url, reference.source),
        url: reference.url,
        imageUrl: reference.imageUrl || undefined,
        referenceMode,
        searchProvider: "openai-web",
      }),
    );
    const references = [...productCards, ...resolved.filter(Boolean)];

    return Response.json({
      mode: referenceMode,
      references: references.slice(0, FINAL_REFERENCE_COUNT),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
