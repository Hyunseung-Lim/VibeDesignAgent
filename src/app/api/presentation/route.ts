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

type MockupStyle = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  fontFamily: string;
  radius: number;
  notes: string;
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

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map(char => char + char).join("")
    : normalized;
  const int = parseInt(value, 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function normalizeColor(color: string) {
  const value = color.trim().toLowerCase();
  if (value.startsWith("#")) {
    const rgb = hexToRgb(value);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
  }
  const rgbMatch = value.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (rgbMatch) {
    return rgbToHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
  }
  return null;
}

function luminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function saturation(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const values = [rgb.r, rgb.g, rgb.b].map(v => v / 255);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max === 0 ? 0 : (max - min) / max;
}

function extractMockupStyle(html?: string): MockupStyle {
  const fallback: MockupStyle = {
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    accent: "#6366f1",
    border: "#e2e8f0",
    fontFamily: "Inter, Arial, sans-serif",
    radius: 28,
    notes: "",
  };
  if (!html) return fallback;

  const colorMatches = html.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g) ?? [];
  const counts = new Map<string, number>();
  for (const raw of colorMatches) {
    const normalized = normalizeColor(raw);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  const lightColors = colors.filter(color => luminance(color) > 0.72);
  const darkColors = colors.filter(color => luminance(color) < 0.28);
  const accentColors = colors.filter(color => luminance(color) >= 0.18 && luminance(color) <= 0.82 && saturation(color) > 0.18);
  const borderColors = colors.filter(color => luminance(color) > 0.55 && luminance(color) <= 0.9);
  const fontMatch = html.match(/font-family\s*:\s*([^;"'}]+)/i);
  const radiusValues = [...html.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/gi)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value));
  const avgRadius = radiusValues.length
    ? Math.round(radiusValues.reduce((sum, value) => sum + value, 0) / radiusValues.length)
    : fallback.radius;

  const style = {
    background: lightColors[0] ?? fallback.background,
    surface: lightColors.find(color => color !== lightColors[0]) ?? "#ffffff",
    text: darkColors[0] ?? fallback.text,
    muted: darkColors[1] ?? fallback.muted,
    accent: accentColors[0] ?? darkColors[0] ?? fallback.accent,
    border: borderColors[0] ?? fallback.border,
    fontFamily: fontMatch?.[1]?.trim().replace(/['"]/g, "") || fallback.fontFamily,
    radius: Math.max(8, Math.min(42, avgRadius)),
  };

  return {
    ...style,
    notes: `Extracted mockup style: background ${style.background}, surface ${style.surface}, text ${style.text}, muted ${style.muted}, accent ${style.accent}, border ${style.border}, font ${style.fontFamily}, radius ${style.radius}px.`,
  };
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

type Callout = {
  label: string;
  description: string;
  side: "left" | "right";
  yRatio: number;
};

function buildPresentationCallouts(slide: SlideInput): Callout[] {
  const source = [slide.content, slide.imagePrompt].filter(Boolean).join("\n");
  const lines = source
    .split(/\n+/)
    .map(line => line.replace(/^[-•]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const fallback = [
    ["Navigation", "Clarify the first entry point and make primary actions easy to find."],
    ["Hero", "Explain the core offer quickly with headline, supporting copy, and CTA."],
    ["Trust", "Use logos, metrics, or testimonials to establish credibility."],
    ["Features", "Show the concrete benefits and product capabilities users should remember."],
    ["Why Choose Us", "Make the differentiators obvious with concise visual proof."],
    ["Reviews", "Let customer proof reduce doubt and build confidence."],
    ["FAQ", "Answer common objections before users hesitate."],
    ["Final CTA", "End with a focused conversion moment that repeats the main action."],
  ];

  const items = (lines.length >= 4 ? lines : fallback.map(([label, description]) => `${label}: ${description}`));
  const yRatios = [0.07, 0.16, 0.28, 0.42, 0.56, 0.7, 0.83, 0.94];

  return items.slice(0, 8).map((item, index) => {
    const [rawLabel, ...rest] = item.split(/[:—-]/);
    const label = rawLabel?.trim().slice(0, 42) || fallback[index]?.[0] || `Section ${index + 1}`;
    const description = rest.join(" ").trim() || fallback[index]?.[1] || item;
    return {
      label,
      description: description.slice(0, 170),
      side: index % 2 === 0 ? "left" : "right",
      yRatio: yRatios[index] ?? 0.5,
    };
  });
}

function composePresentationSlide(
  slide: SlideInput,
  title: string | undefined,
  mockupScreenshot: string,
  device: string | undefined,
  style: MockupStyle,
  screenshotWidth?: number,
  screenshotHeight?: number,
) {
  const isMobile = device === "mobile";
  const pageW = 1536;
  const shotW = screenshotWidth && screenshotWidth > 0 ? screenshotWidth : (isMobile ? 390 : 1280);
  const shotH = screenshotHeight && screenshotHeight > 0 ? screenshotHeight : (isMobile ? 1600 : 2400);
  const mockupW = isMobile ? 520 : 880;
  const mockupH = Math.round(mockupW * (shotH / shotW));
  const topPad = 190;
  const bottomPad = 120;
  const pageH = Math.max(1400, topPad + mockupH + bottomPad);
  const mockupX = Math.round((pageW - mockupW) / 2);
  const mockupY = topPad;
  const leftTextX = 42;
  const rightTextX = mockupX + mockupW + 58;
  const titleText = slide.title || title || "Landing Page Breakdown";
  const callouts = buildPresentationCallouts(slide);
  const labelFont = escapeXml(style.fontFamily);
  const calloutEls = callouts.map((callout) => {
    const textX = callout.side === "left" ? leftTextX : rightTextX;
    const lineStartX = callout.side === "left" ? leftTextX + 200 : rightTextX - 18;
    const lineEndX = callout.side === "left" ? mockupX + 34 : mockupX + mockupW - 34;
    const y = mockupY + Math.round(mockupH * callout.yRatio);
    const labelLines = wrapText(callout.label, 18).slice(0, 2);
    const descLines = wrapText(callout.description, 30).slice(0, 3);
    const labelY = y - 18;
    const descY = labelY + labelLines.length * 30 + 16;
    return `<g>
      <line x1="${lineStartX}" y1="${y}" x2="${lineEndX}" y2="${y}" stroke="${escapeXml(style.text)}" stroke-width="2" opacity="0.72" />
      <path d="${callout.side === "left" ? `M ${lineEndX - 10} ${y - 6} L ${lineEndX} ${y} L ${lineEndX - 10} ${y + 6}` : `M ${lineEndX + 10} ${y - 6} L ${lineEndX} ${y} L ${lineEndX + 10} ${y + 6}`}" fill="none" stroke="${escapeXml(style.text)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.72" />
      ${labelLines.map((line, i) => `<text x="${textX}" y="${labelY + i * 30}" fill="${escapeXml(style.text)}" font-family="${labelFont}" font-size="27" font-weight="800">${escapeXml(line)}</text>`).join("")}
      ${descLines.map((line, i) => `<text x="${textX}" y="${descY + i * 19}" fill="${escapeXml(style.muted)}" font-family="${labelFont}" font-size="14" font-weight="500">${escapeXml(line)}</text>`).join("")}
    </g>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${escapeXml(style.background)}"/><stop offset="1" stop-color="${escapeXml(style.surface)}"/></linearGradient>
    <filter id="shadow" x="-12%" y="-2%" width="124%" height="108%"><feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="${escapeXml(style.text)}" flood-opacity="0.14"/></filter>
  </defs>
  <rect width="${pageW}" height="${pageH}" fill="url(#bg)" />
  <text x="${pageW / 2}" y="104" text-anchor="middle" fill="${escapeXml(style.text)}" font-family="${labelFont}" font-size="58" font-weight="900">${escapeXml(titleText)}</text>
  <text x="${pageW / 2}" y="146" text-anchor="middle" fill="${escapeXml(style.muted)}" font-family="${labelFont}" font-size="18" font-weight="600">Full-page mockup breakdown with section-level rationale</text>
  <g filter="url(#shadow)">
    <rect x="${mockupX}" y="${mockupY}" width="${mockupW}" height="${mockupH}" rx="${style.radius}" fill="${escapeXml(style.surface)}" stroke="${escapeXml(style.border)}" />
    <clipPath id="mockupClip"><rect x="${mockupX}" y="${mockupY}" width="${mockupW}" height="${mockupH}" rx="${style.radius}" /></clipPath>
    <image href="${escapeXml(mockupScreenshot)}" x="${mockupX}" y="${mockupY}" width="${mockupW}" height="${mockupH}" preserveAspectRatio="xMidYMid meet" clip-path="url(#mockupClip)" />
  </g>
  ${calloutEls}
  <rect x="${mockupX}" y="${pageH - 70}" width="${mockupW}" height="1" fill="${escapeXml(style.border)}" />
  <text x="${mockupX}" y="${pageH - 38}" fill="${escapeXml(style.muted)}" font-family="${labelFont}" font-size="15">Generated from the actual full-page mockup screenshot</text>
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
  const { title, slides, uid = "anonymous", missionId = "unknown", mockupHtml, mockupScreenshot, mockupScreenshotWidth, mockupScreenshotHeight, device } = await request.json();

  if (!slides || !Array.isArray(slides) || slides.length === 0) {
    return Response.json({ error: "slides array required" }, { status: 400 });
  }

  const mockupContext = compactMockupHtml(mockupHtml);
  const mockupStyle = extractMockupStyle(mockupHtml);
  const deviceContext = device === "mobile" ? "mobile app/landing mockup in a 390x844 phone frame" : "desktop landing page mockup in a 1280x900 browser frame";

  // Always generate exactly one slide
  const results = await Promise.allSettled(
    slides.slice(0, 1).map(async (slide: SlideInput) => {
      if (typeof mockupScreenshot === "string" && mockupScreenshot.startsWith("data:image/")) {
        const imageUrl = composePresentationSlide(
          slide,
          title,
          mockupScreenshot,
          device,
          mockupStyle,
          Number(mockupScreenshotWidth),
          Number(mockupScreenshotHeight),
        );
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
        `Match the generated presentation's background, typography, spacing, border radius, accent colors, and UI detailing to the mockup style. Do not use a generic pitch deck theme if it conflicts with the mockup.`,
        mockupStyle.notes,
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
