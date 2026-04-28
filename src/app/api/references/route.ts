import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function extractKeywords(missionTitle: string, missionBrief: string): Promise<string[]> {
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

async function searchImages(query: string, raw = false): Promise<SerperImage[]> {
  const q = raw ? query : `${query} app UI design mobile`;
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, num: 10 }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.images ?? []) as SerperImage[];
}

export async function POST(request: Request) {
  const { missionTitle, missionBrief, customQuery } = await request.json();

  if (!missionTitle && !missionBrief && !customQuery) {
    return Response.json({ error: "missionTitle, missionBrief, or customQuery required" }, { status: 400 });
  }

  try {
    const keywords: string[] = customQuery
      ? [customQuery]
      : await extractKeywords(missionTitle ?? "", missionBrief ?? "");

    const results = await Promise.all(keywords.map((kw) => searchImages(kw, !!customQuery)));

    const seen = new Set<string>();
    const references: {
      id: string;
      title: string;
      description: string;
      tag: string;
      url: string;
      imageUrl: string;
    }[] = [];

    results.forEach((images, kwIdx) => {
      images.forEach((img, i) => {
        if (!img.imageUrl || seen.has(img.imageUrl)) return;
        seen.add(img.imageUrl);
        const domain = (() => { try { return new URL(img.link).hostname.replace("www.", ""); } catch { return img.source; } })();
        references.push({
          id: `ref-${Date.now()}-${kwIdx}-${i}`,
          title: img.title || keywords[kwIdx],
          description: `${keywords[kwIdx]} 관련 UI 레퍼런스`,
          tag: domain,
          url: img.link,
          imageUrl: img.imageUrl,
        });
      });
    });

    return Response.json({ references: references.slice(0, 3) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
