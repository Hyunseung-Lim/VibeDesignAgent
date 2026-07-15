export type ScreenshotDeviceType = "MOBILE" | "DESKTOP";

type ScreenshotOptions = {
  timeoutMs?: number;
  imageTimeoutMs?: number;
};

function screenshotViewport(deviceType: ScreenshotDeviceType) {
  return deviceType === "MOBILE"
    ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 }
    : { width: 1280, height: 900, isMobile: false, deviceScaleFactor: 1 };
}

export async function getUrlScreenshotUrl(
  rawUrl: string,
  deviceType: ScreenshotDeviceType,
  options: ScreenshotOptions = {},
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid screenshot source URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Screenshot source URL must be http(s).");
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
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
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
  return shotUrl;
}

export async function captureUrlScreenshotDataUrl(
  rawUrl: string,
  deviceType: ScreenshotDeviceType,
  options: ScreenshotOptions = {},
): Promise<string> {
  const shotUrl = await getUrlScreenshotUrl(rawUrl, deviceType, options);
  const imgRes = await fetch(shotUrl, {
    signal: AbortSignal.timeout(options.imageTimeoutMs ?? 20_000),
  });
  if (!imgRes.ok) {
    throw new Error(`Failed to fetch captured screenshot: ${imgRes.status}.`);
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
