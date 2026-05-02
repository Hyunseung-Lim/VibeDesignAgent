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
        "User-Agent": "Mozilla/5.0 VibeDesignAgent image capture",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json({ error: `fetch failed: ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type")?.split(";")[0] || "image/png";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "not an image" }, { status: 415 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) {
      return Response.json({ error: "image too large" }, { status: 413 });
    }

    return Response.json({
      dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
