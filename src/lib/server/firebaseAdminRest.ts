import { createSign, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

type FirestoreValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { nullValue: "NULL_VALUE" }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

type FirestoreDecodedValue =
  | string
  | boolean
  | number
  | null
  | undefined
  | FirestoreDecodedValue[]
  | { [key: string]: FirestoreDecodedValue };

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
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

export async function getGoogleAccessToken(scope: string) {
  const cached = accessTokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const serviceAccount = await getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
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
  accessTokenCache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

export async function getFirebaseAccessToken() {
  return getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
}

export async function getFirebaseStorageAccessToken() {
  return getGoogleAccessToken("https://www.googleapis.com/auth/devstorage.full_control");
}

export function storageBucketName() {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET missing");
  return bucket;
}

export function firebaseStorageDownloadUrl(
  bucket: string,
  objectName: string,
  downloadToken: string,
) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    objectName,
  )}?alt=media&token=${downloadToken}`;
}

export async function uploadPublicStorageObject(
  objectName: string,
  contentType: string,
  bodyBuffer: Buffer,
  token: string,
) {
  const bucket = storageBucketName();
  const downloadToken = randomUUID();
  const boundary = `storage-${randomUUID()}`;
  const metadata = {
    name: objectName,
    contentType,
    cacheControl: "public, max-age=31536000",
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata,
      )}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bodyBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  await res.json().catch(() => null);

  return {
    path: objectName,
    url: firebaseStorageDownloadUrl(bucket, objectName, downloadToken),
  };
}

export async function deleteStorageObject(objectName: string, token: string) {
  const bucket = storageBucketName();
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(
      objectName,
    )}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete storage ${objectName} failed: ${res.status}`);
  }
}

export async function downloadStorageObject(objectName: string, token: string) {
  const bucket = storageBucketName();
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(
      objectName,
    )}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage download failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

export async function verifyFirebaseIdToken(request: Request) {
  const idToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!idToken) return null;
  const apiKey =
    process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    users?: Array<{
      localId: string;
      email?: string;
      displayName?: string;
      photoUrl?: string;
    }>;
  };
  return data.users?.[0] ?? null;
}

export function firestoreBase() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID missing");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

// Firestore 읽기는 요청당 수십~수백 개의 병렬 REST 호출로 이뤄져 transient
// 오류(429/5xx, 소켓 오류) 하나만 나도 라우트 전체가 500이 된다. 읽기 호출에
// 한해 짧은 backoff 재시도로 흡수한다.
// 또한 메모리가 많은 사용자는 문서 수백 개를 Promise.all로 한꺼번에 조회하는데,
// 무제한 병렬 TLS 연결이 connect ETIMEDOUT을 유발했다(15.289). 모든 읽기가
// 공유하는 semaphore로 동시 연결 수를 제한하고, 시도당 타임아웃으로 한 번의
// hang이 요청 전체를 수십 초 붙잡지 않게 한다.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_CONCURRENT_FIRESTORE_READS = 12;
const FIRESTORE_READ_TIMEOUT_MS = 10_000;

let activeFirestoreReads = 0;
const firestoreReadQueue: Array<() => void> = [];

async function acquireFirestoreReadSlot() {
  if (activeFirestoreReads < MAX_CONCURRENT_FIRESTORE_READS) {
    activeFirestoreReads += 1;
    return;
  }
  await new Promise<void>((resolve) => firestoreReadQueue.push(resolve));
}

function releaseFirestoreReadSlot() {
  const next = firestoreReadQueue.shift();
  if (next) next();
  else activeFirestoreReads -= 1;
}

async function fetchFirestoreRead(
  url: string | URL,
  token: string,
  attempts = 3,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    await acquireFirestoreReadSlot();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FIRESTORE_READ_TIMEOUT_MS),
      });
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts - 1) {
        lastError = new Error(`Firestore read failed: ${res.status}`);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
    } finally {
      releaseFirestoreReadSlot();
    }
  }
  throw lastError;
}

export async function listFirestoreDocumentIds(
  collectionPath: string,
  token: string,
) {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${firestoreBase()}/${collectionPath}`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetchFirestoreRead(url, token);
    if (res.status === 404) return ids;
    if (!res.ok) throw new Error(`List ${collectionPath} failed: ${res.status}`);
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

export async function deleteFirestoreDocument(documentPath: string, token: string) {
  const res = await fetch(`${firestoreBase()}/${documentPath}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete ${documentPath} failed: ${res.status}`);
  }
}

function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) {
    return { integerValue: String(value) };
  }
  if (typeof value === "number") return { doubleValue: value };
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE" };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [
            key,
            encodeFirestoreValue(item),
          ]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(
  value: FirestoreValue | undefined,
): FirestoreDecodedValue {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields);
  return null;
}

export function decodeFirestoreFields(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, FirestoreDecodedValue> {
  return Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  );
}

export async function getFirestoreDocument(documentPath: string, token: string) {
  const res = await fetchFirestoreRead(`${firestoreBase()}/${documentPath}`, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Get ${documentPath} failed: ${res.status}`);
  const data = (await res.json()) as {
    fields?: Record<string, FirestoreValue>;
  };
  return decodeFirestoreFields(data.fields);
}

export async function patchFirestoreDocument(
  documentPath: string,
  data: Record<string, unknown>,
  token: string,
  deleteFields: string[] = [],
) {
  const url = new URL(`${firestoreBase()}/${documentPath}`);
  [...Object.keys(data), ...deleteFields].forEach((field) =>
    url.searchParams.append("updateMask.fieldPaths", field),
  );
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          encodeFirestoreValue(value),
        ]),
      ),
    }),
  });
  if (!res.ok) throw new Error(`Patch ${documentPath} failed: ${res.status}`);
}
