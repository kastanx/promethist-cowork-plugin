import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE_NAME = "authjs.session-token";
// Fixed loopback port so the /cli/connect redirect always targets a known address. Overridable for
// tests. A fixed port lets ANY running plugin instance answer the callback (Claude Code + cowork may
// both run the plugin) and lets a restarted process answer a callback started by a prior one.
const LOOPBACK_PORT = Number(process.env.PROMETHIST_LOOPBACK_PORT) || 51763;

// Pending login states persisted to disk (state -> expiryMs), so the callback is still valid even if
// the MCP host recycles/kills the plugin process between "login" and the browser redirect back — the
// earlier per-login in-process loopback died as soon as the tool returned, which is why the redirect
// to localhost was "unreachable". A small in-memory set tracks THIS process's logins for ref-counting.
const PENDING_FILE = path.join(os.homedir(), ".config", "promethist-mcp", "pending.json");
const localStates = new Set<string>();
let server: http.Server | null = null;
let onSessionCb: ((cookie: string) => void) | null = null;

function readPending(): Record<string, number> {
  try {
    const obj = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8")) as Record<string, number>;
    const now = Date.now();
    let changed = false;
    for (const [s, exp] of Object.entries(obj)) if (!(exp > now)) { delete obj[s]; changed = true; }
    if (changed) writePending(obj);
    return obj;
  } catch {
    return {};
  }
}

function writePending(obj: Record<string, number>): void {
  try {
    fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(PENDING_FILE, JSON.stringify(obj), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

function openBrowser(url: string): void {
  if (process.env.PROMETHIST_NO_BROWSER === "1") return; // tests / headless
  try {
    if (process.platform === "win32") {
      // cmd `start` opens the default browser; the URL MUST be double-quoted or cmd treats `&` as a
      // command separator and truncates it. windowsVerbatimArguments keeps our exact quoting. This is
      // best-effort only — the URL is also PRINTED for the user to click.
      spawn("cmd.exe", ["/c", "start", '""', `"${url}"`], {
        windowsVerbatimArguments: true,
        stdio: "ignore",
        detached: true,
      }).unref();
    } else {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // The URL is printed too — the user can open it manually.
  }
}

// Matches the Promethist /login page: dark theme, white orb logo + "promethist"
// wordmark (Figtree), 32px headline (white + #58585C second line), blurred orb glow.
const page = (titleWhite: string, titleGray: string, hint: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Promethist</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:#0a0c10;background:oklch(14.326% 0.00567 246.516);color:#fff;
font-family:'Figtree',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;
display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative}
.glow{position:absolute;top:-210px;left:50%;transform:translateX(-50%);width:780px;height:692px;
filter:blur(100px);opacity:.8;pointer-events:none;
background:url('${config.webUrl}/assets/images/orb.png') center/contain no-repeat}
.brand{display:flex;align-items:flex-start;gap:16px;z-index:2;margin-bottom:46px}
.brand svg{height:58px;width:auto}.brand h4{margin:0;padding-top:9px;font-weight:300;font-size:1.5rem}
.content{z-index:2;text-align:center;padding:0 24px}
.title{font-size:32px;line-height:110%;font-weight:600;margin:0}
.sub{font-size:32px;line-height:120%;font-weight:600;margin:-4px 0 0;color:#58585C}
.hint{margin-top:24px;font-size:14px;font-weight:400;color:#a0a3ab}
</style></head>
<body>
<div class="glow"></div>
<div class="brand">
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="87" viewBox="0 0 72 87" fill="none">
<path opacity="0.8" d="M25.1074 15.0664C26.5246 15.0664 27.9111 15.1836 29.2641 15.4095C41.6804 16.9314 50.7888 27.8216 50.0916 40.3114L49.8662 44.35C47.8771 56.2286 37.5496 65.2813 25.1074 65.2813C22.5855 65.2813 20.1501 64.9075 17.8542 64.2156V77.6955C17.8542 82.6249 13.8565 86.6226 8.92709 86.6226C3.99766 86.6226 0 82.6249 0 77.6955V39.1974C0 38.712 0.039056 38.235 0.114378 37.7691C1.32511 25.0313 12.0516 15.0664 25.1074 15.0664Z" fill="white"/>
<circle opacity="0.6" cx="46.0313" cy="25.1074" r="25.1074" fill="white"/>
</svg>
<h4>promethist</h4>
</div>
<div class="content"><p class="title">${titleWhite}</p><p class="sub">${titleGray}</p><p class="hint">${hint}</p></div>
<script>try{history.replaceState(null,'',location.pathname)}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},1200)</script>
</body></html>`;

function releaseIfIdle(): void {
  if (localStates.size === 0) server?.unref(); // this process has nothing pending → let it exit normally
}

/**
 * Start the persistent loopback listener once (at server startup). It answers the /cli/connect
 * redirect at http://127.0.0.1:<port>/cb, validates the state against the on-disk pending set, and
 * hands the session cookie to `onSession`. Idempotent. If the port is already bound (another plugin
 * instance), this no-ops and that instance answers the callback (both read the same session file).
 */
export function startCallbackListener(onSession: (cookie: string) => void): void {
  onSessionCb = onSession;
  if (server) return;
  const s = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${LOOPBACK_PORT}`);
    if (u.pathname !== "/cb") {
      res.writeHead(404);
      res.end();
      return;
    }
    const state = u.searchParams.get("state") ?? "";
    const session = u.searchParams.get("session") ?? "";
    const store = readPending();
    const ok = !!session && !!state && store[state] !== undefined && store[state] > Date.now();
    if (!ok) {
      res.writeHead(400, { "content-type": "text/html" });
      res.end(page("Login failed", "Please try again", "You can close this tab and retry."));
      return;
    }
    delete store[state];
    writePending(store);
    localStates.delete(state);
    try {
      onSessionCb?.(`${COOKIE_NAME}=${session}`);
    } catch {
      /* caching is handled downstream */
    }
    releaseIfIdle();
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page("Connected", "to Promethist", "You can close this tab and return to Claude."));
  });
  s.on("error", () => {
    /* EADDRINUSE: another plugin instance owns the port and will answer the callback — fine. */
  });
  s.listen(LOOPBACK_PORT, "127.0.0.1", () => s.unref()); // idle (does not hold the process) until a login is pending
  server = s;
}

/** Register a pending login and return the /cli/connect URL to open. Non-blocking. */
export function beginLoginUrl(): string {
  const state = crypto.randomBytes(16).toString("hex");
  const expiry = Date.now() + 600_000; // 10-min window to finish signing in
  const store = readPending();
  store[state] = expiry;
  writePending(store);
  localStates.add(state);
  server?.ref(); // keep the process alive through the browser round-trip
  setTimeout(() => {
    localStates.delete(state);
    const s2 = readPending();
    if (s2[state]) {
      delete s2[state];
      writePending(s2);
    }
    releaseIfIdle();
  }, 600_000).unref();
  const redirectUri = `http://127.0.0.1:${LOOPBACK_PORT}/cb`;
  const url = `${config.webUrl}/cli/connect?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  console.error(`[promethist] Log in: ${url}`);
  openBrowser(url); // best-effort auto-open; the URL is printed regardless
  return url;
}
