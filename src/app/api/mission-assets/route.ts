import {
  downloadStorageObject,
  getFirebaseStorageAccessToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ASSET_CACHE_TTL_MS = 10 * 60 * 1000;
type AssetCacheEntry = {
  body: Buffer;
  contentType: string;
  cacheControl: string;
  expiresAt: number;
};

const assetCache = new Map<string, AssetCacheEntry>();
const pendingAssetLoads = new Map<string, Promise<AssetCacheEntry>>();

async function loadAsset(objectName: string) {
  const cached = assetCache.get(objectName);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const pending = pendingAssetLoads.get(objectName);
  if (pending) return pending;

  const loadPromise = (async () => {
    const token = await getFirebaseStorageAccessToken();
    const storageRes = await downloadStorageObject(objectName, token);
    const contentType =
      storageRes.headers.get("content-type") || "application/octet-stream";
    const cacheControl =
      storageRes.headers.get("cache-control") || "public, max-age=31536000";
    const body = Buffer.from(await storageRes.arrayBuffer());
    const loaded = {
      body,
      contentType,
      cacheControl,
      expiresAt: Date.now() + ASSET_CACHE_TTL_MS,
    };
    assetCache.set(objectName, loaded);
    return loaded;
  })().finally(() => {
    pendingAssetLoads.delete(objectName);
  });

  pendingAssetLoads.set(objectName, loadPromise);
  return loadPromise;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const objectName = String(searchParams.get("path") ?? "").trim();
  if (!objectName.startsWith("mission-assets/")) {
    return Response.json({ error: "invalid asset path" }, { status: 400 });
  }

  try {
    const asset = await loadAsset(objectName);
    return new Response(new Uint8Array(asset.body), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": asset.cacheControl,
        "Content-Length": String(asset.body.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
