import OpenAI from "openai";
import { createSign, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

export const maxDuration = 120;
export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SlideInput = {
  title: string;
  content: string;
  imagePrompt: string;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

let accessTokenCache: { token: string; expiresAt: number } | null = null;
let serviceAccountCache: ServiceAccount | null = null;

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getServiceAccount() {
  if (serviceAccountCache) return serviceAccountCache;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "vibedesignagent-key.json");
  serviceAccountCache = JSON.parse(await readFile(keyPath, "utf8")) as ServiceAccount;
  return serviceAccountCache;
}

async function getAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const serviceAccount = await getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.full_control",
    aud: serviceAccount.token_uri,
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const res = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) throw new Error(`Storage auth failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function uploadPresentationImage(dataUrl: string, objectName: string) {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucket || !dataUrl.startsWith("data:image/")) return null;

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const [, contentType, base64] = match;
  const imageBuffer = Buffer.from(base64, "base64");
  const downloadToken = randomUUID();
  const boundary = `presentation-${randomUUID()}`;
  const metadata = {
    name: objectName,
    contentType,
    cacheControl: "public, max-age=31536000",
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  };

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const token = await getAccessToken();
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media&token=${downloadToken}`;
}

export async function POST(request: Request) {
  const { title, slides, uid = "anonymous", missionId = "unknown" } = await request.json();

  if (!slides || !Array.isArray(slides) || slides.length === 0) {
    return Response.json({ error: "slides array required" }, { status: 400 });
  }

  // Always generate exactly one slide
  const results = await Promise.allSettled(
    slides.slice(0, 1).map(async (slide: SlideInput) => {
      const prompt = `Presentation slide for "${title || "Pitch Deck"}". Slide: "${slide.title}". ${slide.imagePrompt}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await openai.images.generate({ model: "gpt-image-2", prompt, n: 1, size: "1536x1024", quality: "medium" } as any) as { data: Array<{ b64_json?: string; url?: string }> };

      const img = response.data[0];
      const imageUrl = img.b64_json
        ? `data:image/png;base64,${img.b64_json}`
        : (img.url ?? "");

      if (!imageUrl.startsWith("data:")) {
        return { title: slide.title, content: slide.content, imageUrl };
      }

      try {
        const objectName = `presentations/${uid}/${missionId}/slide-${Date.now()}-${randomUUID()}.png`;
        const uploadedUrl = await uploadPresentationImage(imageUrl, objectName);
        return { title: slide.title, content: slide.content, imageUrl: uploadedUrl ?? imageUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[presentation] server storage upload failed:", message);
        return { title: slide.title, content: slide.content, imageUrl };
      }
    })
  );

  const generatedSlides = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { title: slides[i].title, content: slides[i].content, imageUrl: "" }
  );

  return Response.json({ slides: generatedSlides });
}
