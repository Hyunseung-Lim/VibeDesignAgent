import { Stitch, StitchToolClient } from "@google/stitch-sdk";

export const maxDuration = 120; // 2 minutes — Stitch generation can be slow


const client = new StitchToolClient({ apiKey: process.env.STITCH_API_KEY! });
const stitchSdk = new Stitch(client);

type DeviceType = "MOBILE" | "DESKTOP";
type StitchProject = ReturnType<Stitch["project"]>;
type StitchScreenHandle = {
  id: string;
  getHtml: () => Promise<string>;
  getImage: () => Promise<string>;
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
  const imageUrl = (candidate.screenshot as { downloadUrl?: string } | undefined)?.downloadUrl ?? "";
  if (!htmlUrl) return null;

  return {
    id: screenId ?? `raw-${Date.now()}`,
    getHtml: async () => htmlUrl,
    getImage: async () => imageUrl,
  };
}

async function generateScreen(project: StitchProject, prompt: string, deviceType: DeviceType, previousScreenIds: Set<string>) {
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



function promptWithReferenceImages(prompt: string, referenceImageUrls?: string[]) {
  const count = (referenceImageUrls ?? []).filter(Boolean).length;
  if (count === 0) return prompt;
  return [
    prompt,
    "",
    `Include exactly ${count} prominent <img> element(s) in the design for real content imagery (hero, feature sections, etc.). Do not use CSS background-image — use <img> tags so they can be replaced with real assets.`,
  ].join("\n");
}

function injectReferenceImages(html: string, imageUrls: string[]): string {
  if (imageUrls.length === 0) return html;

  let urlIndex = 0;
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (urlIndex >= imageUrls.length) return match;

    const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
    if (!srcMatch) return match;
    if (srcMatch[1].startsWith("data:")) return match;

    // Skip icon/logo/avatar images
    const alt = (attrs.match(/\balt="([^"]*)"/i)?.[1] ?? "").toLowerCase();
    const cls = (attrs.match(/\bclass="([^"]*)"/i)?.[1] ?? "").toLowerCase();
    if (
      alt.includes("icon") || alt.includes("logo") || alt.includes("avatar") ||
      cls.includes("icon") || cls.includes("logo") || cls.includes("avatar")
    ) {
      return match;
    }

    const newSrc = imageUrls[urlIndex++];
    console.log("[stitch] injecting reference image", urlIndex, "→", newSrc.slice(0, 60));
    return match.replace(/\bsrc="[^"]*"/i, `src="${newSrc}"`);
  });
}

export async function POST(request: Request) {
  const {
    prompt,
    device,
    projectId,
    screenId,
    referenceImageUrls,
  } = await request.json();

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const referenceImageCount = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter(Boolean).length
    : 0;
  const effectivePrompt = promptWithReferenceImages(prompt, referenceImageUrls);

  const deviceType: DeviceType = device === "mobile" ? "MOBILE" : "DESKTOP";

  try {
    let project;
    let actualProjectId: string = projectId;

    if (!projectId) {
      console.log("[stitch] creating project...");
      project = await stitchSdk.createProject("VibeDesign");
      actualProjectId = project.id;
      console.log("[stitch] project created:", actualProjectId);
    } else {
      project = stitchSdk.project(projectId);
    }

    const beforeScreens = await listScreens(project);
    const beforeScreenIds = new Set(beforeScreens.map((candidate) => candidate.id).filter(Boolean));
    let screen;

    if (screenId) {
      console.log(
        "[stitch] editing screen:",
        screenId,
        "reference images:",
        referenceImageCount,
      );
      try {
        screen = await editScreen(project, screenId, effectivePrompt, deviceType, beforeScreenIds);
      } catch (editErr) {
        const message = errorMessage(editErr);
        console.warn("[stitch] edit failed:", message);
        return Response.json({ error: `Existing mockup edit failed: ${message}` }, { status: 500 });
      }
    } else {
      console.log(
        "[stitch] generating screen for prompt:",
        effectivePrompt.slice(0, 80),
        "reference images:",
        referenceImageCount,
      );
      try {
        screen = await generateScreen(project, effectivePrompt, deviceType, beforeScreenIds);
      } catch (generateErr) {
        if (!isIncompleteResponseError(generateErr)) throw generateErr;
        console.warn("[stitch] generation returned incomplete response; checking project screens...");
        const recovered = await recoverGeneratedScreen(project, beforeScreenIds);
        if (!recovered) throw generateErr;
        screen = recovered;
      }
    }
    console.log("[stitch] screen id:", screen.id);

    const [htmlUrlOrContent, imageUrl] = await Promise.all([
      screen.getHtml(),
      screen.getImage().catch(() => ""),
    ]);

    console.log("[stitch] htmlUrlOrContent:", htmlUrlOrContent?.slice(0, 100));

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

    const refUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls.filter(Boolean)
      : [];
    if (refUrls.length > 0) {
      html = injectReferenceImages(html, refUrls);
    }

    // Get all screens in the project to capture any additional screens Stitch created
    const allScreens = await project.screens().catch(() => []);
    const allScreenIds = allScreens.map(s => s.id);
    console.log("[stitch] total screens in project:", allScreenIds.length);

    return Response.json({
      html,
      imageUrl,
      projectId: actualProjectId,
      screenId: screen.id,
      allScreenIds,
      referenceImageCount,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[stitch] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
