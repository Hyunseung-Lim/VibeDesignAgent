import {
  getFirebaseAccessToken,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { loadUserMemoryItems } from "@/lib/server/memoryItems";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await verifyFirebaseIdToken(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getFirebaseAccessToken();
    const memories = await loadUserMemoryItems(user.localId, token);

    return Response.json({ memories });
  } catch (err) {
    console.error("[api/memory/all]", err);
    return Response.json({ error: "failed to load memories" }, { status: 500 });
  }
}
