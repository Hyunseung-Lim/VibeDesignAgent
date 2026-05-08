import { createSign } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

let accessTokenCache: { token: string; expiresAt: number } | null = null;
let serviceAccountCache: ServiceAccount | null = null;

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeServiceAccount(account: ServiceAccount): ServiceAccount {
  return {
    ...account,
    private_key: account.private_key.replace(/\\n/g, "\n"),
    token_uri: account.token_uri || "https://oauth2.googleapis.com/token",
  };
}

async function getServiceAccount() {
  if (serviceAccountCache) return serviceAccountCache;
  const rawKey =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (rawKey) {
    const decoded = rawKey.trim().startsWith("{")
      ? rawKey
      : Buffer.from(rawKey, "base64").toString("utf8");
    serviceAccountCache = normalizeServiceAccount(
      JSON.parse(decoded) as ServiceAccount,
    );
    return serviceAccountCache;
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    serviceAccountCache = normalizeServiceAccount({
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
      token_uri:
        process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    });
    return serviceAccountCache;
  }

  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(process.cwd(), "vibedesignagent-key.json");
  serviceAccountCache = normalizeServiceAccount(
    JSON.parse(await readFile(keyPath, "utf8")) as ServiceAccount,
  );
  return serviceAccountCache;
}

async function getAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const serviceAccount = await getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: serviceAccount.token_uri,
      exp: now + 3600,
      iat: now,
    }),
  )}`;
  const assertion = `${unsignedJwt}.${base64Url(
    createSign("RSA-SHA256").update(unsignedJwt).sign(serviceAccount.private_key),
  )}`;

  const res = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Service account auth failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function assertAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const apiKey =
    process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return false;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { users?: Array<{ email?: string }> };
  return ADMIN_EMAILS.includes(data.users?.[0]?.email ?? "");
}

function firestoreBase() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID missing");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function listDocumentIds(collectionPath: string, token: string) {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${firestoreBase()}/${collectionPath}`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return ids;
    if (!res.ok)
      throw new Error(`List ${collectionPath} failed: ${res.status}`);
    const data = (await res.json()) as {
      documents?: Array<{ name: string }>;
      nextPageToken?: string;
    };
    ids.push(
      ...(data.documents ?? []).map(
        (document) => document.name.split("/").at(-1) ?? "",
      ),
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

async function deleteDocument(documentPath: string, token: string) {
  const res = await fetch(`${firestoreBase()}/${documentPath}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete ${documentPath} failed: ${res.status}`);
  }
}

async function resetOnboardingRecord(uid: string, token: string) {
  const url = new URL(`${firestoreBase()}/users/${uid}`);
  [
    "onboardingCompleted",
    "onboardingCompletedAt",
    "onboardingMemory",
    "onboardingMemoryUpdatedAt",
  ].forEach((field) => url.searchParams.append("updateMask.fieldPaths", field));

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        onboardingCompleted: { booleanValue: false },
        onboardingCompletedAt: { nullValue: "NULL_VALUE" },
        onboardingMemory: { stringValue: "" },
        onboardingMemoryUpdatedAt: { nullValue: "NULL_VALUE" },
      },
    }),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Reset onboarding ${uid} failed: ${res.status}`);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  if (!(await assertAdmin(request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { uid } = await params;
  if (!uid) return Response.json({ error: "uid required" }, { status: 400 });
  const searchParams = new URL(request.url).searchParams;
  const recordsOnly = searchParams.get("recordsOnly") === "1";
  const targetMissionId = searchParams.get("missionId") ?? "";
  const confirmFullDelete = searchParams.get("confirmFullDelete") === "1";

  const token = await getAccessToken();
  if (recordsOnly) {
    if (!targetMissionId) {
      return Response.json({ error: "missionId required" }, { status: 400 });
    }

    await Promise.all([
      deleteDocument(`sessions/${uid}/missions/${targetMissionId}`, token),
      targetMissionId === "onboarding"
        ? resetOnboardingRecord(uid, token)
        : deleteDocument(
            `missions/${targetMissionId}/participants/${uid}`,
            token,
          ),
    ]);

    return Response.json({
      ok: true,
      recordsOnly: true,
      deletedSessionMissions: 1,
      deletedParticipantRecords: targetMissionId === "onboarding" ? 0 : 1,
    });
  }

  if (!confirmFullDelete) {
    return Response.json(
      { error: "confirmFullDelete required" },
      { status: 400 },
    );
  }

  const [missionIds, sessionMissionIds] = await Promise.all([
    listDocumentIds("missions", token),
    listDocumentIds(`sessions/${uid}/missions`, token),
  ]);

  await Promise.all([
    ...sessionMissionIds.map((missionId) =>
      deleteDocument(`sessions/${uid}/missions/${missionId}`, token),
    ),
    ...missionIds.map((missionId) =>
      deleteDocument(`missions/${missionId}/participants/${uid}`, token),
    ),
    deleteDocument(`sessions/${uid}`, token),
    deleteDocument(`users/${uid}`, token),
  ]);

  return Response.json({
    ok: true,
    recordsOnly: false,
    deletedSessionMissions: sessionMissionIds.length,
    deletedParticipantRecords: missionIds.length,
  });
}
