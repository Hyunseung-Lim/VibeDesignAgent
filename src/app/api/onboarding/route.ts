import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultSettings() {
  const today = formatLocalDate(new Date());
  return {
    startDate: today,
    endDate: today,
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
    startDate?: string;
    endDate?: string;
    durationMinutes?: number;
  };
  const startDate = body.startDate?.trim();
  const endDate = body.endDate?.trim();
  if (!startDate || !endDate) {
    return Response.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  const durationMinutes =
    typeof body.durationMinutes === "number" && body.durationMinutes > 0
      ? body.durationMinutes
      : 20;
  const token = await getFirebaseAccessToken();
  await patchFirestoreDocument(
    "settings/onboarding",
    {
      startDate,
      endDate,
      durationMinutes,
      updatedAt: new Date(),
    },
    token,
  );

  return Response.json({ ok: true, startDate, endDate, durationMinutes });
}
