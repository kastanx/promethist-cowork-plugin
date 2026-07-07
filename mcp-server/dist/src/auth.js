import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { startCallbackListener, beginLoginUrl } from "./login.js";
const CACHE_DIR = path.join(os.homedir(), ".config", "promethist-mcp");
const SESSION_FILE = path.join(CACHE_DIR, "session.json");
let accessCache = null;
function readStoredCookie() {
    try {
        return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).cookie || "";
    }
    catch {
        return "";
    }
}
function writeStoredCookie(cookie) {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookie }, null, 2), { mode: 0o600 });
}
/** Exchange a session cookie at {webUrl}/api/auth/session for a fresh access token. */
async function exchangeCookieForToken(cookie) {
    try {
        const res = await fetch(`${config.webUrl}/api/auth/session`, {
            headers: { Cookie: cookie, Accept: "application/json" },
        });
        if (!res.ok)
            return null;
        const s = (await res.json());
        if (!s.accessToken)
            return null;
        return {
            token: s.accessToken,
            expMs: s.expiresAt ? s.expiresAt * 1000 : Date.now() + 5 * 60_000,
            email: s.user?.email,
        };
    }
    catch {
        return null;
    }
}
/**
 * Start the persistent login-callback listener. Call ONCE at server startup. When the user finishes
 * logging in (in any running instance), the redirect lands here; we store the cookie and warm the
 * access-token cache so the next tool call is authenticated.
 */
export function initAuth() {
    startCallbackListener((cookie) => {
        writeStoredCookie(cookie);
        void exchangeCookieForToken(cookie).then((ex) => {
            if (ex)
                accessCache = { token: ex.token, expEpochMs: ex.expMs };
        });
    });
}
/**
 * Start a browser login. Returns the /cli/connect URL for the caller to PRINT (and it best-effort
 * auto-opens the browser). The session is captured by the persistent listener and cached; once the
 * user logs in, the next getAccessToken() call succeeds. Returns "" if already logged in.
 */
export async function beginLogin() {
    const existing = config.cookie || readStoredCookie();
    if (existing) {
        const ex = await exchangeCookieForToken(existing);
        if (ex) {
            accessCache = { token: ex.token, expEpochMs: ex.expMs };
            return "";
        }
    }
    return beginLoginUrl();
}
/**
 * Resolve a bearer token, in priority order:
 *   1. PROMETHIST_TOKEN (raw access token, env).
 *   2. cached access token still valid.
 *   3. a cookie (PROMETHIST_COOKIE env, else stored from a prior browser login) -> /api/auth/session.
 *   4. browser login (unless PROMETHIST_NO_BROWSER=1): prints a link and asks the user to retry.
 */
export async function getAccessToken() {
    if (config.token)
        return config.token;
    const now = Date.now();
    if (accessCache && accessCache.expEpochMs - 60_000 > now)
        return accessCache.token;
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
    // Non-blocking: print a link (browser also auto-opens on macOS) and ask the user to retry once
    // they've signed in — the persistent listener captures the session in the meantime.
    const url = await beginLogin();
    if (accessCache)
        return accessCache.token; // a valid session already existed
    throw new Error(`Not logged in yet. Open this link in your browser to sign in:\n${url}\n\nOnce you've finished logging in there, run your request again.`);
}
/** Forget the cached session so the next call re-prompts for browser login. */
export function logout() {
    accessCache = null;
    let clearedFile = false;
    try {
        if (fs.existsSync(SESSION_FILE)) {
            fs.rmSync(SESSION_FILE);
            clearedFile = true;
        }
    }
    catch {
        // ignore
    }
    const note = config.cookie
        ? "PROMETHIST_COOKIE is set in the environment and still overrides login — unset it to fully log out."
        : undefined;
    return { clearedFile, note };
}
