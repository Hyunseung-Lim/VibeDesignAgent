import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

function defaultSettings() {
  return {
    durationMinutes: 20,
  };
}

export async function GET() {
  const token = await getFirebaseAccessToken();
  const settings = await getFirestoreDocument("settings/onboarding", token);
  return Response.json({
    ...defaultSettings(),
    ...settings,
    durationMinutes: Number(settings?.durationMinutes ?? 20) || 20,
  });
}

export async function PATCH(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !ADMIN_EMAILS.includes(requester.email ?? "")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    durationMinutes?: number;
  };

  const durationMinutes =
    typeof body.durationMinutes === "number" && body.durationMinutes > 0
      ? body.durationMinutes
      : 20;
  const token = await getFirebaseAccessToken();
  await patchFirestoreDocument(
    "settings/onboarding",
    {
      durationMinutes,
      updatedAt: new Date(),
    },
    token,
  );

  return Response.json({ ok: true, durationMinutes });
}
