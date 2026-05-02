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

function compactMockupHtml(html?: string) {
  if (!html) return "";
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const visibleText = withoutScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  const structuralHtml = withoutScripts
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);

  return [
    visibleText ? `Visible text from mockup: ${visibleText}` : "",
    structuralHtml ? `HTML structure/classes from mockup: ${structuralHtml}` : "",
  ].filter(Boolean).join("\n");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxChars: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function composePresentationSlide(slide: SlideInput, title: string | undefined, mockupScreenshot: string, device?: string) {
  const isMobile = device === "mobile";
  const frameX = isMobile ? 104 : 88;
  const frameY = isMobile ? 142 : 178;
  const frameW = isMobile ? 390 : 760;
  const frameH = isMobile ? 844 : 535;
  const panelX = isMobile ? 585 : 910;
  const panelW = isMobile ? 830 : 500;
  const titleLines = wrapText(slide.title || title || "Presentation", 34).slice(0, 2);
  const bullets = slide.content
    .split(/\n+/)
    .map(line => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  let y = 166;
  const titleText = titleLines.map((line, i) => `<text x="${panelX}" y="${y + i * 58}" fill="#0f172a" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="800">${escapeXml(line)}</text>`).join("");
  y += Math.max(titleLines.length, 1) * 58 + 34;

  const bulletText = bullets.map((bullet) => {
    const lines = wrapText(bullet, isMobile ? 48 : 30).slice(0, 3);
    const startY = y;
    y += lines.length * 28 + 28;
    return [
      `<circle cx="${panelX + 8}" cy="${startY - 8}" r="5" fill="#6366f1" />`,
      ...lines.map((line, i) => `<text x="${panelX + 28}" y="${startY + i * 28}" fill="#334155" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="500">${escapeXml(line)}</text>`),
    ].join("");
  }).join("");

  const frameRadius = isMobile ? 42 : 28;
  const topBar = isMobile
    ? `<rect x="${frameX + 135}" y="${frameY + 18}" width="120" height="20" rx="10" fill="#0f172a" opacity="0.9" />`
    : `<rect x="${frameX}" y="${frameY}" width="${frameW}" height="44" rx="22" fill="#111827" /><circle cx="${frameX + 24}" cy="${frameY + 22}" r="6" fill="#ef4444" /><circle cx="${frameX + 44}" cy="${frameY + 22}" r="6" fill="#f59e0b" /><circle cx="${frameX + 64}" cy="${frameY + 22}" r="6" fill="#22c55e" />`;
  const imageY = isMobile ? frameY : frameY + 44;
  const imageH = isMobile ? frameH : frameH - 44;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#eef2ff"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#0f172a" flood-opacity="0.22"/></filter>
  </defs>
  <rect width="1536" height="1024" fill="url(#bg)" />
  <text x="88" y="86" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="3">GENERATED MOCKUP PRESENTATION</text>
  <g filter="url(#shadow)">
    <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" rx="${frameRadius}" fill="#ffffff" />
    ${topBar}
    <clipPath id="mockupClip"><rect x="${frameX}" y="${imageY}" width="${frameW}" height="${imageH}" rx="${isMobile ? 34 : 0}" /></clipPath>
    <image href="${escapeXml(mockupScreenshot)}" x="${frameX}" y="${imageY}" width="${frameW}" height="${imageH}" preserveAspectRatio="xMidYMid meet" clip-path="url(#mockupClip)" />
  </g>
  <rect x="${panelX - 34}" y="116" width="${panelW + 68}" height="720" rx="30" fill="#ffffff" opacity="0.76" />
  ${titleText}
  ${bulletText}
  <text x="${panelX}" y="904" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="20">${escapeXml(title || "Pitch Deck")}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function normalizeServiceAccount(account: ServiceAccount): ServiceAccount {
  return {
    ...account,
    private_key: account.private_key.replace(/\\n/g, "\n"),
    token_uri: account.token_uri || "https://oauth2.googleapis.com/token",
  };
}

async function getServiceAccount() {
  if (serviceAccountCache) return serviceAccountCache;
  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (rawKey) {
    const decoded = rawKey.trim().startsWith("{")
      ? rawKey
      : Buffer.from(rawKey, "base64").toString("utf8");
    serviceAccountCache = normalizeServiceAccount(JSON.parse(decoded) as ServiceAccount);
    return serviceAccountCache;
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    serviceAccountCache = normalizeServiceAccount({
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
      token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    });
    return serviceAccountCache;
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "vibedesignagent-key.json");
  serviceAccountCache = normalizeServiceAccount(JSON.parse(await readFile(keyPath, "utf8")) as ServiceAccount);
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage auth failed: ${res.status} ${text.slice(0, 200)}`);
  }
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media&token=${downloadToken}`;
}

export async function POST(request: Request) {
  const { title, slides, uid = "anonymous", missionId = "unknown", mockupHtml, mockupScreenshot, device } = await request.json();

  if (!slides || !Array.isArray(slides) || slides.length === 0) {
    return Response.json({ error: "slides array required" }, { status: 400 });
  }

  const mockupContext = compactMockupHtml(mockupHtml);
  const deviceContext = device === "mobile" ? "mobile app/landing mockup in a 390x844 phone frame" : "desktop landing page mockup in a 1280x900 browser frame";

  // Always generate exactly one slide
  const results = await Promise.allSettled(
    slides.slice(0, 1).map(async (slide: SlideInput) => {
      if (typeof mockupScreenshot === "string" && mockupScreenshot.startsWith("data:image/")) {
        const imageUrl = composePresentationSlide(slide, title, mockupScreenshot, device);
        try {
          const objectName = `presentations/${uid}/${missionId}/slide-${Date.now()}-${randomUUID()}.svg`;
          const uploadedUrl = await uploadPresentationImage(imageUrl, objectName);
          return { title: slide.title, content: slide.content, imageUrl: uploadedUrl ?? imageUrl };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[presentation] composed slide storage upload failed:", message);
          return { title: slide.title, content: slide.content, imageUrl };
        }
      }

      const prompt = [
        `Presentation slide for "${title || "Pitch Deck"}".`,
        `Slide: "${slide.title}".`,
        `The presentation must faithfully showcase the actual generated mockup as a central visual artifact, not a generic replacement.`,
        `Use a ${deviceContext}. Reflect the mockup's real layout, visible copy, sections, color palette, typography feel, cards/buttons/navigation, and visual hierarchy.`,
        mockupContext,
        slide.imagePrompt,
      ].filter(Boolean).join("\n\n");
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
