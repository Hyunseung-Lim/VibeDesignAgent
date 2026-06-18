import { randomUUID } from "crypto";
import { isAdminEmail } from "@/lib/admin";
import {
  deleteStorageObject,
  getFirebaseStorageAccessToken,
  uploadPublicStorageObject,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "asset-image"
  );
}

async function requireAdmin(request: Request) {
  const requester = await verifyFirebaseIdToken(request);
  return requester && isAdminEmail(requester.email) ? requester : null;
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester) return Response.json({ error: "forbidden" }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "image file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "only image files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      { error: "image file must be 8MB or smaller" },
      { status: 400 },
    );
  }

  const token = await getFirebaseStorageAccessToken();
  const buffer = Buffer.from(await file.arrayBuffer());
  const objectName = `mission-assets/${randomUUID()}-${safeFileName(file.name)}`;
  const uploaded = await uploadPublicStorageObject(
    objectName,
    file.type,
    buffer,
    token,
  );

  return Response.json(uploaded);
}

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  const objectName = String(body.path ?? "").trim();
  if (!objectName.startsWith("mission-assets/")) {
    return Response.json({ error: "invalid asset path" }, { status: 400 });
  }

  const token = await getFirebaseStorageAccessToken();
  await deleteStorageObject(objectName, token);
  return Response.json({ ok: true });
}
