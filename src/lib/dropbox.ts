import type { DropboxTokenState } from "@/lib/editor-types";

const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_CONTENT_API_URL = "https://content.dropboxapi.com/2";

const OAUTH_STATE_KEY = "dropbox-oauth-state";
const OAUTH_VERIFIER_KEY = "dropbox-oauth-verifier";

export interface DropboxFile {
  content: string;
  rev: string;
}

export interface DropboxUploadResult {
  rev: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const stringValue = String.fromCharCode(...bytes);
  const base64 = btoa(stringValue);

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createCodeVerifier(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const random = new Uint8Array(length);

  crypto.getRandomValues(random);

  return Array.from(random, (value) => chars[value % chars.length]).join("");
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", encoded);

  return base64UrlEncode(new Uint8Array(hash));
}

async function exchangeCodeForToken(
  appKey: string,
  redirectUri: string,
  code: string,
  verifier: string,
): Promise<DropboxTokenState> {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox token exchange failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    account_id?: string;
  };

  if (!payload.refresh_token) {
    throw new Error("Dropbox did not return a refresh token. Verify offline access is enabled.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    accountId: payload.account_id,
  };
}

async function refreshAccessToken(appKey: string, token: DropboxTokenState): Promise<DropboxTokenState> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
    client_id: appKey,
  });

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox token refresh failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    account_id?: string;
  };

  return {
    ...token,
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    accountId: payload.account_id ?? token.accountId,
  };
}

export async function startDropboxAuth(appKey: string, redirectUri: string): Promise<void> {
  const state = crypto.randomUUID();
  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);

  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);

  const url = new URL(DROPBOX_AUTH_URL);
  url.searchParams.set("client_id", appKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "files.content.read files.content.write");
  url.searchParams.set("state", state);

  window.location.assign(url.toString());
}

export async function finishDropboxAuthIfNeeded(
  appKey: string,
  redirectUri: string,
): Promise<DropboxTokenState | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return null;
  }

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);

  if (!expectedState || !verifier || state !== expectedState) {
    throw new Error("Dropbox OAuth state mismatch. Please try connecting again.");
  }

  const token = await exchangeCodeForToken(appKey, redirectUri, code, verifier);

  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_VERIFIER_KEY);

  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);

  return token;
}

export async function ensureValidDropboxToken(
  appKey: string,
  token: DropboxTokenState,
): Promise<DropboxTokenState> {
  const oneMinute = 60 * 1000;

  if (Date.now() < token.expiresAt - oneMinute) {
    return token;
  }

  return refreshAccessToken(appKey, token);
}

export async function dropboxDownloadFile(
  token: string,
  path: string,
): Promise<DropboxFile | null> {
  const response = await fetch(`${DROPBOX_CONTENT_API_URL}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });

  if (response.status === 409) {
    return null;
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox download failed: ${detail}`);
  }

  const metadata = response.headers.get("dropbox-api-result");

  if (!metadata) {
    throw new Error("Dropbox response was missing file metadata.");
  }

  const parsedMetadata = JSON.parse(metadata) as { rev: string };
  const content = await response.text();

  return {
    content,
    rev: parsedMetadata.rev,
  };
}

export async function dropboxUploadFile(
  token: string,
  path: string,
  content: string,
): Promise<DropboxUploadResult> {
  const response = await fetch(`${DROPBOX_CONTENT_API_URL}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode: "overwrite",
        autorename: false,
        mute: true,
      }),
    },
    body: content,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox upload failed: ${detail}`);
  }

  const payload = (await response.json()) as { rev: string };

  return {
    rev: payload.rev,
  };
}
