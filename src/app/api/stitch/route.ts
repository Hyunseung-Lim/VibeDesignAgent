import { StitchToolClient } from "@google/stitch-sdk";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import OpenAI from "openai";
import {
  createStitchClient,
  isStitchAuthError,
  STITCH_AUTH_ERROR_CODE,
  STITCH_AUTH_ERROR_MESSAGE,
  STITCH_OAUTH_REQUIRED_ERROR_CODE,
  STITCH_OAUTH_REQUIRED_ERROR_MESSAGE,
} from "@/lib/server/stitch-auth";
import {
  downloadStorageObject,
  getFirebaseStorageAccessToken,
} from "@/lib/server/firebaseAdminRest";
import {
  DESIGN_SYSTEM_EXTRACT_PROMPT,
  DERIVE_DESIGN_MD_FROM_HTML_PROMPT,
  STITCH_DESIGN_FONTS,
  STITCH_DESIGN_ROUNDNESS,
  styleImageReconstructPrompt,
  assetImageEmbedPrompt,
} from "@/lib/prompts";

export const maxDuration = 180;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type DeviceType = "MOBILE" | "DESKTOP";
type StitchClientBundle = Awaited<ReturnType<typeof createStitchClient>>;
type StitchProject = ReturnType<StitchClientBundle["sdk"]["project"]>;

type StitchFont = (typeof STITCH_DESIGN_FONTS)[number];
type StitchRoundness = (typeof STITCH_DESIGN_ROUNDNESS)[number];

type DesignThemeTokens = {
  colorMode: "LIGHT" | "DARK";
  customColor: string;
  headlineFont: StitchFont;
  bodyFont: StitchFont;
  roundness: StitchRoundness;
};

function styleHash(content: string) {
  return createHash("sha1").update(content).digest("hex");
}

function contentHash(content: string) {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) | 0;
  }
  return hash.toString(16);
}

// Convert the free-form 디자인 스타일 markdown into structured Stitch design
// tokens. Falls back to safe defaults on any parsing/validation issue so a bad
// extraction never blocks generation.
async function extractDesignTokens(
  content: string,
): Promise<DesignThemeTokens> {
  const fallback: DesignThemeTokens = {
    colorMode: "LIGHT",
    customColor: "#4F46E5",
    headlineFont: "INTER",
    bodyFont: "INTER",
    roundness: "ROUND_EIGHT",
  };
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DESIGN_SYSTEM_EXTRACT_PROMPT },
        { role: "user", content: content.slice(0, 8000) },
      ],
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as Record<string, unknown>;
    const asFont = (v: unknown): StitchFont | null =>
      typeof v === "string" &&
      (STITCH_DESIGN_FONTS as readonly string[]).includes(v)
        ? (v as StitchFont)
        : null;
    const asRoundness = (v: unknown): StitchRoundness | null =>
      typeof v === "string" &&
      (STITCH_DESIGN_ROUNDNESS as readonly string[]).includes(v)
        ? (v as StitchRoundness)
        : null;
    const hex = /^#[0-9a-fA-F]{6}$/;
    return {
      colorMode: parsed.colorMode === "DARK" ? "DARK" : "LIGHT",
      customColor:
        typeof parsed.customColor === "string" && hex.test(parsed.customColor)
          ? parsed.customColor
          : fallback.customColor,
      headlineFont: asFont(parsed.headlineFont) ?? fallback.headlineFont,
      bodyFont: asFont(parsed.bodyFont) ?? fallback.bodyFont,
      roundness: asRoundness(parsed.roundness) ?? fallback.roundness,
    };
  } catch (err) {
    console.warn("[stitch] design token extraction failed:", errorMessage(err));
    return fallback;
  }
}

// Ensure the project's design system reflects the active 시안's design style.
// Hash-gated by the caller, so this only runs when the style actually changed.
async function applyDesignSystem(
  project: StitchProject,
  content: string,
  existingId: string | null,
): Promise<string | null> {
  const tokens = await extractDesignTokens(content);
  const input = {
    displayName: "Design style",
    theme: { ...tokens, designMd: content.slice(0, 8000) },
  };
  try {
    // Reuse the project's existing design system when the client lost track of
    // the id (e.g. page refresh) so we don't accumulate orphan design systems.
    let targetId = existingId;
    if (!targetId) {
      const existing = await project.listDesignSystems().catch(() => []);
      targetId = existing[0]?.id ?? null;
    }
    if (targetId) {
      const ds = project.designSystem(targetId);
      await ds.update(input);
      return ds.id;
    }
    const ds = await project.createDesignSystem(input);
    // create_design_system requires a follow-up update to apply it to the project.
    try {
      await ds.update(input);
    } catch (err) {
      console.warn("[stitch] design system apply (update) failed:", errorMessage(err));
    }
    return ds.id;
  } catch (err) {
    console.warn("[stitch] design system create/update failed:", errorMessage(err));
    return existingId;
  }
}
type StitchScreenHandle = {
  id: string;
  getHtml: () => Promise<string>;
};

type MaterializedScreen = {
  screen: StitchScreenHandle;
  html: string;
  htmlPending: boolean;
  score: number;
};

const INCOMPLETE_RESPONSE_ERROR = "Incomplete API response";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stitchErrorResponse(error: unknown, prefix?: string) {
  const message = errorMessage(error);
  if (isStitchAuthError(error)) {
    return Response.json(
      {
        error: STITCH_AUTH_ERROR_MESSAGE,
        code: STITCH_AUTH_ERROR_CODE,
      },
      { status: 401 },
    );
  }
  return Response.json(
    { error: prefix ? `${prefix}: ${message}` : message },
    { status: 500 },
  );
}

function isIncompleteResponseError(error: unknown) {
  return errorMessage(error).includes(INCOMPLETE_RESPONSE_ERROR);
}

function isTransientStitchError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return /service is currently unavailable|temporarily unavailable|try again|timeout|timed out|rate limit|429|500|502|503|504|econnreset|fetch failed/.test(
    message,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientRetry<T>(
  label: string,
  run: () => Promise<T>,
  attempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (!isTransientStitchError(err) || attempt === attempts) break;
      const delay = 1500 * attempt + Math.floor(Math.random() * 500);
      console.warn(
        `[stitch] ${label} failed transiently; retrying ${attempt}/${attempts - 1} in ${delay}ms:`,
        errorMessage(err),
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[stitch] ${label} timed out after ${ms}ms`);
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function scoreGeneratedScreen(html: string, prompt: string) {
  const lowerHtml = html.toLowerCase();
  const lowerPrompt = prompt.toLowerCase();
  const text = visibleText(html).toLowerCase();
  const textLength = text.length;
  let score = 0;

  score += Math.min(30, Math.floor(html.length / 1500));
  score += Math.min(25, Math.floor(textLength / 250));
  score += countMatches(lowerHtml, /<(main|section|article|header|nav|footer)\b/g) * 8;
  score += countMatches(lowerHtml, /<(button|form|input|textarea|select)\b/g) * 4;
  score += countMatches(lowerHtml, /class=["'][^"']*(hero|cta|card|grid|section|nav|header|footer|feature|pricing|testimonial|gallery)[^"']*["']/g) * 4;

  if (/<html\b/i.test(html)) score += 8;
  if (/<body\b/i.test(html)) score += 8;
  if (/landing|website|web page|homepage|desktop|hero|section/.test(lowerPrompt)) {
    if (/<(main|section|header|nav)\b/i.test(html)) score += 18;
    if (/hero|cta|section|feature|navigation|headline/.test(text)) score += 10;
  }
  if (/mobile|app|screen/.test(lowerPrompt) && /nav|tab|button|card|screen/.test(text)) {
    score += 8;
  }

  const logoSignals = /logo|logomark|brand mark|wordmark|symbol|icon/.test(text);
  const websiteSignals =
    /hero|headline|section|navigation|cta|feature|pricing|testimonial|about|footer|form|recommendation/.test(text) ||
    /<(main|section|article|header|nav|footer|button|form)\b/i.test(html);
  if (logoSignals && !websiteSignals) score -= 50;
  if (textLength < 120 && lowerHtml.length < 2500) score -= 35;
  if (countMatches(lowerHtml, /<svg\b/g) > 0 && !/<(main|section|button|form)\b/i.test(html)) score -= 20;

  return score;
}

async function listScreens(project: StitchProject) {
  return project.screens().catch((err: unknown) => {
    console.warn("[stitch] list screens failed:", errorMessage(err));
    return [];
  });
}

function getNestedScreenCandidates(raw: unknown): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const hasScreenIdentity =
        typeof record.id === "string" ||
        (typeof record.name === "string" && record.name.includes("/screens/"));
      // Prefer screens with htmlCode — IMAGE-type screens only have screenshot
      const hasScreenPayload = "htmlCode" in record || "screenshot" in record;
      const isImageOnly = !("htmlCode" in record) && record.screenType === "IMAGE";
      if (hasScreenIdentity && hasScreenPayload && !isImageOnly) candidates.push(record);
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visit(child);
    }
  };

  visit(raw);
  return candidates;
}

function screenIdFromCandidate(candidate: Record<string, unknown>) {
  if (typeof candidate.id === "string") return candidate.id;
  if (typeof candidate.name === "string") {
    const parts = candidate.name.split("/screens/");
    if (parts.length === 2) return parts[1];
  }
  return null;
}

async function screenFromRawResponse(project: StitchProject, raw: unknown): Promise<StitchScreenHandle | null> {
  const candidates = getNestedScreenCandidates(raw);
  const candidate = candidates[0];
  if (!candidate) return null;

  const screenId = screenIdFromCandidate(candidate);
  if (screenId) {
    try {
      return await project.getScreen(screenId);
    } catch (err) {
      console.warn("[stitch] get recovered raw screen failed:", errorMessage(err));
    }
  }

  const htmlUrl = (candidate.htmlCode as { downloadUrl?: string } | undefined)?.downloadUrl ?? "";
  if (!htmlUrl) return null;

  return {
    id: screenId ?? `raw-${Date.now()}`,
    getHtml: async () => htmlUrl,
  };
}

async function generateScreen(client: StitchToolClient, project: StitchProject, prompt: string, deviceType: DeviceType, previousScreenIds: Set<string>) {
  const raw = await client.callTool("generate_screen_from_text", {
    projectId: project.id,
    prompt,
    deviceType,
  });
  const screenFromRaw = await screenFromRawResponse(project, raw);
  if (screenFromRaw) return screenFromRaw;

  const recovered = await recoverGeneratedScreen(project, previousScreenIds);
  if (recovered) return recovered;

  console.warn("[stitch] raw generate response had no screen:", JSON.stringify(raw).slice(0, 1000));
  throw new Error("Stitch generated a response without a usable screen. Please try again.");
}

async function editScreen(
  client: StitchToolClient,
  project: StitchProject,
  screenId: string,
  prompt: string,
  deviceType: DeviceType,
  previousScreenIds: Set<string>,
) {
  const raw = await withTransientRetry("edit_screens", () =>
    client.callTool("edit_screens", {
      projectId: project.id,
      selectedScreenIds: [screenId],
      prompt,
      deviceType,
    }),
  );
  const screenFromRaw = await screenFromRawResponse(project, raw);
  if (screenFromRaw) return screenFromRaw;

  const recovered = await recoverGeneratedScreen(project, previousScreenIds);
  if (recovered) return recovered;

  // edit_screens often mutates the selected screen but returns a text-only
  // output component, which makes the SDK projection throw even though the
  // edit succeeded. Re-read the selected screen before surfacing an error.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(1200);
    try {
      return await project.getScreen(screenId);
    } catch (err) {
      console.warn("[stitch] edited screen reread failed:", errorMessage(err));
    }
  }

  console.warn("[stitch] raw edit response had no screen:", JSON.stringify(raw).slice(0, 1000));
  throw new Error("Stitch edited the screen but did not return a usable screen. Please try again.");
}

async function recoverGeneratedScreen(
  project: StitchProject,
  previousScreenIds: Set<string>,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await sleep(1500);
    const screens = await listScreens(project);
    const newScreens = screens.filter((candidate) => candidate.id && !previousScreenIds.has(candidate.id));
    if (newScreens.length > 0) {
      const recovered = newScreens[newScreens.length - 1];
      console.warn("[stitch] recovered generated screen after incomplete response:", recovered.id);
      return recovered;
    }
  }
  return null;
}

async function waitForScreenHtml(
  project: StitchProject,
  screen: StitchScreenHandle,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await sleep(2500);
    const currentScreen =
      attempt === 0
        ? screen
        : await project.getScreen(screen.id).catch(() => screen);
    try {
      const htmlUrlOrContent = await currentScreen.getHtml();
      if (htmlUrlOrContent) return htmlUrlOrContent;
    } catch (err) {
      console.warn(
        "[stitch] getHtml() retry failed:",
        attempt + 1,
        errorMessage(err),
      );
    }
    console.warn("[stitch] getHtml() returned empty, retrying...", attempt + 1);
  }
  return "";
}

async function materializeHtml(htmlUrlOrContent: string) {
  if (!htmlUrlOrContent || !htmlUrlOrContent.startsWith("http")) {
    return htmlUrlOrContent;
  }
  const fetchRes = await fetch(htmlUrlOrContent);
  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch HTML from Stitch URL: ${fetchRes.status}`);
  }
  return fetchRes.text();
}

async function waitForChangedScreenHtml(
  project: StitchProject,
  screen: StitchScreenHandle,
  previousHtmlHash: string | null,
) {
  let lastHtml = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(2500);
    const currentScreen = await project.getScreen(screen.id).catch(() => screen);
    const htmlUrlOrContent = await currentScreen.getHtml().catch(() => "");
    if (!htmlUrlOrContent) {
      console.warn("[stitch] edit changed-html check returned empty:", attempt + 1);
      continue;
    }
    const html = await materializeHtml(htmlUrlOrContent);
    lastHtml = html;
    const hash = contentHash(html);
    if (!previousHtmlHash || hash !== previousHtmlHash) {
      if (previousHtmlHash) {
        console.log("[stitch] edit HTML changed after refresh:", attempt + 1);
      }
      return html;
    }
    console.warn("[stitch] edit HTML unchanged, retrying fresh screen read...", attempt + 1);
  }
  return lastHtml;
}

async function choosePrimaryScreen(
  project: StitchProject,
  screens: StitchScreenHandle[],
  fallbackScreen: StitchScreenHandle,
  prompt: string,
) {
  const unique = new Map<string, StitchScreenHandle>();
  for (const screen of [fallbackScreen, ...screens]) {
    if (screen?.id) unique.set(screen.id, screen);
  }
  const materialized = await Promise.all(
    Array.from(unique.values()).map(async (screen): Promise<MaterializedScreen> => {
      const htmlUrlOrContent = await waitForScreenHtml(project, screen);
      if (!htmlUrlOrContent) {
        return { screen, html: "", htmlPending: true, score: -100 };
      }
      const html = await materializeHtml(htmlUrlOrContent);
      return {
        screen,
        html,
        htmlPending: false,
        score: scoreGeneratedScreen(html, prompt),
      };
    }),
  );
  materialized.sort((a, b) => b.score - a.score);
  const selected = materialized[0] ?? {
    screen: fallbackScreen,
    html: "",
    htmlPending: true,
    score: -100,
  };
  console.log(
    "[stitch] screen scores:",
    materialized.map((item) => `${item.screen.id}:${item.score}`).join(", "),
  );
  return {
    selected,
    allScreenIds: Array.from(unique.keys()),
  };
}

function screenshotViewport(deviceType: DeviceType) {
  return deviceType === "MOBILE"
    ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 }
    : { width: 1280, height: 900, isMobile: false, deviceScaleFactor: 1 };
}

// Screenshot a live URL into a data URL. Abstracted so the engine can be
// swapped later (managed API with key, self-hosted Playwright, ...). v1 uses
// Microlink's no-key endpoint. Returns a base64 data URL; throws on failure.
async function captureScreenshot(
  rawUrl: string,
  deviceType: DeviceType,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid style source URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Style source URL must be http(s).");
  }
  const viewport = screenshotViewport(deviceType);
  const apiUrl = new URL("https://api.microlink.io/");
  apiUrl.searchParams.set("url", url.toString());
  apiUrl.searchParams.set("screenshot", "true");
  apiUrl.searchParams.set("meta", "false");
  apiUrl.searchParams.set("viewport.width", String(viewport.width));
  apiUrl.searchParams.set("viewport.height", String(viewport.height));
  apiUrl.searchParams.set("viewport.isMobile", String(viewport.isMobile));
  apiUrl.searchParams.set(
    "viewport.deviceScaleFactor",
    String(viewport.deviceScaleFactor),
  );
  const res = await fetch(apiUrl.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`Screenshot service returned ${res.status}.`);
  }
  const json = (await res.json()) as {
    data?: { screenshot?: { url?: string } };
  };
  const shotUrl = json?.data?.screenshot?.url;
  if (!shotUrl) {
    throw new Error("Screenshot service did not return an image.");
  }
  const imgRes = await fetch(shotUrl, { signal: AbortSignal.timeout(20_000) });
  if (!imgRes.ok) {
    throw new Error(`Failed to fetch captured screenshot: ${imgRes.status}.`);
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const STYLE_IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

// Decode a style-image data URL, downscale, and write a temp file for
// project.upload() (which reads from disk). Caller must unlink the path.
async function writeStyleImageTmp(dataUrl: string): Promise<string> {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid style image data URL.");
  const mime = match[1].toLowerCase();
  const raw = Buffer.from(match[2], "base64");
  if (raw.length > 12 * 1024 * 1024) {
    throw new Error("Style image is too large (max 12MB).");
  }
  let bytes: Buffer = raw;
  let ext = STYLE_IMAGE_EXT[mime] ?? "";
  try {
    bytes = await sharp(raw)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    ext = ".png";
  } catch (err) {
    if (!ext) throw new Error(`Unsupported style image type: ${mime}`);
    console.warn("[stitch] sharp normalize failed, using raw image:", errorMessage(err));
  }
  const tmpPath = path.join(os.tmpdir(), `vda-style-${randomUUID()}${ext}`);
  await writeFile(tmpPath, bytes);
  return tmpPath;
}

// Image-led generation: upload the reference screenshot as a Stitch screen,
// then edit() it into a working UI grounded in the actual pixels. Verified to
// preserve the source's light/dark palette and layout (dev_document 15.81).
async function generateScreenFromStyleImage(
  client: StitchToolClient,
  project: StitchProject,
  styleImageDataUrl: string,
  productPrompt: string,
  deviceType: DeviceType,
  previousScreenIds: Set<string>,
): Promise<StitchScreenHandle> {
  const tmpPath = await writeStyleImageTmp(styleImageDataUrl);
  let refScreen:
    | { id: string; edit: (p: string, d?: DeviceType) => Promise<StitchScreenHandle> }
    | undefined;
  try {
    const uploaded = await withTransientRetry("upload style image to Stitch", () =>
      project.upload(tmpPath, { title: "Style reference" }),
    );
    refScreen = Array.isArray(uploaded) ? uploaded[0] : undefined;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
  if (!refScreen) {
    throw new Error("Stitch did not return a screen for the uploaded style image.");
  }
  const deviceLabel =
    deviceType === "MOBILE" ? "mobile app screen" : "desktop website";
  const reconstructPrompt = styleImageReconstructPrompt(productPrompt, deviceLabel);
  return editScreen(
    client,
    project,
    refScreen.id,
    reconstructPrompt,
    deviceType,
    new Set([...previousScreenIds, refScreen.id]),
  );
}

type AssetImageRequest = {
  url: string;
  path: string;
  note: string;
};

function assetImageUrlFallbackPrompt(
  productPrompt: string,
  deviceLabel: string,
  assets: AssetImageRequest[],
) {
  const manifest = assets
    .map((asset, index) => {
      const url = asset.url || `/api/mission-assets?path=${encodeURIComponent(asset.path)}`;
      return [
        `Asset ${index + 1}`,
        `URL: ${url}`,
        `Meaning: ${asset.note || "No admin description provided."}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Create a high-fidelity ${deviceLabel} UI mockup for the brief below.`,
    `Use the mission asset URLs below as exact image sources in the generated HTML. Put each URL directly into img src attributes. Do not replace these images with generated placeholders, icons, gradients, or stock imagery. Preserve the natural aspect ratio and use the notes to place each item in the correct product/content slot.`,
    `Mission asset URLs:\n${manifest}`,
    `Design the surrounding layout, navigation, typography, spacing, cards, filters, and copy from the brief and active design direction.`,
    productPrompt ? `Brief:\n${productPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function stripMarkdownHtmlFence(content: string) {
  return content
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function completeHtmlDocument(content: string) {
  const html = stripMarkdownHtmlFence(content);
  if (/<!doctype html/i.test(html) || /<html[\s>]/i.test(html)) return html;
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<script src="https://cdn.tailwindcss.com"></script>',
    "</head>",
    '<body class="bg-white text-slate-950">',
    html,
    "</body>",
    "</html>",
  ].join("\n");
}

async function generateOpenAiAssetFallbackScreen(
  productPrompt: string,
  deviceType: DeviceType,
  assets: AssetImageRequest[],
): Promise<StitchScreenHandle> {
  const deviceLabel =
    deviceType === "MOBILE" ? "390px wide mobile app screen" : "responsive desktop website";
  const fallbackPrompt = assetImageUrlFallbackPrompt(productPrompt, deviceLabel, assets);
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_STITCH_FALLBACK_MODEL ?? "gpt-5.4-mini",
    messages: [
      {
        role: "system",
        content: [
          "You generate production-ready standalone HTML mockups.",
          "Return only complete HTML. Do not wrap it in markdown.",
          "Use Tailwind Play CDN or plain CSS inside the document.",
          "Use the provided asset URLs exactly as img src values.",
          "Do not mention that this is a fallback.",
        ].join("\n"),
      },
      {
        role: "user",
        content: fallbackPrompt,
      },
    ],
  });
  const html = completeHtmlDocument(
    completion.choices[0]?.message?.content ?? "",
  );
  if (!/<(main|section|article|div|body)\b/i.test(html)) {
    throw new Error("OpenAI HTML fallback returned no usable mockup markup.");
  }
  return {
    id: "",
    getHtml: async () => html,
  };
}

function storageObjectNameForAsset(image: Pick<AssetImageRequest, "url" | "path">) {
  const explicitPath = image.path.trim();
  if (explicitPath.startsWith("mission-assets/")) return explicitPath;

  if (!image.url) return "";
  try {
    const url = new URL(image.url);
    const proxyPath = url.searchParams.get("path") ?? "";
    if (proxyPath.startsWith("mission-assets/")) return proxyPath;

    const objectPath = url.pathname.match(/\/o\/([^/?]+)/)?.[1];
    if (objectPath) {
      const decoded = decodeURIComponent(objectPath);
      if (decoded.startsWith("mission-assets/")) return decoded;
    }
  } catch {
    return "";
  }

  return "";
}

async function responseToDataUrl(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function fetchStorageImageAsDataUrl(objectName: string) {
  return withTransientRetry(`download mission asset ${objectName}`, async () => {
    const token = await getFirebaseStorageAccessToken();
    const res = await downloadStorageObject(objectName, token);
    return responseToDataUrl(res);
  });
}

// Download a mission image into a base64 data URL so it can flow through the
// same temp-file + upload path as attached images. Prefer the Storage object
// path over fetching our own /api/mission-assets proxy; the proxy is for
// browsers, while this route can read Storage directly.
async function fetchImageAsDataUrl(image: AssetImageRequest): Promise<string> {
  const objectName = storageObjectNameForAsset(image);
  if (objectName) {
    try {
      return await fetchStorageImageAsDataUrl(objectName);
    } catch (err) {
      if (!image.url) throw err;
      console.warn(
        "[stitch] direct mission asset download failed; falling back to URL:",
        errorMessage(err),
      );
    }
  }

  const rawUrl = image.url;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid asset image URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Asset image URL must be http(s).");
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch asset image: ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
    );
  }
  return responseToDataUrl(res);
}

// Content-led generation: the mission supplies real content images (product
// photos, UI captures) that must appear in the mockup as-is. We upload them to
// the project and edit the first into a working UI, instructing the model to
// embed the uploaded images verbatim (see assetImageEmbedPrompt). Distinct from
// the style-image path, which treats an image as a look to reconstruct.
async function generateScreenFromAssetImages(
  client: StitchToolClient,
  project: StitchProject,
  assetImageDataUrls: string[],
  assetImageNotes: string[],
  productPrompt: string,
  deviceType: DeviceType,
  previousScreenIds: Set<string>,
): Promise<StitchScreenHandle> {
  let baseRefScreen:
    | { id: string; edit: (p: string, d?: DeviceType) => Promise<StitchScreenHandle> }
    | undefined;
  const uploadedScreenIds = new Set<string>();
  for (const dataUrl of assetImageDataUrls) {
    const tmpPath = await writeStyleImageTmp(dataUrl);
    try {
      const uploaded = await withTransientRetry("upload mission asset to Stitch", () =>
        project.upload(tmpPath, { title: "Mission asset" }),
      );
      const screen = Array.isArray(uploaded) ? uploaded[0] : undefined;
      if (screen?.id) uploadedScreenIds.add(screen.id);
      if (screen && !baseRefScreen) baseRefScreen = screen;
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }
  if (!baseRefScreen) {
    throw new Error("Stitch did not return a screen for the uploaded asset images.");
  }
  const deviceLabel =
    deviceType === "MOBILE" ? "mobile app screen" : "desktop website";
  const assetManifest = assetImageNotes
    .map((note, index) =>
      `Asset ${index + 1}: ${note || "No admin description provided."}`,
    )
    .join("\n");
  const embedPrompt = assetImageEmbedPrompt(
    productPrompt,
    deviceLabel,
    assetImageDataUrls.length,
    assetManifest,
  );
  return editScreen(
    client,
    project,
    baseRefScreen.id,
    embedPrompt,
    deviceType,
    new Set([...previousScreenIds, ...uploadedScreenIds]),
  );
}

// Reverse-extract a 디자인 스타일 note from the reconstructed (correct) HTML so
// later screens in the 시안 stay consistent. Grounded in the result, not the
// reference or brand priors. Best-effort: returns "" on failure.
async function deriveDesignStyleFromHtml(html: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: DERIVE_DESIGN_MD_FROM_HTML_PROMPT },
        { role: "user", content: html.slice(0, 14000) },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.warn("[stitch] derive design style failed:", errorMessage(err));
    return "";
  }
}

export async function POST(request: Request) {
  const {
    prompt,
    device,
    projectId,
    screenId,
    designStyle,
    designSystemId,
    appliedDesignStyleHash,
    previousHtmlHash,
    styleImage,
    styleSourceUrl,
    assetImages,
  } = (await request.json()) as {
    prompt?: string;
    device?: string;
    projectId?: string;
    screenId?: string;
    designStyle?: { content?: string } | null;
    designSystemId?: string | null;
    appliedDesignStyleHash?: string | null;
    previousHtmlHash?: string | null;
    styleImage?: { dataUrl?: string } | null;
    styleSourceUrl?: string | null;
    assetImages?: { url?: string; path?: string; note?: string }[] | null;
  };

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const deviceType: DeviceType = device === "mobile" ? "MOBILE" : "DESKTOP";
  // Image-led generation: a reference screenshot drives appearance via
  // upload→edit. Source is an attached image or a URL we screenshot. Only for
  // new screens (not edits of an existing artboard).
  const isImageLed = Boolean(styleImage?.dataUrl || styleSourceUrl) && !screenId;
  // Asset-led generation: the mission supplies real content images to embed
  // as-is. Only for new screens, and only when no style image is driving the
  // look (style image takes precedence as it defines the whole appearance).
  const assetImageInputs = (assetImages ?? [])
    .map((image) => ({
      url: typeof image?.url === "string" ? image.url.trim() : "",
      path: typeof image?.path === "string" ? image.path.trim() : "",
      note: typeof image?.note === "string" ? image.note.trim() : "",
    }))
    .filter((image) => image.url || image.path);
  const isAssetLed = assetImageInputs.length > 0 && !screenId && !isImageLed;

  try {
    let stitch: StitchClientBundle;
    try {
      stitch = await createStitchClient();
    } catch (authErr) {
      console.warn("[stitch] auth setup failed:", errorMessage(authErr));
      return Response.json(
        {
          error: STITCH_OAUTH_REQUIRED_ERROR_MESSAGE,
          code: STITCH_OAUTH_REQUIRED_ERROR_CODE,
        },
        { status: 401 },
      );
    }
    let { client, sdk } = stitch;
    let project;
    let actualProjectId: string = projectId ?? "";

    if (!projectId) {
      console.log("[stitch] creating project...");
      project = await sdk.createProject("VibeDesign");
      actualProjectId = project.id;
      console.log("[stitch] project created:", actualProjectId);
    } else {
      project = sdk.project(projectId);
    }

    // Sync the project-level design system with the active 시안's design style.
    // Stitch generation honors the project's active design system, so we only
    // touch it when the style content actually changed (hash gate) — keeping
    // repeated generations within one style free of extra calls.
    let resolvedDesignSystemId: string | null = designSystemId ?? null;
    let resolvedStyleHash: string | null = appliedDesignStyleHash ?? null;
    // Set when image-led generation screenshots a URL, so the client can show
    // which page was actually captured (it may differ from the intended page).
    let capturedUrl: string | null = null;
    // For image-led generation we do NOT pre-apply the existing (possibly stale)
    // design style — it would fight the screenshot. We derive a fresh style from
    // the reconstructed result instead (see below).
    const styleContent = isImageLed ? "" : designStyle?.content?.trim() ?? "";
    if (styleContent) {
      const hash = styleHash(styleContent);
      if (hash !== appliedDesignStyleHash || !designSystemId) {
        console.log("[stitch] applying design system (style changed)...");
        resolvedDesignSystemId = await applyDesignSystem(
          project,
          styleContent,
          designSystemId ?? null,
        );
        resolvedStyleHash = hash;
      }
    }

    const beforeScreens = await listScreens(project);
    let beforeScreenIds = new Set(beforeScreens.map((candidate) => candidate.id).filter(Boolean));
    let screen;

    if (isImageLed) {
      try {
        // Attached image wins; otherwise screenshot the provided URL.
        let styleImageDataUrl = styleImage?.dataUrl ?? null;
        if (!styleImageDataUrl && styleSourceUrl) {
          console.log("[stitch] capturing screenshot of style source URL...");
          styleImageDataUrl = await captureScreenshot(styleSourceUrl, deviceType);
          capturedUrl = styleSourceUrl;
        }
        if (!styleImageDataUrl) {
          throw new Error("No style image or capturable URL was provided.");
        }
        console.log("[stitch] image-led generation from style image...");
        screen = await generateScreenFromStyleImage(
          client,
          project,
          styleImageDataUrl,
          prompt,
          deviceType,
          beforeScreenIds,
        );
      } catch (imgErr) {
        console.warn(
          "[stitch] image-led generation failed:",
          errorMessage(imgErr),
        );
        return stitchErrorResponse(imgErr, "Style image mockup generation failed");
      }
    } else if (isAssetLed) {
      try {
        console.log(
          "[stitch] asset-led generation from",
          assetImageInputs.length,
          "mission image(s)...",
        );
        const assetDataUrls: string[] = [];
        for (const image of assetImageInputs) {
          assetDataUrls.push(await fetchImageAsDataUrl(image));
        }
        screen = await generateScreenFromAssetImages(
          client,
          project,
          assetDataUrls,
          assetImageInputs.map((image) => image.note),
          prompt,
          deviceType,
          beforeScreenIds,
        );
      } catch (assetErr) {
        console.warn(
          "[stitch] asset-led generation failed:",
          errorMessage(assetErr),
        );
        if (isStitchAuthError(assetErr)) {
          console.warn(
            "[stitch] falling back to text generation with exact asset URLs after asset upload/edit auth failure",
          );
          const deviceLabel =
            deviceType === "MOBILE" ? "mobile app screen" : "desktop website";
          const fallbackPrompt = assetImageUrlFallbackPrompt(
            prompt,
            deviceLabel,
            assetImageInputs,
          );
          try {
            screen = await generateScreen(
              client,
              project,
              fallbackPrompt,
              deviceType,
              beforeScreenIds,
            );
          } catch (fallbackErr) {
            if (!isStitchAuthError(fallbackErr)) throw fallbackErr;
            console.warn(
              "[stitch] Stitch text fallback failed auth; retrying URL text generation with API key",
            );
            const apiKeyStitch = await createStitchClient({ forceApiKey: true });
            client = apiKeyStitch.client;
            sdk = apiKeyStitch.sdk;
            console.log("[stitch] creating API-key fallback project...");
            project = await sdk.createProject("VibeDesign");
            actualProjectId = project.id;
            resolvedDesignSystemId = null;
            resolvedStyleHash = null;
            beforeScreenIds = new Set();
            console.log("[stitch] API-key fallback project created:", actualProjectId);
            try {
              screen = await generateScreen(
                client,
                project,
                fallbackPrompt,
                deviceType,
                beforeScreenIds,
              );
            } catch (apiKeyFallbackErr) {
              if (!isStitchAuthError(apiKeyFallbackErr)) throw apiKeyFallbackErr;
              console.warn(
                "[stitch] API-key text fallback failed auth; generating direct HTML fallback",
              );
              screen = await generateOpenAiAssetFallbackScreen(
                prompt,
                deviceType,
                assetImageInputs,
              );
              actualProjectId = projectId ?? "";
              resolvedDesignSystemId = null;
              resolvedStyleHash = null;
            }
          }
        } else {
          return stitchErrorResponse(
            assetErr,
            "Mission asset image mockup generation failed",
          );
        }
      }
    } else if (screenId) {
      console.log("[stitch] editing screen:", screenId);
      try {
        screen = await editScreen(client, project, screenId, prompt, deviceType, beforeScreenIds);
      } catch (editErr) {
        const message = errorMessage(editErr);
        console.warn("[stitch] edit failed:", message);
        return stitchErrorResponse(editErr, "Existing mockup edit failed");
      }
    } else {
      console.log("[stitch] generating screen for prompt:", prompt.slice(0, 80));
      try {
        screen = await generateScreen(client, project, prompt, deviceType, beforeScreenIds);
      } catch (generateErr) {
        if (!isIncompleteResponseError(generateErr)) throw generateErr;
        console.warn("[stitch] generation returned incomplete response; checking project screens...");
        const recovered = await recoverGeneratedScreen(project, beforeScreenIds);
        if (!recovered) throw generateErr;
        screen = recovered;
      }
    }
    if (!screen) throw new Error("No screen was generated or edited.");
    console.log("[stitch] screen id:", screen.id);

    // Only consider screens created during this generation. Stitch sometimes
    // creates a logo/brand asset before the actual web mockup, so pick the
    // richest website-like screen as primary instead of trusting return order.
    const allScreens = await project.screens().catch(() => []);
    const freshScreens = allScreens.filter(
      (candidate) => candidate.id && !beforeScreenIds.has(candidate.id),
    );
    const { selected, allScreenIds } =
      screenId || isImageLed || isAssetLed
        ? {
            selected: {
              screen,
              html: screenId
                ? await waitForChangedScreenHtml(
                    project,
                    screen,
                    previousHtmlHash || null,
                  )
                : await materializeHtml(await waitForScreenHtml(project, screen)),
              htmlPending: false,
              score: 0,
            },
            allScreenIds: [screen.id],
          }
        : await choosePrimaryScreen(project, freshScreens, screen, prompt);
    screen = selected.screen;
    console.log("[stitch] selected primary screen id:", screen.id);

    if (!selected.html) {
      console.warn("[stitch] HTML still pending; returning screen metadata for lazy recovery:", screen.id);
      return Response.json(
        {
          html: "",
          htmlPending: true,
          projectId: actualProjectId,
          screenId: screen.id,
          allScreenIds,
          designSystemId: resolvedDesignSystemId,
          appliedDesignStyleHash: resolvedStyleHash,
        },
        { status: 202 },
      );
    }

    const html = selected.html;
    console.log("[stitch] selected html length:", html.length);
    console.log("[stitch] new screens this generation:", allScreenIds.length);

    // Image-led: derive a 디자인 스타일 from the (correct) result and apply it so
    // subsequent screens stay consistent, and return it for the client to store.
    let derivedDesignStyle: { content: string } | undefined;
    if (isImageLed && html) {
      const derivedContent = await withTimeout(
        deriveDesignStyleFromHtml(html),
        12_000,
        "derive design style from generated HTML",
      );
      if (derivedContent) {
        derivedDesignStyle = { content: derivedContent };
        const appliedDesignSystemId = await withTimeout(
          applyDesignSystem(project, derivedContent, resolvedDesignSystemId),
          12_000,
          "apply derived design system",
        );
        if (appliedDesignSystemId !== null) {
          resolvedDesignSystemId = appliedDesignSystemId;
        }
        resolvedStyleHash = styleHash(derivedContent);
      }
    }

    return Response.json({
      html,
      projectId: actualProjectId,
      screenId: screen.id,
      allScreenIds,
      designSystemId: resolvedDesignSystemId,
      appliedDesignStyleHash: resolvedStyleHash,
      derivedDesignStyle,
      capturedUrl: capturedUrl ?? undefined,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[stitch] error:", message);
    return stitchErrorResponse(err);
  }
}
