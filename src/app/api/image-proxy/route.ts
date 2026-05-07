export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return Response.json({ error: "unsupported protocol" }, { status: 400 });
  }

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 VibeDesignAgent image proxy",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return Response.json({ error: `fetch failed: ${res.status}` }, { status: 502 });
    }

    const rawContentType = res.headers.get("content-type") || "";
    const contentType = rawContentType.startsWith("image/")
      ? rawContentType
      : "image/jpeg";
    if (
      rawContentType &&
      !rawContentType.startsWith("image/") &&
      rawContentType !== "application/octet-stream"
    ) {
      return Response.json({ error: "unsupported asset type" }, { status: 415 });
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
