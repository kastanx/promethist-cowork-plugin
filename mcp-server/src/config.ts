import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Find the mcp-server package root (the dir containing package.json) by walking up
// from this module — works whether we run from src/ (tsx) or dist/src/ (compiled node).
function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

// Load optional local env files from the package root (both gitignored).
// Secrets (the cookie/token) belong here or in the real environment — never committed.
const root = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

/**
 * Auth options (in priority order):
 *   PROMETHIST_TOKEN   — a raw Keycloak access token (JWT). Direct, but expires ~30 min.
 *   PROMETHIST_COOKIE  — the `authjs.session-token` cookie from the logged-in web app.
 *                        Exchanged at {webUrl}/api/auth/session for a fresh access token,
 *                        and auto-refreshed. Recommended.
 *
 * URLs:
 *   PROMETHIST_BASE_URL — backend (/api/v1).  local http://localhost:9310 |
 *                         preview https://preview.eu.promethist.ai | prod https://eu.promethist.ai
 *   PROMETHIST_WEB_URL  — Next.js app (/api/auth/session). Defaults to BASE_URL
 *                         (same host on preview/prod). Set for local (http://localhost:3000).
 */
const baseUrl = (process.env.PROMETHIST_BASE_URL || "http://localhost:9310").replace(/\/+$/, "");

export const config = {
  baseUrl,
  webUrl: (process.env.PROMETHIST_WEB_URL || process.env.PROMETHIST_BASE_URL || baseUrl).replace(/\/+$/, ""),
  token: process.env.PROMETHIST_TOKEN || "",
  cookie: process.env.PROMETHIST_COOKIE || "",
};
