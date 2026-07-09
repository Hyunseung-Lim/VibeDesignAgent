import {
  createStitchClient,
  isStitchAuthError,
  STITCH_AUTH_ERROR_CODE,
  STITCH_AUTH_ERROR_MESSAGE,
} from "@/lib/server/stitch-auth";

export const maxDuration = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const screenId = searchParams.get("screenId");

  if (!projectId || !screenId) {
    return Response.json({ error: "projectId and screenId required" }, { status: 400 });
  }

  try {
    const { sdk: stitchSdk } = await createStitchClient();
    const project = stitchSdk.project(projectId);
    let htmlUrlOrContent = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) await sleep(2000);
      const screen = await project.getScreen(screenId);
      htmlUrlOrContent = await screen.getHtml().catch(() => "");
      if (htmlUrlOrContent) break;
    }

    if (!htmlUrlOrContent) {
      return Response.json(
        { error: "Empty HTML from Stitch", htmlPending: true },
        { status: 202 },
      );
    }

    let html = htmlUrlOrContent;
    if (htmlUrlOrContent.startsWith("http")) {
      const res = await fetch(htmlUrlOrContent);
      if (!res.ok) throw new Error(`Failed to fetch Stitch HTML: ${res.status}`);
      html = await res.text();
    }

    return Response.json({ html });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isStitchAuthError(err)) {
      return Response.json(
        {
          error: STITCH_AUTH_ERROR_MESSAGE,
          code: STITCH_AUTH_ERROR_CODE,
        },
        { status: 401 },
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
