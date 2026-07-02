import { Stitch, StitchToolClient } from "@google/stitch-sdk";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import OpenAI from "openai";
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

function createStitchClient() {
  const apiKey = process.env.STITCH_API_KEY;
  if (!apiKey) throw new Error("STITCH_API_KEY is not configured.");
  const client = new StitchToolClient({ apiKey });
  return { client, sdk: new Stitch(client) };
}

type DeviceType = "MOBILE" | "DESKTOP";
type StitchProject = ReturnType<Stitch["project"]>;

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

function isStitchAuthError(message: string) {
  return /missing required authentication credential|oauth 2 access token|valid authentication credential|api key/i.test(
    message,
  );
}

function stitchErrorResponse(error: unknown, prefix?: string) {
  const message = errorMessage(error);
  if (isStitchAuthError(message)) {
    return Response.json(
      {
        error:
          "Stitch 인증 정보가 유효하지 않습니다. 관리자에게 STITCH_API_KEY 갱신을 요청해주세요.",
        code: "stitch-auth",
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const raw = await client.callTool("edit_screens", {
    projectId: project.id,
    selectedScreenIds: [screenId],
    prompt,
    deviceType,
  });
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
  project: StitchProject,
  styleImageDataUrl: string,
  productPrompt: string,
  deviceType: DeviceType,
): Promise<StitchScreenHandle> {
  const tmpPath = await writeStyleImageTmp(styleImageDataUrl);
  let refScreen:
    | { id: string; edit: (p: string, d?: DeviceType) => Promise<StitchScreenHandle> }
    | undefined;
  try {
    const uploaded = await project.upload(tmpPath, { title: "Style reference" });
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
  return refScreen.edit(reconstructPrompt, deviceType);
}

// Download a remote image (e.g. a Firebase Storage asset URL) into a base64 data
// URL so it can flow through the same temp-file + upload path as attached images.
async function fetchImageAsDataUrl(rawUrl: string): Promise<string> {
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
    throw new Error(`Failed to fetch asset image: ${res.status}.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Content-led generation: the mission supplies real content images (product
// photos, UI captures) that must appear in the mockup as-is. We upload them to
// the project and edit the first into a working UI, instructing the model to
// embed the uploaded images verbatim (see assetImageEmbedPrompt). Distinct from
// the style-image path, which treats an image as a look to reconstruct.
async function generateScreenFromAssetImages(
  project: StitchProject,
  assetImageDataUrls: string[],
  assetImageNotes: string[],
  productPrompt: string,
  deviceType: DeviceType,
): Promise<StitchScreenHandle> {
  let baseRefScreen:
    | { id: string; edit: (p: string, d?: DeviceType) => Promise<StitchScreenHandle> }
    | undefined;
  for (const dataUrl of assetImageDataUrls) {
    const tmpPath = await writeStyleImageTmp(dataUrl);
    try {
      const uploaded = await project.upload(tmpPath, { title: "Mission asset" });
      const screen = Array.isArray(uploaded) ? uploaded[0] : undefined;
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
  return baseRefScreen.edit(embedPrompt, deviceType);
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
    assetImages?: { url?: string; note?: string }[] | null;
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
      note: typeof image?.note === "string" ? image.note.trim() : "",
    }))
    .filter((image) => image.url);
  const assetImageUrls = assetImageInputs.map((image) => image.url);
  const isAssetLed = assetImageUrls.length > 0 && !screenId && !isImageLed;

  try {
    const { client, sdk } = createStitchClient();
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
    const beforeScreenIds = new Set(beforeScreens.map((candidate) => candidate.id).filter(Boolean));
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
          project,
          styleImageDataUrl,
          prompt,
          deviceType,
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
          assetImageUrls.length,
          "mission image(s)...",
        );
        const assetDataUrls = await Promise.all(
          assetImageUrls.map((url) => fetchImageAsDataUrl(url)),
        );
        screen = await generateScreenFromAssetImages(
          project,
          assetDataUrls,
          assetImageInputs.map((image) => image.note),
          prompt,
          deviceType,
        );
      } catch (assetErr) {
        console.warn(
          "[stitch] asset-led generation failed:",
          errorMessage(assetErr),
        );
        return stitchErrorResponse(
          assetErr,
          "Mission asset image mockup generation failed",
        );
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
