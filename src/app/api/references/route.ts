import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;

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

async function extractKeywords(
  missionTitle: string,
  missionBrief: string,
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract 3 concise UI/UX search keywords from the design mission. Return ONLY a JSON array of strings, e.g. ["keyword1", "keyword2", "keyword3"]. Each keyword should be 1-3 words suitable for image search.`,
      },
      {
        role: "user",
        content: `Mission title: ${missionTitle ?? ""}\nMission brief: ${missionBrief ?? ""}`,
      },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [missionTitle ?? "mobile app UI"];
  try {
    return JSON.parse(match[0]);
  } catch {
    return [missionTitle ?? "mobile app UI"];
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
  raw = false,
): Promise<SerperImage[]> {
  const q = raw ? query : `${query} app UI design mobile`;
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, num: 10 }),
  });
  if (!res.ok) {
    console.error("[Serper API Error]", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.images ?? []) as SerperImage[];
}

export async function POST(request: Request) {
  const { missionTitle, missionBrief, customQuery } = await request.json();

  if (!missionTitle && !missionBrief && !customQuery) {
    return Response.json(
      { error: "missionTitle, missionBrief, or customQuery required" },
      { status: 400 },
    );
  }

  try {
    const keywords: string[] = customQuery
      ? [customQuery]
      : await extractKeywords(missionTitle ?? "", missionBrief ?? "");

    const results = await Promise.all(
      keywords.map((kw) => searchImages(kw, !!customQuery)),
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
        if (!img.link || seen.has(img.link)) return;
        seen.add(img.link);
        const domain = (() => {
          try {
            return new URL(img.link).hostname.replace("www.", "");
          } catch {
            return img.source;
          }
        })();
        candidates.push({ kwIdx, i, img, domain });
      });
    });

    const resolved = await Promise.all(
      candidates.map(async ({ kwIdx, i, img, domain }) => {
        const ogImage = await fetchOgImage(img.link);
        const imageUrl = ogImage ?? img.imageUrl;
        if (!imageUrl) return null;
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
