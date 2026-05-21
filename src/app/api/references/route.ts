import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;

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
  return parts
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9가-힣]{4,}/g)
    ?.filter((term) => !GENERIC_SEARCH_TERMS.has(term))
    .slice(0, 6) ?? [];
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

function isLowQualityListing(title: string, link: string, source: string) {
  const text = `${title} ${link} ${source}`;
  return (
    /browse thousands/i.test(text) ||
    /dashboard case study/i.test(text) ||
    /case study saas/i.test(text) ||
    /\/search\/?/i.test(link) ||
    /\/tags?\//i.test(link) ||
    /\/topics?\//i.test(link)
  );
}

function matchesReferenceIntent(
  img: SerperImage,
  domain: string,
  requiredPattern: RegExp | null,
  significantTerms: string[],
) {
  const haystack = `${img.title} ${img.source} ${img.link} ${domain}`.toLowerCase();
  if (isLowQualityListing(img.title, img.link, img.source)) return false;
  if (requiredPattern && !requiredPattern.test(haystack)) return false;
  if (significantTerms.length === 0) return true;
  return significantTerms.some((term) => haystack.includes(term));
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const p = new RegExp(
    `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`,
    "i",
  );
  return html.match(p)?.[1] ?? "";
}

async function fetchOgImage(link: string): Promise<string | null> {
  try {
    const res = await fetch(link, {
      headers: { "User-Agent": "Mozilla/5.0 VibeDesignAgent reference crawler", Accept: "text/html" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const raw =
      metaContent(html, "og:image") ||
      metaContent(html, "twitter:image") ||
      metaContent(html, "twitter:image:src");
    if (!raw) return null;
    return new URL(raw, link).toString();
  } catch {
    return null;
  }
}

async function buildSearchQueries(
  missionTitle: string,
  missionBrief: string,
  customQuery: string | null,
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Create 3 high-quality Google image search queries for finding real UI/UX website or product references.
Return ONLY a JSON array of strings.
Each query should be specific, concrete, and include the product domain, target platform, UI artifact, and desired visual or structural direction when available.
Prefer real websites, product pages, landing pages, portfolios, case studies, design systems, or reputable design galleries.
Every query must preserve the concrete domain nouns from the user request, such as "wine", "sommelier", "fashion", or "wellness".
Avoid generic dashboard, B2B SaaS, or broad gallery-browse queries unless the user explicitly requested those.
Do not include duplicate queries.`,
      },
      {
        role: "user",
        content: `Mission title: ${missionTitle ?? ""}\nMission brief: ${missionBrief ?? ""}\nUser requested reference search: ${customQuery ?? ""}`,
      },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [customQuery || missionTitle || "mobile app UI"];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed)
      ? parsed.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3)
      : [customQuery || missionTitle || "mobile app UI"];
  } catch {
    return [customQuery || missionTitle || "mobile app UI"];
  }
}

type SerperImage = {
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  source: string;
  link: string;
};

async function searchImages(
  query: string,
  context: string,
): Promise<SerperImage[]> {
  const requiredPattern = requiredDomainPattern(context, query);
  const q = requiredPattern
    ? `${query} ${context} -dashboard -B2B -SaaS`
    : `${query} app UI design mobile`;
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY!,
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

export async function POST(request: Request) {
  const { missionTitle, missionBrief, customQuery, existingReferences } =
    await request.json();

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

    const keywords = await buildSearchQueries(
      missionTitle ?? "",
      missionBrief ?? "",
      customQuery ? String(customQuery) : null,
    );
    const searchContext = [missionTitle, missionBrief, customQuery]
      .filter(Boolean)
      .join(" ");
    const requiredPattern = requiredDomainPattern(searchContext);
    const significantTerms = significantQueryTerms(searchContext);

    const results = await Promise.all(
      keywords.map((kw) => searchImages(kw, searchContext)),
    );

    const seen = new Set<string>();
    const candidates: {
      kwIdx: number;
      i: number;
      img: SerperImage;
      domain: string;
    }[] = [];

    results.forEach((images, kwIdx) => {
      images.forEach((img, i) => {
        const url = canonicalUrl(img.link);
        const imageUrl = canonicalUrl(img.imageUrl || img.thumbnailUrl);
        if (!img.link || !url || seen.has(url) || blockedUrls.has(url)) return;
        if (imageUrl && blockedImages.has(imageUrl)) return;
        seen.add(url);
        const domain = domainFor(img.link, img.source);
        if (
          !matchesReferenceIntent(
            img,
            domain,
            requiredPattern,
            significantTerms,
          )
        ) {
          return;
        }
        candidates.push({ kwIdx, i, img, domain });
      });
    });

    const resolved = await Promise.all(
      candidates.map(async ({ kwIdx, i, img, domain }) => {
        const ogImage = await fetchOgImage(img.link);
        const imageUrl = ogImage ?? img.imageUrl;
        if (!imageUrl) return null;
        const canonicalImage = canonicalUrl(imageUrl);
        if (canonicalImage && blockedImages.has(canonicalImage)) return null;
        return {
          id: `ref-${Date.now()}-${kwIdx}-${i}`,
          title: img.title || keywords[kwIdx],
          description: `${keywords[kwIdx]} 관련 UI 레퍼런스`,
          tag: domain,
          url: img.link,
          imageUrl,
        };
      }),
    );

    const references = resolved.filter(Boolean);

    return Response.json({ references: references.slice(0, 3) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
