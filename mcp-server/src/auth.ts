import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { loginViaBrowser } from "./login.js";

const CACHE_DIR = path.join(os.homedir(), ".config", "promethist-mcp");
const SESSION_FILE = path.join(CACHE_DIR, "session.json");

let accessCache: { token: string; expEpochMs: number } | null = null;

function readStoredCookie(): string {
  try {
    return (JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).cookie as string) || "";
  } catch {
    return "";
  }
}

function writeStoredCookie(cookie: string): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookie }, null, 2), { mode: 0o600 });
}

/** Exchange a session cookie at {webUrl}/api/auth/session for a fresh access token. */
async function exchangeCookieForToken(
  cookie: string,
): Promise<{ token: string; expMs: number; email?: string } | null> {
  try {
    const res = await fetch(`${config.webUrl}/api/auth/session`, {
      headers: { Cookie: cookie, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const s = (await res.json()) as { accessToken?: string; expiresAt?: number; user?: { email?: string } };
    if (!s.accessToken) return null;
    return {
      token: s.accessToken,
      expMs: s.expiresAt ? s.expiresAt * 1000 : Date.now() + 5 * 60_000,
      email: s.user?.email,
    };
  } catch {
    return null;
  }
}

/** Run the browser login, cache the session, return the user's email. */
export async function interactiveLogin(): Promise<string> {
  // Another process/session may already have logged in while we were idle — re-check first.
  const existing = config.cookie || readStoredCookie();
  if (existing) {
    const ex = await exchangeCookieForToken(existing);
    if (ex) {
      accessCache = { token: ex.token, expEpochMs: ex.expMs };
      return ex.email ?? "unknown";
    }
  }
  const cookie = await loginViaBrowser();
  writeStoredCookie(cookie);
  const ex = await exchangeCookieForToken(cookie);
  if (!ex) throw new Error("Login completed but the session returned no access token. Please try again.");
  accessCache = { token: ex.token, expEpochMs: ex.expMs };
  return ex.email ?? "unknown";
}

/**
 * Resolve a bearer token, in priority order:
 *   1. PROMETHIST_TOKEN (raw access token, env).
 *   2. cached access token still valid.
 *   3. a cookie (PROMETHIST_COOKIE env, else stored from a prior browser login) -> /api/auth/session.
 *   4. browser login (unless PROMETHIST_NO_BROWSER=1).
 */
export async function getAccessToken(): Promise<string> {
  if (config.token) return config.token;

  const now = Date.now();
  if (accessCache && accessCache.expEpochMs - 60_000 > now) return accessCache.token;

  const cookie = config.cookie || readStoredCookie();
  if (cookie) {
    const ex = await exchangeCookieForToken(cookie);
    if (ex) {
      accessCache = { token: ex.token, expEpochMs: ex.expMs };
      return ex.token;
    }
  }

  if (process.env.PROMETHIST_NO_BROWSER === "1") {
    throw new Error("Not authenticated. Run the 'login' tool to sign in (or set PROMETHIST_COOKIE / PROMETHIST_TOKEN).");
  }
  await interactiveLogin();
  if (!accessCache) throw new Error("Login did not produce a token.");
  return accessCache.token;
}

/** Forget the cached session so the next call re-prompts for browser login. */
export function logout(): { clearedFile: boolean; note?: string } {
  accessCache = null;
  let clearedFile = false;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.rmSync(SESSION_FILE);
      clearedFile = true;
    }
  } catch {
    // ignore
  }
  const note = config.cookie
    ? "PROMETHIST_COOKIE is set in the environment and still overrides login — unset it to fully log out."
    : undefined;
  return { clearedFile, note };
}
