import {
  getFirebaseAccessToken,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

type MissionOptionInput = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  content?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function missionIdFromDate(now: Date) {
  return `mission-${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}${String(now.getDate()).padStart(2, "0")}-${String(
    now.getHours(),
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
    now.getSeconds(),
  ).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !isAdminEmail(requester.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    description?: unknown;
    device?: unknown;
    durationMinutes?: unknown;
    options?: MissionOptionInput[];
  };

  const title = text(body.title);
  const options = (Array.isArray(body.options) ? body.options : [])
    .map((option) => ({
      id: text(option.id) || crypto.randomUUID(),
      title: text(option.title),
      description: text(option.description),
      content: text(option.content),
    }))
    .filter((option) => option.title);

  if (!title || options.length === 0) {
    return Response.json(
      { error: "title and at least one option are required" },
      { status: 400 },
    );
  }

  const durationMinutes = Number(body.durationMinutes);
  const now = new Date();
  const id = missionIdFromDate(now);
  const token = await getFirebaseAccessToken();
  await patchFirestoreDocument(
    `missions/${encodeURIComponent(id)}`,
    {
      title,
      description: text(body.description),
      device: body.device === "mobile" ? "mobile" : "desktop",
      durationMinutes: durationMinutes > 0 ? durationMinutes : null,
      options,
      createdAt: now.getTime(),
      createdBy: requester.email ?? requester.localId,
    },
    token,
  );

  return Response.json({ id });
}
