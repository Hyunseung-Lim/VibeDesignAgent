import { createHash } from "node:crypto";
import {
  getFirebaseAccessToken,
  getFirestoreDocument,
  patchFirestoreDocument,
} from "@/lib/server/firebaseAdminRest";

export type StitchApiGroup = "A" | "B";

const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;
const groupCache = new Map<
  string,
  { group: StitchApiGroup; expiresAt: number }
>();

export function normalizeStitchApiGroup(value: unknown): StitchApiGroup | null {
  return value === "A" || value === "B" ? value : null;
}

export function defaultStitchApiGroup(uid: string): StitchApiGroup {
  const firstByte = createHash("sha256").update(uid).digest()[0] ?? 0;
  return firstByte % 2 === 0 ? "A" : "B";
}

export function stitchApiGroupForUser(
  uid: string,
  storedGroup: unknown,
): StitchApiGroup {
  return normalizeStitchApiGroup(storedGroup) ?? defaultStitchApiGroup(uid);
}

export async function resolveUserStitchApiGroup(
  uid: string,
): Promise<StitchApiGroup> {
  const cached = groupCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.group;

  const token = await getFirebaseAccessToken();
  const profile = await getFirestoreDocument(`users/${uid}`, token);
  const storedGroup = normalizeStitchApiGroup(profile?.stitchApiGroup);
  const group = storedGroup ?? defaultStitchApiGroup(uid);

  if (!storedGroup) {
    await patchFirestoreDocument(
      `users/${uid}`,
      {
        stitchApiGroup: group,
        stitchApiGroupAssignedAt: Date.now(),
      },
      token,
    );
  }

  groupCache.set(uid, {
    group,
    expiresAt: Date.now() + GROUP_CACHE_TTL_MS,
  });
  return group;
}

