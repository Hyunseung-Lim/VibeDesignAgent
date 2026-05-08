export const runtime = "nodejs";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const metaPattern = new RegExp(
    `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`,
    "i",
  );
  return html.match(metaPattern)?.[1] ?? "";
}

function pageTitle(html: string) {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");
  if (!rawUrl) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return Response.json({ error: "unsupported protocol" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 VibeDesignAgent reference metadata",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return Response.json({ title: null, imageUrl: null });
    }

    const html = (await res.text()).slice(0, 400_000);
    const title =
      decodeHtml(metaContent(html, "og:title")) ||
      decodeHtml(metaContent(html, "twitter:title")) ||
      pageTitle(html) ||
      null;
    const image =
      decodeHtml(metaContent(html, "og:image")) ||
      decodeHtml(metaContent(html, "twitter:image")) ||
      decodeHtml(metaContent(html, "twitter:image:src"));
    const imageUrl = image ? new URL(image, url).toString() : null;

    return Response.json({ title, imageUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ title: null, imageUrl: null, error: message });
  }
}
