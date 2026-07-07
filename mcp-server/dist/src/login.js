import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { config } from "./config.js";
const COOKIE_NAME = "authjs.session-token";
function openBrowser(url) {
    try {
        if (process.platform === "win32") {
            // WINDOWS: `cmd /c start "" <url>` treats `&` in the URL as a command separator and truncates
            // it — dropping the `&state=` param, so the callback fails the state check ("Login failed").
            // PowerShell Start-Process with a single-quoted literal opens the default browser with the
            // full URL intact. (Windows PowerShell 5.1 ships with every Windows and is on PATH.)
            const safe = url.replace(/'/g, "''"); // PowerShell single-quote escape
            spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${safe}'`], {
                stdio: "ignore",
                detached: true,
            }).unref();
        }
        else {
            // macOS `open` / Linux `xdg-open` pass the URL as one argv element — `&` is safe.
            const cmd = process.platform === "darwin" ? "open" : "xdg-open";
            spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
        }
    }
    catch {
        // If we can't open a browser, the user can still copy the URL from stderr.
    }
}
// Matches the Promethist /login page: dark theme, white orb logo + "promethist"
// wordmark (Figtree), 32px headline (white + #58585C second line), blurred orb glow.
const page = (titleWhite, titleGray, hint) => `<!doctype html>
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
/**
 * Open the browser to the web app's /cli/connect handoff, run a one-shot loopback listener,
 * and resolve with the session cookie string ("authjs.session-token=...") once the app
 * redirects back. Rejects on timeout.
 */
export function loginViaBrowser(timeoutMs = 180_000, onAuthUrl) {
    const state = crypto.randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const u = new URL(req.url ?? "/", "http://127.0.0.1");
            if (u.pathname !== "/cb") {
                res.writeHead(404);
                res.end();
                return;
            }
            const stateOk = u.searchParams.get("state") === state;
            const session = u.searchParams.get("session");
            if (!stateOk || !session) {
                res.writeHead(400, { "content-type": "text/html" });
                res.end(page("Login failed", "Please try again", "You can close this tab and retry."));
                return;
            }
            res.writeHead(200, { "content-type": "text/html" });
            res.end(page("Connected", "to Promethist", "You can close this tab and return to Claude."));
            clearTimeout(timer);
            server.close();
            resolve(`${COOKIE_NAME}=${session}`);
        });
        const timer = setTimeout(() => {
            server.close();
            reject(new Error("Browser login timed out."));
        }, timeoutMs);
        server.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            const redirectUri = `http://127.0.0.1:${port}/cb`;
            const url = `${config.webUrl}/cli/connect?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
            console.error(`[promethist] Opening browser to log in:\n  ${url}`);
            // onAuthUrl is a test hook: when provided, drive the URL instead of opening a browser.
            if (onAuthUrl)
                onAuthUrl(url);
            else
                openBrowser(url);
        });
    });
}
