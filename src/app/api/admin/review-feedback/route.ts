import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  listFirestoreDocumentIds,
  queryFirestoreCollection,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const FEEDBACK_COLLECTION = "memoryReviewFeedback";

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  if (!requester || !isAdminEmail(requester.email)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const token = await getFirebaseAccessToken();
  const userIds = await listFirestoreDocumentIds("users", token);

  const rowsByUser = await Promise.all(
    userIds.map(async (uid) => {
      const docs = await queryFirestoreCollection(
        `users/${uid}`,
        FEEDBACK_COLLECTION,
        token,
      );
      if (docs.length === 0) return [];
      const profile = await getFirestoreDocument(`users/${uid}`, token);
      return docs.map((doc) => ({
        uid,
        displayName: profile?.displayName ?? null,
        email: profile?.email ?? null,
        // Document id is the encoded missionId (see review-feedback route).
        missionId: decodeURIComponent(doc.id),
        answers:
          doc.fields.answers && typeof doc.fields.answers === "object"
            ? doc.fields.answers
            : {},
        submittedAt: numberOrNull(doc.fields.submittedAt),
        updatedAt: numberOrNull(doc.fields.updatedAt),
      }));
    }),
  );

  const rows = rowsByUser
    .flat()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return Response.json({ rows });
}
