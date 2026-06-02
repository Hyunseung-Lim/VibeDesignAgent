import { Stitch, StitchToolClient } from "@google/stitch-sdk";

export const maxDuration = 60;

function createStitchSdk() {
  const apiKey = process.env.STITCH_API_KEY;
  if (!apiKey) throw new Error("STITCH_API_KEY is not configured.");
  const client = new StitchToolClient({ apiKey });
  return new Stitch(client);
}

function isStitchAuthError(message: string) {
  return /missing required authentication credential|oauth 2 access token|valid authentication credential|api key/i.test(
    message,
  );
}

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
    const stitchSdk = createStitchSdk();
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
    return Response.json({ error: message }, { status: 500 });
  }
}
