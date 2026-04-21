import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  const { title, description } = await request.json();

  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: `Find the most relevant web page for "${title}" app UI design related to "${description}".
Prefer specific pages from: mobbin.com (individual app or screen page), dribbble.com (specific shot), uxdesign.cc, bootcamp.uxdesign.cc, or medium.com design articles.
Return ONLY a JSON object: {"sourceUrl": "<most relevant URL>", "sourceTitle": "<page title>"}`,
    });

    let text = "";
    const citedUrls: string[] = [];

    for (const item of response.output ?? []) {
      if (item.type !== "message") continue;
      for (const content of (item as { type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string }> }> }).content ?? []) {
        if (content.type === "output_text") {
          if (content.text) text += content.text;
          for (const ann of content.annotations ?? []) {
            if (ann.type === "url_citation" && ann.url) citedUrls.push(ann.url);
          }
        }
      }
    }

    try {
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.sourceUrl) {
          return Response.json({
            sourceUrl: parsed.sourceUrl,
            sourceTitle: parsed.sourceTitle ?? null,
            sourceDomain: new URL(parsed.sourceUrl).hostname.replace("www.", ""),
          });
        }
      }
    } catch { /* fall through */ }

    if (citedUrls[0]) {
      return Response.json({
        sourceUrl: citedUrls[0],
        sourceTitle: null,
        sourceDomain: new URL(citedUrls[0]).hostname.replace("www.", ""),
      });
    }

    return Response.json({ sourceUrl: null, sourceTitle: null, sourceDomain: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ sourceUrl: null, sourceTitle: null, sourceDomain: null, _error: message });
  }
}
