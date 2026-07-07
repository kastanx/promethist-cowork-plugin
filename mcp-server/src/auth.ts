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

// A login in progress: the auth URL (to print for the user) + a background promise that caches the
// session on success. Idempotent so repeated tool calls reuse the one loopback listener.
let pendingLogin: { url: string; done: Promise<void> } | null = null;

/**
 * Start a browser login WITHOUT blocking. Returns the auth URL so the caller can PRINT it for the
 * user to click (the browser may also auto-open on macOS/Linux; on Windows it does not). The session
 * is captured + cached in the BACKGROUND; once the user logs in, the next getAccessToken() call
 * succeeds. Returns "" if a valid session already exists (nothing to do).
 */
export async function beginLogin(): Promise<string> {
  const existing = config.cookie || readStoredCookie();
  if (existing) {
    const ex = await exchangeCookieForToken(existing);
    if (ex) {
      accessCache = { token: ex.token, expEpochMs: ex.expMs };
      return "";
    }
  }
  if (pendingLogin) return pendingLogin.url;

  let resolveUrl!: (u: string) => void;
  const urlP = new Promise<string>((r) => {
    resolveUrl = r;
  });
  // 10-min window so the user has time to open the link and sign in.
  const done = loginViaBrowser(600_000, (u) => resolveUrl(u))
    .then(async (cookie) => {
      writeStoredCookie(cookie);
      const ex = await exchangeCookieForToken(cookie);
      if (ex) accessCache = { token: ex.token, expEpochMs: ex.expMs };
    })
    .catch(() => {
      /* timed out / failed — the user can run login again to get a fresh link */
    })
    .finally(() => {
      pendingLogin = null;
    });
  const url = await urlP; // resolves as soon as the loopback listener is up
  pendingLogin = { url, done };
  return url;
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
  // Non-blocking: start login (prints a link; the browser may auto-open on macOS) and tell the user
  // to finish signing in, rather than hanging for minutes if the browser never opens (e.g. Windows).
  const url = await beginLogin();
  if (accessCache) return accessCache.token; // a valid session already existed / just completed
  throw new Error(
    `Not logged in yet. Open this link in your browser to sign in:\n${url}\n\nOnce you've finished logging in there, run your request again.`,
  );
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
