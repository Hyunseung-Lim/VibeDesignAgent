import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

// Lets the client poll the outcome of a background memory-draft encode
// (see `after()` in ../route.ts) so it can surface a failure toast even
// though the POST there already returned before encoding finished.
export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    missionId?: string;
    interactionId?: string;
  };
  const missionId = body.missionId?.trim();
  const interactionId = body.interactionId?.trim();
  if (!missionId || !interactionId) {
    return Response.json(
      { error: "missionId and interactionId required" },
      { status: 400 },
    );
  }

  const token = await getFirebaseAccessToken();
  const draftPath = `sessions/${user.localId}/missions/${encodeURIComponent(missionId)}/memoryDrafts/${encodeURIComponent(interactionId)}`;
  const doc = (await getFirestoreDocument(draftPath, token)) as Record<
    string,
    unknown
  > | null;

  return Response.json({
    status: typeof doc?.status === "string" ? doc.status : null,
    lastRequestId:
      typeof doc?.lastRequestId === "number" ? doc.lastRequestId : null,
    errorMessage:
      typeof doc?.errorMessage === "string" ? doc.errorMessage : null,
  });
}
