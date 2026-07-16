import {
  Stitch,
  StitchError,
  StitchToolClient,
  type StitchConfigInput,
} from "@google/stitch-sdk";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StitchApiGroup } from "@/lib/server/stitchApiGroup";

type StitchAuthMode =
  | "refresh-user-oauth"
  | "adc-user-oauth"
  | "static-user-oauth"
  | "api-key";
type StitchAuthPreference = "api-key" | "api-key-only" | "oauth";
type StitchAuthConfig = {
  config: StitchConfigInput;
  mode: StitchAuthMode;
};
type RefreshOAuthInput = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  tokenUri: string;
  mode: Extract<StitchAuthMode, "refresh-user-oauth" | "adc-user-oauth">;
};
type CachedAccessToken = {
  token: string;
  expiresAt: number;
};

let refreshTokenCache: CachedAccessToken | null = null;

export const STITCH_AUTH_ERROR_CODE = "stitch-auth";
export const STITCH_AUTH_ERROR_MESSAGE =
  "Stitch 인증 정보가 만료되었거나 유효하지 않습니다. 서버의 STITCH_API_KEY 또는 Stitch OAuth 설정을 확인해주세요.";
export const STITCH_OAUTH_REQUIRED_ERROR_CODE = "stitch-oauth-required";
export const STITCH_OAUTH_REQUIRED_ERROR_MESSAGE =
  "Stitch 인증 정보가 설정되지 않았습니다. 서버의 STITCH_API_KEY 또는 STITCH_ACCESS_TOKEN + GOOGLE_CLOUD_PROJECT 설정을 확인해주세요.";

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function stitchProjectId() {
  return envValue("STITCH_GOOGLE_CLOUD_PROJECT") || envValue("GOOGLE_CLOUD_PROJECT");
}

function stitchAuthPreference(): StitchAuthPreference {
  const preference = envValue("STITCH_AUTH_PREFERENCE");
  if (preference === "oauth") return "oauth";
  if (preference === "api-key-only") return "api-key-only";
  return "api-key";
}

function staticOAuthConfig(): StitchAuthConfig | null {
  const accessToken = envValue("STITCH_ACCESS_TOKEN");
  const projectId = stitchProjectId();
  if (accessToken && projectId) {
    return { config: { accessToken, projectId }, mode: "static-user-oauth" };
  }
  return null;
}

function apiKeyConfig(explicitApiKey?: string): StitchAuthConfig | null {
  const apiKey = explicitApiKey?.trim() || envValue("STITCH_API_KEY");
  if (apiKey) {
    return { config: { apiKey }, mode: "api-key" };
  }
  return null;
}

function envRefreshOAuthInput(): RefreshOAuthInput | null {
  const refreshToken = envValue("STITCH_OAUTH_REFRESH_TOKEN");
  const clientId = envValue("STITCH_OAUTH_CLIENT_ID");
  const clientSecret = envValue("STITCH_OAUTH_CLIENT_SECRET");
  const projectId = stitchProjectId();
  if (!refreshToken || !clientId || !clientSecret || !projectId) return null;
  return {
    refreshToken,
    clientId,
    clientSecret,
    projectId,
    tokenUri:
      envValue("STITCH_OAUTH_TOKEN_URI") ||
      "https://oauth2.googleapis.com/token",
    mode: "refresh-user-oauth",
  };
}

function adcCredentialsPath() {
  const explicitPath = envValue("STITCH_OAUTH_ADC_PATH");
  if (explicitPath) return explicitPath;
  const cloudSdkConfig =
    envValue("CLOUDSDK_CONFIG") || path.join(os.homedir(), ".config", "gcloud");
  return path.join(cloudSdkConfig, "application_default_credentials.json");
}

async function adcRefreshOAuthInput(): Promise<RefreshOAuthInput | null> {
  const raw = await readFile(adcCredentialsPath(), "utf8").catch(() => "");
  if (!raw) return null;

  const data = JSON.parse(raw) as {
    refresh_token?: string;
    client_id?: string;
    client_secret?: string;
    quota_project_id?: string;
    token_uri?: string;
    type?: string;
  };
  if (
    !data.refresh_token ||
    !data.client_id ||
    !data.client_secret ||
    data.type === "service_account"
  ) {
    return null;
  }

  const projectId = stitchProjectId() || data.quota_project_id;
  if (!projectId) return null;
  return {
    refreshToken: data.refresh_token,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    projectId,
    tokenUri: data.token_uri || "https://oauth2.googleapis.com/token",
    mode: "adc-user-oauth",
  };
}

async function refreshUserOAuthConfig(): Promise<StitchAuthConfig | null> {
  const input = envRefreshOAuthInput() ?? (await adcRefreshOAuthInput());
  if (!input) return null;

  if (refreshTokenCache && refreshTokenCache.expiresAt > Date.now() + 60_000) {
    return {
      config: { accessToken: refreshTokenCache.token, projectId: input.projectId },
      mode: input.mode,
    };
  }

  const res = await fetch(input.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Stitch user OAuth refresh failed: ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Stitch user OAuth refresh returned no access_token.");
  }
  refreshTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return {
    config: { accessToken: data.access_token, projectId: input.projectId },
    mode: input.mode,
  };
}

async function userOAuthConfig(options?: { requireOAuth?: boolean }) {
  try {
    const refreshOAuth = await refreshUserOAuthConfig();
    if (refreshOAuth) return refreshOAuth;
  } catch (err) {
    if (options?.requireOAuth) throw err;
    console.warn(
      "[stitch] refresh user OAuth unavailable; trying other Stitch auth:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const staticOAuth = staticOAuthConfig();
  if (staticOAuth) return staticOAuth;

  if (options?.requireOAuth) {
    throw new Error(
      "Stitch user OAuth is not configured. Set STITCH_OAUTH_REFRESH_TOKEN with STITCH_OAUTH_CLIENT_ID/STITCH_OAUTH_CLIENT_SECRET, or STITCH_ACCESS_TOKEN with GOOGLE_CLOUD_PROJECT.",
    );
  }

  return null;
}

async function stitchConfig(options?: {
  requireOAuth?: boolean;
  forceApiKey?: boolean;
  apiKey?: string;
}): Promise<StitchAuthConfig> {
  const preference = stitchAuthPreference();
  if (options?.apiKey) {
    return { config: { apiKey: options.apiKey }, mode: "api-key" };
  }
  if (options?.forceApiKey) {
    const apiKey = apiKeyConfig();
    if (apiKey) return apiKey;
    throw new Error("STITCH_API_KEY is not configured.");
  }

  if (preference === "oauth" || options?.requireOAuth) {
    const oauth = await userOAuthConfig(options);
    if (oauth) return oauth;
  }

  const apiKey = apiKeyConfig();
  if (apiKey) return apiKey;

  if (preference === "api-key-only") {
    throw new Error("STITCH_API_KEY is not configured.");
  }

  if (preference !== "oauth") {
    const oauth = await userOAuthConfig(options);
    if (oauth) return oauth;
  }

  throw new Error(
    "Stitch authentication is not configured. Set STITCH_API_KEY, STITCH_OAUTH_REFRESH_TOKEN with OAuth client credentials, or STITCH_ACCESS_TOKEN with GOOGLE_CLOUD_PROJECT.",
  );
}

export async function createStitchClient(options?: {
  requireOAuth?: boolean;
  forceApiKey?: boolean;
  apiKey?: string;
  apiKeyGroup?: StitchApiGroup;
}) {
  const auth = await stitchConfig(options);
  // The SDK constructor falls back to process.env.STITCH_API_KEY even when an
  // OAuth accessToken is supplied. Its auth builder prefers apiKey over OAuth,
  // so hide the env key while constructing OAuth clients.
  const envApiKey = process.env.STITCH_API_KEY;
  if (auth.mode !== "api-key") {
    delete process.env.STITCH_API_KEY;
  }
  let client: StitchToolClient;
  try {
    client = new StitchToolClient(auth.config);
  } finally {
    if (envApiKey !== undefined) {
      process.env.STITCH_API_KEY = envApiKey;
    }
  }
  const sdkConfig = (
    client as unknown as {
      config?: { apiKey?: string; accessToken?: string; projectId?: string };
    }
  ).config;
  console.info(
    "[stitch] auth diagnostics:",
    JSON.stringify({
      mode: auth.mode,
      preference: stitchAuthPreference(),
      requested: {
        requireOAuth: Boolean(options?.requireOAuth),
        forceApiKey: Boolean(options?.forceApiKey),
        apiKeyGroup: options?.apiKeyGroup ?? null,
      },
      availableEnv: {
        apiKey: Boolean(envValue("STITCH_API_KEY")),
        apiKeyA: Boolean(envValue("STITCH_API_KEY_A")),
        apiKeyB: Boolean(envValue("STITCH_API_KEY_B")),
        accessToken: Boolean(envValue("STITCH_ACCESS_TOKEN")),
        refreshOAuth: Boolean(envRefreshOAuthInput()),
        projectId: Boolean(stitchProjectId()),
      },
      sdkConfig: {
        apiKey: Boolean(sdkConfig?.apiKey),
        accessToken: Boolean(sdkConfig?.accessToken),
        projectId: Boolean(sdkConfig?.projectId),
        effectiveHeader: sdkConfig?.apiKey
          ? "X-Goog-Api-Key"
          : sdkConfig?.accessToken
            ? "Authorization"
            : "none",
      },
    }),
  );
  return { client, sdk: new Stitch(client) };
}

export function stitchApiKeyForGroup(group: StitchApiGroup) {
  const apiKey = envValue(`STITCH_API_KEY_${group}`);
  if (!apiKey) {
    throw new Error(`STITCH_API_KEY_${group} is not configured.`);
  }
  return apiKey;
}

export function isStitchAuthError(error: unknown) {
  if (error instanceof StitchError && error.code === "AUTH_FAILED") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /authentication failed|auth_failed|missing required authentication credential|oauth 2 access token|valid authentication credential|invalid authentication|unauthorized|unauthenticated|api key/i.test(
    message,
  );
}
