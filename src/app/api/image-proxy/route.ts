import { getGoogleAccessToken } from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const IMAGE_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

function firebaseStorageMediaUrl(parsed: URL) {
  if (parsed.hostname !== "firebasestorage.googleapis.com") return null;

  const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!match) return null;

  const [, bucket, objectName] = match;
  const encodedObjectName = encodeURIComponent(decodeURIComponent(objectName));
  const mediaUrl = new URL(
    `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(
      decodeURIComponent(bucket),
    )}/o/${encodedObjectName}`,
  );
  mediaUrl.searchParams.set("alt", "media");
  return mediaUrl;
}

async function fetchUpstreamImage(parsed: URL) {
  const storageMediaUrl = firebaseStorageMediaUrl(parsed);
  if (storageMediaUrl) {
    const token = await getGoogleAccessToken(
      "https://www.googleapis.com/auth/devstorage.read_only",
    );
    return fetch(storageMediaUrl, {
      headers: {
        Accept: IMAGE_ACCEPT,
        Authorization: `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0 VibeDesignAgent image proxy",
      },
      signal: AbortSignal.timeout(10000),
    });
  }

  return fetch(parsed.toString(), {
    headers: {
      Accept: IMAGE_ACCEPT,
      "User-Agent": "Mozilla/5.0 VibeDesignAgent image proxy",
    },
    signal: AbortSignal.timeout(10000),
  });
}

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
    const res = await fetchUpstreamImage(parsed);

    if (!res.ok) {
      console.warn("[image-proxy] upstream failed:", res.status, url.slice(0, 120));
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
    console.warn("[image-proxy] request error:", message, url.slice(0, 120));
    return Response.json({ error: message }, { status: 500 });
  }
}
