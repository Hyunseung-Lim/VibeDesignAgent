import { Stitch, StitchToolClient } from "@google/stitch-sdk";

export const maxDuration = 120; // 2 minutes — Stitch generation can be slow

const client = new StitchToolClient({ apiKey: process.env.STITCH_API_KEY! });
const stitchSdk = new Stitch(client);

type DeviceType = "MOBILE" | "DESKTOP";

export async function POST(request: Request) {
  const { prompt, device, projectId, screenId } = await request.json();

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

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

    let screen;
    if (screenId) {
      console.log("[stitch] editing screen:", screenId);
      try {
        const existing = await project.getScreen(screenId);
        screen = await existing.edit(prompt, deviceType);
      } catch (editErr) {
        console.warn("[stitch] edit failed, falling back to generate:", editErr instanceof Error ? editErr.message : editErr);
        screen = await project.generate(prompt, deviceType);
      }
    } else {
      console.log("[stitch] generating screen for prompt:", prompt.slice(0, 80));
      screen = await project.generate(prompt, deviceType);
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stitch] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
