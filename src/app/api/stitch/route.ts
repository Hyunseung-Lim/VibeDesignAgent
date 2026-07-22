import { StitchToolClient } from "@google/stitch-sdk";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import OpenAI from "openai";
import { isAdminEmail } from "@/lib/admin";
import {
  createStitchClient,
  isStitchAuthError,
  stitchApiKeyForGroup,
  STITCH_AUTH_ERROR_CODE,
  STITCH_AUTH_ERROR_MESSAGE,
  STITCH_OAUTH_REQUIRED_ERROR_CODE,
  STITCH_OAUTH_REQUIRED_ERROR_MESSAGE,
} from "@/lib/server/stitch-auth";
import { verifyFirebaseIdToken } from "@/lib/server/firebaseAdminRest";
import { resolveUserStitchApiGroup } from "@/lib/server/stitchApiGroup";
import {
  applyStitchDomOperations,
  extractStitchDomOperations,
} from "@/lib/server/stitchDomOperations";
import { captureUrlScreenshotDataUrl } from "@/lib/server/urlScreenshot";
import {
  DESIGN_SYSTEM_EXTRACT_PROMPT,
  DERIVE_DESIGN_MD_FROM_HTML_PROMPT,
  STITCH_DESIGN_FONTS,
  STITCH_DESIGN_ROUNDNESS,
  styleImageReconstructPrompt,
} from "@/lib/prompts";

export const maxDuration = 300;

// Vercel kills the function at maxDuration with a plain-text
// FUNCTION_INVOCATION_TIMEOUT the client can only show raw (observed
// 2026-07-21, dev_document 15.327). Budget the slow OpenAI asset fallback so
// it fails with an explicit JSON error inside the limit instead: skip retries
// that cannot fit in the remaining budget and cap each completion call to it.
const ROUTE_TIME_BUDGET_MS = 270_000;
const FALLBACK_RETRY_RESERVE_MS = 90_000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type DeviceType = "MOBILE" | "DESKTOP";
type StitchClientBundle = Awaited<ReturnType<typeof createStitchClient>>;
type StitchProject = ReturnType<StitchClientBundle["sdk"]["project"]>;
type StitchEditModelId = "GEMINI_3_1_PRO";
type StitchEditPromptMode = "legacy" | "compact";
type StitchEditTargetMode = "screen-id" | "screen-instance";
type StyleReferenceUploadDebug = {
  stitchReferenceScreenId: string;
  hash: string;
  byteLength: number;
  mime: string;
  previewDataUrl?: string;
};
const STITCH_LOG_TOOL_SCHEMAS =
  process.env.STITCH_LOG_TOOL_SCHEMAS?.trim() === "1";
let stitchToolSchemasLogged = false;

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
  // Set when getHtml() already returns final materialized HTML (e.g. a
  // sessionEvent dom_operations harvest) — re-reading the screen resource
  // would return the stale pre-edit HTML instead.
  htmlMaterialized?: boolean;
};

function isMaterializedScreenHandle(screen: unknown) {
  return Boolean((screen as StitchScreenHandle | null)?.htmlMaterialized);
}

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

function errorDebug(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.slice(0, 2000),
      cause: cause ? errorMessage(cause) : undefined,
    };
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error).slice(0, 2000);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function safeJsonSnippet(value: unknown, maxLength = 4000) {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") return nestedValue.toString();
      if (nestedValue && typeof nestedValue === "object") {
        if (seen.has(nestedValue)) return "[Circular]";
        seen.add(nestedValue);
      }
      return nestedValue;
    });
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
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
  if (isStitchNotFoundError(error)) {
    return Response.json(
      {
        error: prefix ? `${prefix}: ${message}` : message,
        code: "stitch-screen-not-found",
      },
      { status: 404 },
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

function isStitchInvalidArgumentError(error: unknown) {
  return errorMessage(error).toLowerCase().includes("invalid argument");
}

function isStitchNotFoundError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("requested entity was not found") ||
    message.includes("not found")
  );
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

// Stitch intermittently rejects well-formed requests with INVALID_ARGUMENT
// (observed 2026-07-22 on create_project and generate_screen_from_text; the
// same calls succeeded on retry ~30s later — dev_document 15.328). Retry once
// with a short backoff on paths where invalid argument carries no contract
// meaning. Asset-led generation is excluded: there invalid argument is the
// signal that routes to the OpenAI fallback (15.262).
async function withInvalidArgumentRetry<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isStitchInvalidArgumentError(err)) throw err;
    const delay = 8000 + Math.floor(Math.random() * 2000);
    console.warn(
      `[stitch] ${label} rejected as invalid argument; retrying once in ${delay}ms:`,
      errorMessage(err),
    );
    await sleep(delay);
    return run();
  }
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncatePromptField(value: string, maxLength: number) {
  const compact = compactWhitespace(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function promptLineValue(prompt: string, label: string) {
  const match = prompt.match(new RegExp(`${label}:\\s*([^\\n]+)`));
  return match?.[1]?.trim() ?? "";
}

function promptSectionValue(prompt: string, label: string, untilLabels: string[]) {
  const start = prompt.indexOf(`${label}:`);
  if (start < 0) return "";
  const contentStart = start + label.length + 1;
  const contentEnd = untilLabels
    .map((untilLabel) => prompt.indexOf(`\n${untilLabel}:`, contentStart))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return prompt.slice(contentStart, contentEnd ?? prompt.length).trim();
}

function stitchEditPromptMode(): StitchEditPromptMode {
  return process.env.STITCH_EDIT_PROMPT_MODE?.trim().toLowerCase() === "compact"
    ? "compact"
    : "legacy";
}

function stitchEditTargetMode(): StitchEditTargetMode {
  return process.env.STITCH_EDIT_TARGET_MODE?.trim().toLowerCase() ===
    "screen-instance"
    ? "screen-instance"
    : "screen-id";
}

function buildCompactEditPrompt(prompt: string) {
  const originalRequest =
    promptLineValue(prompt, "Original user request for this edit") ||
    truncatePromptField(prompt, 240);
  const selector = promptLineValue(prompt, "Selector");
  const xpath = promptLineValue(prompt, "XPath");
  const visibleText = promptSectionValue(prompt, "Visible text", [
    "Selected HTML",
  ]);
  const selectedHtml = promptSectionValue(prompt, "Selected HTML", []);

  return [
    `Apply this edit to the selected element only: ${originalRequest}`,
    selector ? `Target CSS selector: ${selector}` : "",
    xpath ? `Target XPath: ${xpath}` : "",
    visibleText
      ? `The selected element contains this visible text: ${truncatePromptField(
          visibleText,
          500,
        )}`
      : "",
    selectedHtml
      ? `Selected element summary: ${truncatePromptField(selectedHtml, 700)}`
      : "",
    "Keep the existing layout, spacing, images, button behavior, and all other elements unchanged unless the requested edit directly requires a change.",
    "Return an updated design screen. Do not respond with only a written explanation.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildStitchEditCall(prompt: string): {
  modelId?: StitchEditModelId;
  prompt: string;
  promptMode: StitchEditPromptMode;
} {
  const promptMode = stitchEditPromptMode();
  if (promptMode !== "compact") {
    return { prompt, promptMode };
  }
  return {
    modelId: "GEMINI_3_1_PRO",
    prompt: buildCompactEditPrompt(prompt),
    promptMode,
  };
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
    console.warn(
      "[stitch] list screens failed:",
      JSON.stringify({
        projectId: project.id,
        message: errorMessage(err),
        error: errorDebug(err),
      }),
    );
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

function summarizeToolOutput(raw: unknown) {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const components = Array.isArray(record.outputComponents)
    ? record.outputComponents
    : [];
  return {
    projectId: typeof record.projectId === "string" ? record.projectId : null,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    componentCount: components.length,
    components: components.slice(0, 6).map((component) => {
      const item =
        component && typeof component === "object"
          ? (component as Record<string, unknown>)
          : {};
      const design = item.design as { screens?: unknown[] } | undefined;
      const screens = Array.isArray(design?.screens) ? design.screens : [];
      const screenIds = screens
        .map((screen) =>
          screen && typeof screen === "object"
            ? screenIdFromCandidate(screen as Record<string, unknown>)
            : null,
        )
        .filter(Boolean);
      return {
        keys: Object.keys(item),
        text:
          typeof item.text === "string" ? item.text.slice(0, 500) : undefined,
        suggestion:
          typeof item.suggestion === "string"
            ? item.suggestion.slice(0, 500)
            : undefined,
        sessionEvent:
          item.sessionEvent !== undefined
            ? safeJsonSnippet(item.sessionEvent, 2500)
            : undefined,
        screenIds,
      };
    }),
  };
}

async function logStitchToolSchemasIfEnabled(client: StitchToolClient) {
  if (!STITCH_LOG_TOOL_SCHEMAS || stitchToolSchemasLogged) return;
  stitchToolSchemasLogged = true;
  try {
    const maybeListTools = (
      client as StitchToolClient & {
        listTools?: () => Promise<unknown>;
      }
    ).listTools;
    if (!maybeListTools) {
      console.warn("[stitch] live tool schema dump skipped: listTools unavailable");
      return;
    }
    const raw = await maybeListTools.call(client);
    const tools = Array.isArray((raw as { tools?: unknown[] })?.tools)
      ? ((raw as { tools?: unknown[] }).tools as Record<string, unknown>[])
      : Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : [];
    const interesting = tools.filter((tool) =>
      ["edit_screens", "list_screens", "generate_screen_from_text"].includes(
        String(tool.name ?? ""),
      ),
    );
    console.warn(
      "[stitch] live tool schemas:",
      safeJsonSnippet(interesting.length ? interesting : raw, 12000),
    );
  } catch (err) {
    console.warn(
      "[stitch] live tool schema dump failed:",
      safeJsonSnippet(errorDebug(err), 3000),
    );
  }
}

type StitchScreenInstance = {
  id?: string;
  hidden?: boolean;
  sourceScreen?: string;
  type?: string;
};

function screenInstanceMatchesScreen(
  instance: StitchScreenInstance,
  projectId: string,
  screenId: string,
) {
  const sourceScreen = instance.sourceScreen ?? "";
  return (
    sourceScreen === `projects/${projectId}/screens/${screenId}` ||
    sourceScreen.endsWith(`/screens/${screenId}`) ||
    sourceScreen === screenId
  );
}

async function selectedScreenInstanceForScreen(
  client: StitchToolClient,
  project: StitchProject,
  screenId: string,
) {
  try {
    const raw = await client.callTool("get_project", {
      name: `projects/${project.id}`,
    });
    const instances = Array.isArray(
      (raw as { screenInstances?: unknown[] })?.screenInstances,
    )
      ? ((raw as { screenInstances?: unknown[] })
          .screenInstances as StitchScreenInstance[])
      : [];
    const matches = instances.filter((instance) =>
      screenInstanceMatchesScreen(instance, project.id, screenId),
    );
    const selected =
      matches.find((instance) => !instance.hidden) ?? matches[0] ?? null;
    console.log(
      "[stitch] project screen instance lookup:",
      JSON.stringify({
        projectId: project.id,
        screenId,
        instanceCount: instances.length,
        matchCount: matches.length,
        selectedInstanceId: selected?.id ?? null,
        selectedSourceScreen: selected?.sourceScreen ?? null,
      }),
    );
    if (!selected?.id || !selected.sourceScreen) return null;
    return {
      id: selected.id,
      sourceScreen: selected.sourceScreen,
    };
  } catch (err) {
    console.warn(
      "[stitch] project screen instance lookup failed:",
      safeJsonSnippet(errorDebug(err), 3000),
    );
    return null;
  }
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
  modelId?: StitchEditModelId,
) {
  await logStitchToolSchemasIfEnabled(client);
  const selectedScreenInstance =
    stitchEditTargetMode() === "screen-instance"
      ? await selectedScreenInstanceForScreen(client, project, screenId)
      : null;
  const legacyArgs = {
    projectId: project.id,
    selectedScreenIds: [screenId],
    prompt,
    deviceType,
    ...(modelId ? { modelId } : {}),
  };
  const instanceArgs = selectedScreenInstance
    ? {
        ...legacyArgs,
        selectedScreenInstances: [selectedScreenInstance],
      }
    : null;
  const raw = await withTransientRetry("edit_screens", async () => {
    if (!instanceArgs) return client.callTool("edit_screens", legacyArgs);
    try {
      console.log(
        "[stitch] edit_screens target mode:",
        JSON.stringify({
          mode: "screen-instance",
          screenId,
          selectedScreenInstances: instanceArgs.selectedScreenInstances,
        }),
      );
      return await client.callTool("edit_screens", instanceArgs);
    } catch (err) {
      if (!isStitchInvalidArgumentError(err)) throw err;
      console.warn(
        "[stitch] edit_screens screen-instance target rejected; retrying screen-id target:",
        errorMessage(err),
      );
      return client.callTool("edit_screens", legacyArgs);
    }
  });
  console.log(
    "[stitch] edit_screens raw response summary:",
    JSON.stringify(summarizeToolOutput(raw)),
  );
  const screenFromRaw = await screenFromRawResponse(project, raw);
  if (screenFromRaw) return screenFromRaw;

  // The edit backend usually does not persist edited HTML back to the screen
  // resource: the change arrives as sessionEvent dom_operations while
  // get_screen keeps returning the pre-edit HTML (dev_document 15.257).
  // Harvest those operations against the HTML we can read and return a
  // materialized handle so callers skip the stale re-read entirely.
  const domOperations = extractStitchDomOperations(raw);
  if (domOperations.length > 0) {
    const currentHtml = await materializeHtml(
      await waitForScreenHtml(project, project.screen(screenId)),
    ).catch(() => "");
    if (currentHtml) {
      const applied = applyStitchDomOperations(currentHtml, domOperations);
      console.log(
        "[stitch] sessionEvent dom_operations harvest:",
        JSON.stringify({
          total: domOperations.length,
          applied: applied.appliedCount,
          failed: applied.failedCount,
          failures: applied.failures.slice(0, 4),
        }),
      );
      if (applied.appliedCount > 0 && applied.html !== currentHtml) {
        return {
          id: screenId,
          getHtml: async () => applied.html,
          htmlMaterialized: true,
        } satisfies StitchScreenHandle;
      }
    } else {
      console.warn(
        "[stitch] dom_operations present but current screen HTML unavailable:",
        screenId,
      );
    }
  }

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

const EDIT_DELAYED_RECHECK_DELAYS_MS = [120_000, 300_000] as const;

async function runDelayedEditRecheck(
  project: StitchProject,
  screenId: string,
  previousHtmlHash: string,
  delayMs: number,
) {
  try {
    const screen = await project.getScreen(screenId);
    const htmlUrlOrContent = await screen.getHtml();
    const html = await materializeHtml(htmlUrlOrContent);
    const currentHtmlHash = html ? contentHash(html) : "";
    console.warn(
      "[stitch] delayed edit recheck:",
      JSON.stringify({
        projectId: project.id,
        screenId,
        delayMs,
        previousHtmlHash,
        currentHtmlHash,
        htmlLength: html.length,
        changed: Boolean(currentHtmlHash && currentHtmlHash !== previousHtmlHash),
      }),
    );
  } catch (err) {
    console.warn(
      "[stitch] delayed edit recheck failed:",
      JSON.stringify({
        projectId: project.id,
        screenId,
        delayMs,
        previousHtmlHash,
        message: errorMessage(err),
        error: errorDebug(err),
      }),
    );
  }
}

function scheduleDelayedEditRecheck(
  project: StitchProject,
  screenId: string,
  previousHtmlHash: string,
) {
  console.warn(
    "[stitch] scheduling delayed edit recheck:",
    JSON.stringify({
      projectId: project.id,
      screenId,
      previousHtmlHash,
      delaysMs: EDIT_DELAYED_RECHECK_DELAYS_MS,
    }),
  );
  for (const delayMs of EDIT_DELAYED_RECHECK_DELAYS_MS) {
    const timeout = setTimeout(() => {
      void runDelayedEditRecheck(project, screenId, previousHtmlHash, delayMs);
    }, delayMs);
    (timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }
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

// Screenshot a live URL into a data URL. Abstracted so the engine can be
// swapped later (managed API with key, self-hosted Playwright, ...). v1 uses
// Microlink's no-key endpoint. Returns a base64 data URL; throws on failure.
async function captureScreenshot(
  rawUrl: string,
  deviceType: DeviceType,
): Promise<string> {
  return captureUrlScreenshotDataUrl(rawUrl, deviceType);
}

const STYLE_IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

async function styleImagePreviewDataUrl(bytes: Buffer) {
  try {
    const preview = await sharp(bytes)
      .resize({ width: 520, height: 520, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    return `data:image/jpeg;base64,${preview.toString("base64")}`;
  } catch (err) {
    console.warn("[stitch] style image preview failed:", errorMessage(err));
    return undefined;
  }
}

// Decode a style-image data URL, downscale, and write a temp file for
// project.upload() (which reads from disk). Caller must unlink the path.
async function writeStyleImageTmp(dataUrl: string): Promise<{
  tmpPath: string;
  hash: string;
  byteLength: number;
  mime: string;
  previewDataUrl?: string;
}> {
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
  const uploadMime = ext === ".png" ? "image/png" : mime;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const previewDataUrl = await styleImagePreviewDataUrl(bytes);
  const tmpPath = path.join(os.tmpdir(), `vda-style-${randomUUID()}${ext}`);
  await writeFile(tmpPath, bytes);
  return {
    tmpPath,
    hash,
    byteLength: bytes.length,
    mime: uploadMime,
    previewDataUrl,
  };
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
): Promise<{
  screen: StitchScreenHandle;
  referenceUpload: StyleReferenceUploadDebug;
}> {
  const prepared = await writeStyleImageTmp(styleImageDataUrl);
  let refScreen:
    | { id: string; edit: (p: string, d?: DeviceType) => Promise<StitchScreenHandle> }
    | undefined;
  try {
    const uploaded = await withTransientRetry("upload style image to Stitch", () =>
      project.upload(prepared.tmpPath, { title: "Style reference" }),
    );
    refScreen = Array.isArray(uploaded) ? uploaded[0] : undefined;
  } finally {
    await unlink(prepared.tmpPath).catch(() => {});
  }
  if (!refScreen) {
    throw new Error("Stitch did not return a screen for the uploaded style image.");
  }
  const referenceUpload: StyleReferenceUploadDebug = {
    stitchReferenceScreenId: refScreen.id,
    hash: prepared.hash,
    byteLength: prepared.byteLength,
    mime: prepared.mime,
    previewDataUrl: prepared.previewDataUrl,
  };
  console.log(
    "[stitch] uploaded style reference:",
    JSON.stringify({
      stitchReferenceScreenId: referenceUpload.stitchReferenceScreenId,
      hash: referenceUpload.hash,
      byteLength: referenceUpload.byteLength,
      mime: referenceUpload.mime,
      hasPreview: Boolean(referenceUpload.previewDataUrl),
    }),
  );
  const deviceLabel =
    deviceType === "MOBILE" ? "mobile app screen" : "desktop website";
  const reconstructPrompt = styleImageReconstructPrompt(productPrompt, deviceLabel);
  const screen = await editScreen(
    client,
    project,
    refScreen.id,
    reconstructPrompt,
    deviceType,
    new Set([...previousScreenIds, refScreen.id]),
  );
  return { screen, referenceUpload };
}

type AssetImageRequest = {
  url: string;
  path: string;
  note: string;
};

function assetImageUrl(asset: AssetImageRequest) {
  return asset.url || `/api/mission-assets?path=${encodeURIComponent(asset.path)}`;
}

// Stitch generation cannot reference assets it can never fetch or echo:
// relative URLs, localhost, and private-network hosts always fail the
// literal-URL coverage check, so the generate→repair waterfall just burns
// minutes before the OpenAI fallback runs anyway (dev_document 15.262).
function isPubliclyReachableAssetUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // relative URL — resolvable only by this app's origin
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}

function assetImageUrlFallbackPrompt(
  productPrompt: string,
  deviceLabel: string,
  assets: AssetImageRequest[],
) {
  const manifest = assets
    .map((asset, index) => {
      return [
        `Asset ${index + 1}`,
        `URL: ${assetImageUrl(asset)}`,
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

function assetImageTokenFallbackPrompt(
  productPrompt: string,
  deviceLabel: string,
  assets: AssetImageRequest[],
) {
  const manifest = assets
    .map((asset, index) =>
      [
        `Asset ${index + 1}`,
        `Required img src token: {{ASSET_${index + 1}}}`,
        `Meaning: ${asset.note || "No admin description provided."}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    `Create a high-fidelity ${deviceLabel} UI mockup for the brief below.`,
    `Use the mission asset tokens below as exact image sources in the generated HTML. Put each token directly into img src attributes, for example <img src="{{ASSET_1}}" alt="...">. Do not invent, rewrite, encode, or replace these tokens. Preserve natural aspect ratio and use the notes to place each item in the correct product/content slot.`,
    `Mission asset tokens:\n${manifest}`,
    `Design the surrounding layout, navigation, typography, spacing, cards, filters, and copy from the brief and active design direction.`,
    productPrompt ? `Brief:\n${productPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function replaceAssetTokens(html: string, assets: AssetImageRequest[]) {
  return assets.reduce((current, asset, index) => {
    // Models mangle the literal token despite instructions: braces get
    // URL-encoded inside src attributes (%7B%7BASSET_1%7D%7D) or padded with
    // whitespace ({{ ASSET_1 }}). Accept those variants too.
    const tokenPattern = new RegExp(
      String.raw`(?:\{\{|%7B%7B)\s*ASSET_${index + 1}\s*(?:\}\}|%7D%7D)`,
      "gi",
    );
    return current.replace(tokenPattern, assetImageUrl(asset));
  }, html);
}

function assetImageRepairPrompt(
  productPrompt: string,
  deviceLabel: string,
  assets: AssetImageRequest[],
  coverage: { matchedCount: number; totalCount: number },
) {
  const manifest = assets
    .map((asset, index) => {
      return [
        `Asset ${index + 1}`,
        `Required img src: ${assetImageUrl(asset)}`,
        `Meaning: ${asset.note || "No admin description provided."}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Edit this existing ${deviceLabel} UI mockup. Keep the current visual direction and layout quality, but replace every placeholder, stock, generated, or broken product/content image with the exact mission asset URLs below.`,
    `The previous HTML only preserved ${coverage.matchedCount}/${coverage.totalCount} required mission assets. The edited HTML must include every listed URL directly in img src attributes. Do not crop critical product content; prefer object-fit: contain when the asset aspect ratio does not match a card slot.`,
    `Required mission asset URLs:\n${manifest}`,
    productPrompt ? `Original brief:\n${productPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function htmlEntityEscaped(value: string) {
  return value.replace(/&/g, "&amp;");
}

function assetReferenceNeedles(asset: AssetImageRequest) {
  const needles = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      needles.add(trimmed);
      needles.add(htmlEntityEscaped(trimmed));
    }
  };

  add(asset.url);
  add(asset.path);
  if (asset.path) {
    add(encodeURIComponent(asset.path));
    add(`/api/mission-assets?path=${encodeURIComponent(asset.path)}`);
  }

  return Array.from(needles);
}

function assetHtmlCoverage(html: string, assets: AssetImageRequest[]) {
  const matched = assets.filter((asset) =>
    assetReferenceNeedles(asset).some((needle) => html.includes(needle)),
  );
  return {
    matchedCount: matched.length,
    totalCount: assets.length,
    allMatched: matched.length === assets.length,
  };
}

// When coverage fails we need to see what the HTML actually references to
// tell "model ignored the assets" apart from "model mangled the URLs/tokens".
function logAssetCoverageFailure(
  context: string,
  html: string,
  assets: AssetImageRequest[],
) {
  const imgSrcs = Array.from(
    html.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi),
    (match) => match[1].slice(0, 160),
  ).slice(0, 20);
  console.warn(
    `[stitch] asset coverage failure (${context}):`,
    JSON.stringify({
      imgSrcs,
      expectedNeedles: assets.map(
        (asset) => assetReferenceNeedles(asset)[0]?.slice(0, 160) ?? "",
      ),
      residualTokens: html.match(/(?:\{\{|%7B%7B)\s*ASSET_\d+/gi) ?? [],
    }),
  );
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
  deadlineAt: number,
): Promise<StitchScreenHandle> {
  // Never start a retry that cannot finish before Vercel's maxDuration kill.
  const hasRetryBudget = () =>
    Date.now() + FALLBACK_RETRY_RESERVE_MS < deadlineAt;
  const deviceLabel =
    deviceType === "MOBILE" ? "390px wide mobile app screen" : "responsive desktop website";
  const fallbackPrompt = assetImageTokenFallbackPrompt(
    productPrompt,
    deviceLabel,
    assets,
  );
  const systemContent = [
    "You generate production-ready standalone HTML mockups.",
    "Return only complete HTML. Do not wrap it in markdown.",
    "Use Tailwind Play CDN or plain CSS inside the document.",
    "Use the provided asset tokens exactly as img src values.",
    "Do not mention that this is a fallback.",
  ].join("\n");

  // The model sometimes drops a few of the required assets (observed 5/7).
  // Retry once with explicit feedback listing the missed tokens before
  // giving up — a 500 here fails the whole generation.
  const maxAttempts = 2;
  let lastCoverage = { matchedCount: 0, totalCount: assets.length };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const missingFeedback =
      attempt === 1
        ? ""
        : [
            `Your previous HTML used only ${lastCoverage.matchedCount} of the ${assets.length} required asset tokens. Regenerate the complete HTML and include EVERY token below at least once as an img src value:`,
            assets
              .map(
                (asset, index) =>
                  `{{ASSET_${index + 1}}} — ${asset.note || "No admin description provided."}`,
              )
              .join("\n"),
          ].join("\n");
    const completion = await openai.chat.completions.create(
      {
        model: process.env.OPENAI_STITCH_FALLBACK_MODEL ?? "gpt-5.4-mini",
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content: missingFeedback
              ? `${fallbackPrompt}\n\n${missingFeedback}`
              : fallbackPrompt,
          },
        ],
      },
      // Fail this call inside the route budget rather than letting Vercel
      // kill the whole function mid-generation.
      { timeout: Math.max(60_000, deadlineAt - Date.now() - 10_000) },
    );
    const html = replaceAssetTokens(
      completeHtmlDocument(completion.choices[0]?.message?.content ?? ""),
      assets,
    );
    if (!/<(main|section|article|div|body)\b/i.test(html)) {
      if (attempt < maxAttempts) {
        if (hasRetryBudget()) {
          console.warn(
            "[stitch] OpenAI fallback returned no usable markup; retrying",
          );
          continue;
        }
        console.warn(
          "[stitch] OpenAI fallback retry skipped: route time budget exhausted",
        );
      }
      throw new Error("OpenAI HTML fallback returned no usable mockup markup.");
    }
    const coverage = assetHtmlCoverage(html, assets);
    if (!coverage.allMatched) {
      lastCoverage = coverage;
      logAssetCoverageFailure("openai-fallback", html, assets);
      if (attempt < maxAttempts) {
        if (hasRetryBudget()) {
          console.warn(
            `[stitch] OpenAI fallback missed mission assets (${coverage.matchedCount}/${coverage.totalCount}); retrying with feedback`,
          );
          continue;
        }
        console.warn(
          "[stitch] OpenAI fallback retry skipped: route time budget exhausted",
        );
      }
      throw new Error(
        `OpenAI HTML fallback did not preserve every mission asset (${coverage.matchedCount}/${coverage.totalCount}).`,
      );
    }
    return {
      id: `openai-asset-fallback-${randomUUID()}`,
      getHtml: async () => html,
    };
  }
  throw new Error("OpenAI HTML fallback did not produce a usable mockup.");
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
  const routeDeadlineAt = Date.now() + ROUTE_TIME_BUDGET_MS;
  const requestingUser = await verifyFirebaseIdToken(request);
  if (!requestingUser) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
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
    ownerUid,
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
    ownerUid?: string | null;
  };

  const stitchOwnerUid = ownerUid?.trim() || requestingUser.localId;
  if (
    stitchOwnerUid !== requestingUser.localId &&
    !isAdminEmail(requestingUser.email)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const stitchApiGroup = await resolveUserStitchApiGroup(stitchOwnerUid);
  const stitchApiKey = stitchApiKeyForGroup(stitchApiGroup);

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
    // Asset-led generation whose assets Stitch can never reference (relative /
    // localhost / private-network URLs — typical in dev) always fails the
    // literal-URL coverage check, so the Stitch generate→repair waterfall only
    // burns minutes before the OpenAI fallback runs anyway. Skip Stitch
    // entirely (project creation and design-system apply included) and go
    // straight to the direct HTML fallback.
    if (isAssetLed) {
      const unreachableAssetUrls = assetImageInputs
        .map((asset) => assetImageUrl(asset))
        .filter((url) => !isPubliclyReachableAssetUrl(url));
      if (unreachableAssetUrls.length > 0) {
        console.warn(
          "[stitch] asset-led assets are not publicly reachable; skipping Stitch generation for direct HTML fallback:",
          JSON.stringify(unreachableAssetUrls.slice(0, 3)),
        );
        const fallbackScreen = await generateOpenAiAssetFallbackScreen(
          prompt,
          deviceType,
          assetImageInputs,
          routeDeadlineAt,
        );
        const fallbackHtml = await fallbackScreen.getHtml();
        console.log(
          "[stitch] asset-led fallback screen id:",
          fallbackScreen.id,
        );
        console.log("[stitch] selected html length:", fallbackHtml.length);
        return Response.json({
          html: fallbackHtml,
          projectId: projectId ?? "",
          screenId: fallbackScreen.id,
          allScreenIds: [fallbackScreen.id],
          designSystemId: null,
          appliedDesignStyleHash: null,
        });
      }
    }

    let stitch: StitchClientBundle;
    try {
      stitch = await createStitchClient({
        apiKey: stitchApiKey,
        apiKeyGroup: stitchApiGroup,
      });
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
    let project: StitchProject;
    let actualProjectId: string = projectId ?? "";

    if (!projectId) {
      console.log("[stitch] creating project...");
      project = await withInvalidArgumentRetry("create_project", () =>
        sdk.createProject("VibeDesign"),
      );
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
    let styleReferenceInput:
      | (StyleReferenceUploadDebug & {
          sourceType: "attached-image" | "url-screenshot";
          sourceUrl?: string;
        })
      | null = null;
    let beforeScreenIds = new Set<string>();
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

    const createFreshGenerationProject = async (reason: string) => {
      console.warn(
        "[stitch] replacing generation project:",
        JSON.stringify({
          reason,
          previousProjectId: actualProjectId || null,
        }),
      );
      project = await withInvalidArgumentRetry("create_project", () =>
        sdk.createProject("VibeDesign"),
      );
      actualProjectId = project.id;
      beforeScreenIds = new Set();
      resolvedDesignSystemId = null;
      resolvedStyleHash = null;
      console.log("[stitch] replacement project created:", actualProjectId);
      if (styleContent) {
        console.log("[stitch] applying design system (replacement project)...");
        resolvedDesignSystemId = await applyDesignSystem(
          project,
          styleContent,
          null,
        );
        resolvedStyleHash = styleHash(styleContent);
      }
    };

    const beforeScreens = await listScreens(project);
    beforeScreenIds = new Set(
      beforeScreens.map((candidate) => candidate.id).filter(Boolean),
    );
    let screen;

    if (isImageLed) {
      try {
        // Attached image wins; otherwise screenshot the provided URL.
        let styleImageDataUrl = styleImage?.dataUrl ?? null;
        let styleReferenceSourceType: "attached-image" | "url-screenshot" =
          styleImageDataUrl ? "attached-image" : "url-screenshot";
        if (!styleImageDataUrl && styleSourceUrl) {
          console.log("[stitch] capturing screenshot of style source URL...");
          styleImageDataUrl = await captureScreenshot(styleSourceUrl, deviceType);
          capturedUrl = styleSourceUrl;
          styleReferenceSourceType = "url-screenshot";
        }
        if (!styleImageDataUrl) {
          throw new Error("No style image or capturable URL was provided.");
        }
        console.log("[stitch] image-led generation from style image...");
        const imageLedResult = await generateScreenFromStyleImage(
          client,
          project,
          styleImageDataUrl,
          prompt,
          deviceType,
          beforeScreenIds,
        );
        screen = imageLedResult.screen;
        styleReferenceInput = {
          ...imageLedResult.referenceUpload,
          sourceType: styleReferenceSourceType,
          sourceUrl: capturedUrl ?? undefined,
        };
      } catch (imgErr) {
        console.warn(
          "[stitch] image-led generation failed:",
          errorMessage(imgErr),
        );
        return stitchErrorResponse(imgErr, "Style image mockup generation failed");
      }
    } else if (isAssetLed) {
      console.log(
        "[stitch] asset-led URL text generation from",
        assetImageInputs.length,
        "mission image(s)...",
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
      } catch (assetErr) {
        if (isStitchNotFoundError(assetErr)) {
          await createFreshGenerationProject(
            "asset-led generation target not found",
          );
          try {
            screen = await generateScreen(
              client,
              project,
              fallbackPrompt,
              deviceType,
              beforeScreenIds,
            );
          } catch (freshAssetErr) {
            if (!isStitchInvalidArgumentError(freshAssetErr)) {
              throw freshAssetErr;
            }
            console.warn(
              "[stitch] replacement project asset-led generation rejected; generating direct HTML fallback:",
              errorMessage(freshAssetErr),
            );
            screen = await generateOpenAiAssetFallbackScreen(
              prompt,
              deviceType,
              assetImageInputs,
              routeDeadlineAt,
            );
            if (screen.id.startsWith("openai-asset-fallback-")) {
              actualProjectId = "";
              resolvedDesignSystemId = null;
              resolvedStyleHash = null;
            }
          }
        } else if (isStitchInvalidArgumentError(assetErr)) {
          console.warn(
            "[stitch] asset-led URL text generation rejected; generating direct HTML fallback:",
            errorMessage(assetErr),
          );
          screen = await generateOpenAiAssetFallbackScreen(
            prompt,
            deviceType,
            assetImageInputs,
            routeDeadlineAt,
          );
          if (screen.id.startsWith("openai-asset-fallback-")) {
            actualProjectId = projectId ?? "";
            resolvedDesignSystemId = null;
            resolvedStyleHash = null;
          }
        } else if (!isStitchAuthError(assetErr)) {
          throw assetErr;
        } else {
          console.warn(
            "[stitch] asset-led URL text generation failed auth; retrying with API key",
          );
          const apiKeyStitch = await createStitchClient({
            forceApiKey: true,
            apiKey: stitchApiKey,
            apiKeyGroup: stitchApiGroup,
          });
          client = apiKeyStitch.client;
          sdk = apiKeyStitch.sdk;
          console.log("[stitch] creating API-key fallback project...");
          project = await withInvalidArgumentRetry("create_project", () =>
            sdk.createProject("VibeDesign"),
          );
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
            if (
              !isStitchAuthError(apiKeyFallbackErr) &&
              !isStitchInvalidArgumentError(apiKeyFallbackErr)
            ) {
              throw apiKeyFallbackErr;
            }
            console.warn(
              "[stitch] API-key text fallback failed; generating direct HTML fallback:",
              errorMessage(apiKeyFallbackErr),
            );
            screen = await generateOpenAiAssetFallbackScreen(
              prompt,
              deviceType,
              assetImageInputs,
              routeDeadlineAt,
            );
            if (screen.id.startsWith("openai-asset-fallback-")) {
              actualProjectId = projectId ?? "";
              resolvedDesignSystemId = null;
              resolvedStyleHash = null;
            }
          }
        }
      }
    } else if (screenId) {
      console.log("[stitch] editing screen:", screenId);
      const editCall = buildStitchEditCall(prompt);
      console.log(
        "[stitch] edit prompt:",
        JSON.stringify({
          promptMode: editCall.promptMode,
          modelId: editCall.modelId ?? null,
          originalLength: prompt.length,
          length: editCall.prompt.length,
          sample: editCall.prompt.slice(0, 2000),
        }),
      );
      try {
        screen = await editScreen(
          client,
          project,
          screenId,
          editCall.prompt,
          deviceType,
          beforeScreenIds,
          editCall.modelId,
        );
      } catch (editErr) {
        const message = errorMessage(editErr);
        console.warn("[stitch] edit failed:", message);
        return stitchErrorResponse(editErr, "Existing mockup edit failed");
      }
    } else {
      console.log("[stitch] generating screen for prompt:", prompt.slice(0, 80));
      try {
        screen = await withInvalidArgumentRetry("text generation", () =>
          generateScreen(client, project, prompt, deviceType, beforeScreenIds),
        );
      } catch (generateErr) {
        if (isStitchNotFoundError(generateErr)) {
          await createFreshGenerationProject("text generation target not found");
          try {
            screen = await withInvalidArgumentRetry("text generation", () =>
              generateScreen(client, project, prompt, deviceType, beforeScreenIds),
            );
          } catch (freshGenerateErr) {
            if (!isIncompleteResponseError(freshGenerateErr)) {
              throw freshGenerateErr;
            }
            console.warn(
              "[stitch] replacement generation returned incomplete response; checking project screens...",
            );
            const recovered = await recoverGeneratedScreen(
              project,
              beforeScreenIds,
            );
            if (!recovered) throw freshGenerateErr;
            screen = recovered;
          }
        } else if (!isIncompleteResponseError(generateErr)) {
          throw generateErr;
        } else {
          console.warn(
            "[stitch] generation returned incomplete response; checking project screens...",
          );
          const recovered = await recoverGeneratedScreen(project, beforeScreenIds);
          if (!recovered) throw generateErr;
          screen = recovered;
        }
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
    const selectionResult =
      screenId || isImageLed || isAssetLed
        ? {
            selected: {
              screen,
              html:
                screenId && !isMaterializedScreenHandle(screen)
                  ? await waitForChangedScreenHtml(
                      project,
                      screen,
                      previousHtmlHash || null,
                    )
                  : await materializeHtml(
                      await waitForScreenHtml(project, screen),
                    ),
              htmlPending: false,
              score: 0,
            },
            allScreenIds: [screen.id],
          }
        : await choosePrimaryScreen(project, freshScreens, screen, prompt);
    let { selected, allScreenIds } = selectionResult;
    screen = selected.screen;
    console.log("[stitch] selected primary screen id:", screen.id);

    if (
      screenId &&
      previousHtmlHash &&
      selected.html &&
      contentHash(selected.html) === previousHtmlHash
    ) {
      console.warn(
        "[stitch] edit returned unchanged HTML after retries; treating as failed no-op:",
        screen.id,
      );
      scheduleDelayedEditRecheck(project, screen.id, previousHtmlHash);
      return Response.json(
        {
          error:
            "Stitch가 기존 screen을 수정하지 않고 동일한 HTML을 반환했습니다. 선택 요소 수정은 실패로 처리했습니다.",
          code: "stitch-edit-unchanged",
          projectId: actualProjectId,
          screenId: screen.id,
        },
        { status: 409 },
      );
    }

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

    let html = selected.html;
    if (isAssetLed && html) {
      const coverage = assetHtmlCoverage(html, assetImageInputs);
      console.log(
        "[stitch] asset-led HTML asset coverage:",
        `${coverage.matchedCount}/${coverage.totalCount}`,
      );
      if (!coverage.allMatched) {
        logAssetCoverageFailure("asset-led-first-design", html, assetImageInputs);
        const applyOpenAiAssetFallback = async () => {
          screen = await generateOpenAiAssetFallbackScreen(
            prompt,
            deviceType,
            assetImageInputs,
            routeDeadlineAt,
          );
          html = await screen.getHtml();
          selected = {
            screen,
            html,
            htmlPending: false,
            score: 0,
          };
          allScreenIds = [screen.id];
          if (screen.id.startsWith("openai-asset-fallback-")) {
            actualProjectId = projectId ?? "";
            resolvedDesignSystemId = null;
            resolvedStyleHash = null;
          }
          console.log("[stitch] asset-led fallback screen id:", screen.id);
        };
        if (coverage.matchedCount === 0) {
          // A zero-coverage first design means Stitch declined to reference the
          // asset URLs at all — the repair edit reliably comes back 0/N too
          // (observed in logs), so skip the slowest call and fall back now.
          console.warn(
            "[stitch] asset-led first design preserved no mission assets; skipping repair edit for direct HTML fallback",
          );
          await applyOpenAiAssetFallback();
        } else {
        console.warn(
          "[stitch] asset-led first design missed mission assets; editing generated screen",
        );
        const previousScreenId = screen.id;
        const deviceLabel =
          deviceType === "MOBILE" ? "mobile app screen" : "desktop website";
        const repairPrompt = assetImageRepairPrompt(
          prompt,
          deviceLabel,
          assetImageInputs,
          coverage,
        );
        try {
          screen = await editScreen(
            client,
            project,
            screen.id,
            repairPrompt,
            deviceType,
            new Set([...beforeScreenIds, previousScreenId]),
          );
          html = await materializeHtml(await waitForScreenHtml(project, screen));
          const repairedCoverage = assetHtmlCoverage(html, assetImageInputs);
          console.log(
            "[stitch] asset-led repaired HTML asset coverage:",
            `${repairedCoverage.matchedCount}/${repairedCoverage.totalCount}`,
          );
          if (!repairedCoverage.allMatched) {
            logAssetCoverageFailure(
              "asset-led-repair",
              html,
              assetImageInputs,
            );
            throw new Error(
              `Stitch repaired HTML did not preserve every mission asset (${repairedCoverage.matchedCount}/${repairedCoverage.totalCount}).`,
            );
          }
          selected = {
            screen,
            html,
            htmlPending: false,
            score: 0,
          };
          allScreenIds = Array.from(new Set([...allScreenIds, previousScreenId, screen.id]));
          console.log("[stitch] asset-led repaired screen id:", screen.id);
        } catch (repairErr) {
          console.warn(
            "[stitch] asset-led generated-screen edit failed; generating direct HTML fallback:",
            errorMessage(repairErr),
          );
          await applyOpenAiAssetFallback();
        }
        }
      }
    }
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
      styleReferenceInput: styleReferenceInput ?? undefined,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[stitch] error:", message);
    return stitchErrorResponse(err);
  }
}
