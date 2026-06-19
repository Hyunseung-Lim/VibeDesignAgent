import {
  downloadStorageObject,
  getFirebaseStorageAccessToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const objectName = String(searchParams.get("path") ?? "").trim();
  if (!objectName.startsWith("mission-assets/")) {
    return Response.json({ error: "invalid asset path" }, { status: 400 });
  }

  try {
    const token = await getFirebaseStorageAccessToken();
    const storageRes = await downloadStorageObject(objectName, token);
    const contentType =
      storageRes.headers.get("content-type") || "application/octet-stream";
    const cacheControl =
      storageRes.headers.get("cache-control") || "public, max-age=31536000";
    return new Response(storageRes.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
