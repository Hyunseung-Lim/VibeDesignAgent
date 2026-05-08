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

function proxyImageUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

const SKIP_IMG_PATTERN = /icon|logo|avatar/i;

function injectReferenceImages(html: string, imageUrls: string[]): string {
  if (imageUrls.length === 0) return html;

  // 1. Replace img src attributes in HTML
  let urlIndex = 0;
  const result = html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (urlIndex >= imageUrls.length) return match;

    const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
    if (!srcMatch || srcMatch[1].startsWith("data:")) return match;

    const alt = attrs.match(/\balt="([^"]*)"/i)?.[1] ?? "";
    const cls = attrs.match(/\bclass="([^"]*)"/i)?.[1] ?? "";
    if (SKIP_IMG_PATTERN.test(alt) || SKIP_IMG_PATTERN.test(cls)) return match;

    const newSrc = proxyImageUrl(imageUrls[urlIndex++]);
    console.log("[stitch] injecting reference image", urlIndex, "→", newSrc.slice(0, 80));
    // Also clear data-alt so Stitch scripts can't re-generate the image
    return match
      .replace(/\bsrc="[^"]*"/i, `src="${newSrc}"`)
      .replace(/\bdata-alt="[^"]*"/i, "");
  });

  // 2. Inject a late-running script to re-apply URLs after Stitch's own scripts
  const urlsJson = JSON.stringify(imageUrls.map(proxyImageUrl));
  const overrideScript = `<script>
(function(){
  var urls = ${urlsJson};
  function applyImages() {
    var idx = 0;
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length && idx < urls.length; i++) {
      var img = imgs[i];
      var alt = (img.getAttribute('alt') || '').toLowerCase();
      var cls = (img.className || '').toLowerCase();
      if (/icon|logo|avatar/.test(alt) || /icon|logo|avatar/.test(cls)) continue;
      img.src = urls[idx++];
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyImages);
  } else {
    applyImages();
  }
  window.addEventListener('load', applyImages);
})();
</script>`;

  const bodyEnd = result.lastIndexOf("</body>");
  return bodyEnd !== -1
    ? result.slice(0, bodyEnd) + overrideScript + result.slice(bodyEnd)
    : result + overrideScript;
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

    // Log image-related tags to diagnose how Stitch embeds images
    const imgTagCount = (html.match(/<img\b/gi) ?? []).length;
    const bgImageCount = (html.match(/background-image\s*:/gi) ?? []).length;
    console.log("[stitch] html img tags:", imgTagCount, "background-image occurrences:", bgImageCount);
    const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0].slice(0, 200));
    imgTags.forEach((tag, i) => console.log(`[stitch] img[${i}]:`, tag));
    const cspMeta = html.match(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/i)?.[0];
    console.log("[stitch] csp meta:", cspMeta ?? "none");
    const scriptSrcs = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    scriptSrcs.forEach((tag, i) => console.log(`[stitch] script[${i}]:`, tag));
    const hasImageJs = /data-alt|generateImage|replaceImage|loadImage|fetchImage/i.test(html);
    console.log("[stitch] image-related JS patterns found:", hasImageJs);

    const refUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls.filter(Boolean)
      : [];
    if (refUrls.length > 0) {
      html = injectReferenceImages(html, refUrls);
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
