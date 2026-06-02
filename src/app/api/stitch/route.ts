import { Stitch, StitchToolClient } from "@google/stitch-sdk";

export const maxDuration = 180;

function createStitchClient() {
  const apiKey = process.env.STITCH_API_KEY;
  if (!apiKey) throw new Error("STITCH_API_KEY is not configured.");
  const client = new StitchToolClient({ apiKey });
  return { client, sdk: new Stitch(client) };
}

type DeviceType = "MOBILE" | "DESKTOP";
type StitchProject = ReturnType<Stitch["project"]>;
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

export async function POST(request: Request) {
  const { prompt, device, projectId, screenId } = await request.json();

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const deviceType: DeviceType = device === "mobile" ? "MOBILE" : "DESKTOP";

  try {
    const { client, sdk } = createStitchClient();
    let project;
    let actualProjectId: string = projectId;

    if (!projectId) {
      console.log("[stitch] creating project...");
      project = await sdk.createProject("VibeDesign");
      actualProjectId = project.id;
      console.log("[stitch] project created:", actualProjectId);
    } else {
      project = sdk.project(projectId);
    }

    const beforeScreens = await listScreens(project);
    const beforeScreenIds = new Set(beforeScreens.map((candidate) => candidate.id).filter(Boolean));
    let screen;

    if (screenId) {
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
    const { selected, allScreenIds } = screenId
      ? {
          selected: {
            screen,
            html: await materializeHtml(await waitForScreenHtml(project, screen)),
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
        },
        { status: 202 },
      );
    }

    const html = selected.html;
    console.log("[stitch] selected html length:", html.length);
    console.log("[stitch] new screens this generation:", allScreenIds.length);

    return Response.json({
      html,
      projectId: actualProjectId,
      screenId: screen.id,
      allScreenIds,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[stitch] error:", message);
    return stitchErrorResponse(err);
  }
}
