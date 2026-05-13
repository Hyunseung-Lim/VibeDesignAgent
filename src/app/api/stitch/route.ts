import { Stitch, StitchToolClient } from "@google/stitch-sdk";

export const maxDuration = 180;

function createStitchClient() {
  const client = new StitchToolClient({ apiKey: process.env.STITCH_API_KEY! });
  return { client, sdk: new Stitch(client) };
}

type DeviceType = "MOBILE" | "DESKTOP";
type StitchProject = ReturnType<Stitch["project"]>;
type StitchScreenHandle = {
  id: string;
  getHtml: () => Promise<string>;
};

const INCOMPLETE_RESPONSE_ERROR = "Incomplete API response";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isIncompleteResponseError(error: unknown) {
  return errorMessage(error).includes(INCOMPLETE_RESPONSE_ERROR);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const hasScreenPayload = "htmlCode" in record || "screenshot" in record;
      if (hasScreenIdentity && hasScreenPayload) candidates.push(record);
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

export async function POST(request: Request) {
  const { prompt, device, projectId, screenId } = await request.json();

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const deviceType: DeviceType = device === "mobile" ? "MOBILE" : "DESKTOP";

  const { client, sdk } = createStitchClient();
  try {
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
        return Response.json({ error: `Existing mockup edit failed: ${message}` }, { status: 500 });
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

    // getHtml() may return empty if the screen HTML isn't ready yet — retry a few times
    let htmlUrlOrContent = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await sleep(2000);
      try {
        htmlUrlOrContent = await screen.getHtml();
      } catch {
        // ignore and retry
      }
      if (htmlUrlOrContent) break;
      console.warn("[stitch] getHtml() returned empty, retrying...", attempt + 1);
    }
    console.log("[stitch] htmlUrlOrContent type:", htmlUrlOrContent?.startsWith("http") ? "URL" : "direct-content", "preview:", htmlUrlOrContent?.slice(0, 150));

    if (!htmlUrlOrContent) {
      return Response.json({ error: "Stitch returned empty HTML" }, { status: 500 });
    }

    // getHtml() returns a download URL, not the actual HTML — fetch the content
    let html = htmlUrlOrContent;
    if (htmlUrlOrContent.startsWith("http")) {
      const fetchRes = await fetch(htmlUrlOrContent);
      if (!fetchRes.ok) throw new Error(`Failed to fetch HTML from Stitch URL: ${fetchRes.status}`);
      html = await fetchRes.text();
      console.log("[stitch] fetched html length:", html.length);
    }

    // Only return screens created during this generation (not pre-existing ones)
    const allScreens = await project.screens().catch(() => []);
    const freshIds = new Set(
      allScreens.map(s => s.id).filter(id => !beforeScreenIds.has(id))
    );
    freshIds.add(screen.id); // always include the primary screen
    const allScreenIds = Array.from(freshIds);
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
    return Response.json({ error: message }, { status: 500 });
  }
}
