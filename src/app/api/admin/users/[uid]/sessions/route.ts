import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  deleteFirestoreDocument,
  getFirebaseAccessToken,
  getFirestoreDocument,
  getGoogleAccessToken,
  listFirestoreDocumentIds,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "vibedesignagent.firebasestorage.app";

function safeName(value: string, fallback: string) {
  const cleaned = (value.trim() || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return cleaned.slice(0, 100);
}

async function assertAdmin(request: Request) {
  const admin = await verifyFirebaseIdToken(request);
  return !!admin && isAdminEmail(admin.email);
}

async function loadCollection(path: string, token: string) {
  const ids = await listFirestoreDocumentIds(path, token);
  return Promise.all(
    ids.map(async (id) => ({
      id,
      ...(((await getFirestoreDocument(`${path}/${id}`, token)) ?? {}) as Record<
        string,
        unknown
      >),
    })),
  );
}

async function loadSessions(uid: string, token: string) {
  const missionIds = await listFirestoreDocumentIds(`sessions/${uid}/missions`, token);
  const legacyEntries = await Promise.all(
    missionIds.map(async (missionId) => {
      const missionPath = `sessions/${uid}/missions/${missionId}`;
      const data =
        ((await getFirestoreDocument(missionPath, token)) ?? {}) as Record<
          string,
          unknown
        >;
      return [
        missionId,
        {
          id: missionId,
          ...data,
          memoryDrafts: await loadCollection(`${missionPath}/memoryDrafts`, token),
        },
      ] as const;
    }),
  );
  const runIds = await listFirestoreDocumentIds(`sessions/${uid}/missionRuns`, token);
  const runEntries = await Promise.all(
    runIds.map(async (runId) => {
      const runPath = `sessions/${uid}/missionRuns/${runId}`;
      const data =
        ((await getFirestoreDocument(runPath, token)) ?? {}) as Record<
          string,
          unknown
        >;
      return [
        runId,
        {
          id: runId,
          ...data,
          memoryDrafts: await loadCollection(`${runPath}/memoryDrafts`, token),
        },
      ] as const;
    }),
  );
  return {
    legacyMissionSessions: Object.fromEntries(legacyEntries),
    missionRuns: Object.fromEntries(runEntries),
  };
}

async function loadMemories(uid: string, token: string) {
  const [episodicMemories, semanticMemories, memories_0_1_1] = await Promise.all([
    loadCollection(`users/${uid}/episodicMemories`, token),
    loadCollection(`users/${uid}/semanticMemories`, token),
    loadCollection(`users/${uid}/memories_0_1_1`, token),
  ]);
  return { episodicMemories, semanticMemories, memories_0_1_1 };
}

async function loadParticipantRecords(uid: string, token: string) {
  const missionIds = await listFirestoreDocumentIds("missions", token);
  const records = await Promise.all(
    missionIds.map(async (missionId) => {
      const data = await getFirestoreDocument(
        `missions/${missionId}/participants/${uid}`,
        token,
      );
      return data ? { missionId, ...data } : null;
    }),
  );
  return records.filter(Boolean);
}

async function listStorageObjects(uid: string, token: string) {
  const objects: Array<{ name: string; size?: string; updated?: string }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o`,
    );
    url.searchParams.set("prefix", `presentations/${uid}/`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return objects;
    if (!res.ok) throw new Error(`List storage failed: ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ name: string; size?: string; updated?: string }>;
      nextPageToken?: string;
    };
    objects.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return objects;
}

async function downloadStorageObject(name: string, token: string) {
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
      name,
    )}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Download ${name} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteStorageObject(name: string, token: string) {
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
      name,
    )}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete storage ${name} failed: ${res.status}`);
  }
}

async function backupStorage(uid: string, backupDir: string, token: string) {
  const objects = await listStorageObjects(uid, token);
  const storageDir = path.join(backupDir, "presentations");
  await mkdir(storageDir, { recursive: true });
  const files = [];
  for (const object of objects) {
    const relative = object.name.replace(`presentations/${uid}/`, "");
    if (!relative) continue;
    const backupPath = path.join(
      "presentations",
      safeName(relative.replace(/\//g, "__"), object.name),
    );
    await writeFile(
      path.join(backupDir, backupPath),
      await downloadStorageObject(object.name, token),
    );
    files.push({
      name: object.name,
      backupPath,
      size: object.size,
      updated: object.updated,
    });
  }
  return files;
}

async function deleteSessions(uid: string, token: string) {
  const missionIds = await listFirestoreDocumentIds(`sessions/${uid}/missions`, token);
  const runIds = await listFirestoreDocumentIds(`sessions/${uid}/missionRuns`, token);
  let deletedDrafts = 0;
  await Promise.all(
    [
      ...missionIds.map((missionId) => `sessions/${uid}/missions/${missionId}`),
      ...runIds.map((runId) => `sessions/${uid}/missionRuns/${runId}`),
    ].map(async (sessionPath) => {
      const draftIds = await listFirestoreDocumentIds(`${sessionPath}/memoryDrafts`, token);
      deletedDrafts += draftIds.length;
      await Promise.all(
        draftIds.map((draftId) =>
          deleteFirestoreDocument(`${sessionPath}/memoryDrafts/${draftId}`, token),
        ),
      );
      await deleteFirestoreDocument(sessionPath, token);
    }),
  );
  await deleteFirestoreDocument(`sessions/${uid}`, token);
  return {
    deletedSessionMissions: missionIds.length,
    deletedSessionRuns: runIds.length,
    deletedMemoryDrafts: deletedDrafts,
  };
}

async function deleteParticipantRecords(uid: string, token: string) {
  const missionIds = await listFirestoreDocumentIds("missions", token);
  const existingRecords = await Promise.all(
    missionIds.map(async (missionId) => {
      const data = await getFirestoreDocument(
        `missions/${missionId}/participants/${uid}`,
        token,
      );
      return data ? missionId : null;
    }),
  );
  const existingMissionIds = existingRecords.filter(Boolean) as string[];
  await Promise.all(
    existingMissionIds.map((missionId) =>
      deleteFirestoreDocument(`missions/${missionId}/participants/${uid}`, token),
    ),
  );
  return existingMissionIds.length;
}

async function deleteStorage(uid: string, token: string) {
  const objects = await listStorageObjects(uid, token);
  await Promise.all(objects.map((object) => deleteStorageObject(object.name, token)));
  return objects.length;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  if (!(await assertAdmin(request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { uid } = await params;
  if (!uid) return Response.json({ error: "uid required" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    confirm?: string;
  };
  if (body.confirm !== "backup-and-delete-sessions") {
    return Response.json({ error: "confirm required" }, { status: 400 });
  }

  const firestoreToken = await getFirebaseAccessToken();
  const storageToken = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/devstorage.full_control",
  );
  const profile = await getFirestoreDocument(`users/${uid}`, firestoreToken);
  const email = String(profile?.email ?? uid);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(
    process.cwd(),
    "exports",
    "deleted-users",
    `${timestamp}-${safeName(email, uid)}`,
  );
  await mkdir(backupDir, { recursive: true });

  const [sessions, memories, participantRecords, storageFiles] = await Promise.all([
    loadSessions(uid, firestoreToken),
    loadMemories(uid, firestoreToken),
    loadParticipantRecords(uid, firestoreToken),
    backupStorage(uid, backupDir, storageToken),
  ]);

  await writeFile(
    path.join(backupDir, "backup.json"),
    JSON.stringify(
      {
        uid,
        email,
        exportedAt: timestamp,
        sessions,
        memories,
        participantRecords,
        storageFiles,
      },
      null,
      2,
    ),
    "utf8",
  );

  const sessionDeleteResult = await deleteSessions(uid, firestoreToken);
  const deletedParticipantRecords = await deleteParticipantRecords(uid, firestoreToken);
  const deletedStorageFiles = await deleteStorage(uid, storageToken);

  return Response.json({
    ok: true,
    backupPath: path.relative(process.cwd(), backupDir),
    ...sessionDeleteResult,
    deletedParticipantRecords,
    deletedStorageFiles,
  });
}
