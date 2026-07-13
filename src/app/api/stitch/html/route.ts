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

function isPermanentScreenError(message: string) {
  return /not found|not_found|404|invalid.*screen|screen.*invalid/i.test(message);
}

function isPermissionError(message: string) {
  return /does not have permission|permission denied|forbidden|403/i.test(message);
}

async function materializeHtml(htmlUrlOrContent: string) {
  if (!htmlUrlOrContent || !htmlUrlOrContent.startsWith("http")) {
    return htmlUrlOrContent;
  }
  const res = await fetch(htmlUrlOrContent);
  if (!res.ok) throw new Error(`Failed to fetch Stitch HTML: ${res.status}`);
  return res.text();
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
    let lastError = "Stitch 화면 HTML이 아직 준비되지 않았습니다.";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) await sleep(2000);
      try {
        const screen = await project.getScreen(screenId);
        const htmlUrlOrContent = await screen.getHtml();
        if (!htmlUrlOrContent) {
          lastError = "Empty HTML from Stitch";
          continue;
        }
        const html = await materializeHtml(htmlUrlOrContent);
        if (html.trim()) return Response.json({ html });
        lastError = "Empty HTML from Stitch";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        console.warn("[stitch/html] get HTML retry failed:", {
          projectId,
          screenId,
          attempt: attempt + 1,
          error: message,
        });
        if (isPermanentScreenError(message)) {
          return Response.json({ error: message }, { status: 404 });
        }
        if (isPermissionError(message)) {
          return Response.json(
            {
              error: message,
              code: "stitch-screen-permission-denied",
            },
            { status: 403 },
          );
        }
      }
    }

    return Response.json(
      { error: lastError, htmlPending: true },
      { status: 202 },
    );
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
