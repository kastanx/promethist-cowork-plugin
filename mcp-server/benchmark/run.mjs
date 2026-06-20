// Promethist plugin capability benchmark.
// Drives the built MCP server through end-to-end scenarios for every tool area and prints a
// PASS/FAIL scorecard. Run from the mcp-server dir (so the SDK + dist resolve):
//
//   cd mcp-server && npm run build
//   PROMETHIST_COOKIE='authjs.session-token=...' BENCH_PROJECT_ID='<proj>' BENCH_TENANT_ID='<tenant>' \
//     node benchmark/run.mjs        (or: npm run bench)
//
// It cleans up everything it creates (agents are archived via REST — no archive tool yet) and never
// creates tenants/projects (those can't be deleted). Destructive steps are also checked for the
// confirm:true gate.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

function fromEnvFile(key) {
  for (const f of [".env.local", ".env.example", ".env"]) {
    try {
      const line = fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith(key + "="));
      if (line) return line.slice(key.length + 1);
    } catch {
      /* next */
    }
  }
  return "";
}

const COOKIE = process.env.PROMETHIST_COOKIE || fromEnvFile("PROMETHIST_COOKIE");
const BASE = (process.env.PROMETHIST_BASE_URL || fromEnvFile("PROMETHIST_BASE_URL") || "https://preview.eu.promethist.ai").replace(/\/+$/, "");
const PROJECT = process.env.BENCH_PROJECT_ID || "";
const TENANT = process.env.BENCH_TENANT_ID || "";
const TS = Date.now().toString(36).slice(-5);
const TAG = `BENCH-${TS}`;

if (!COOKIE) { console.error("Set PROMETHIST_COOKIE (a fresh logged-in session cookie)."); process.exit(2); }
if (!PROJECT) { console.error("Set BENCH_PROJECT_ID (a throwaway project id to test in)."); process.exit(2); }

const results = [];
function check(group, label, cond, detail = "") {
  results.push({ group, label, pass: !!cond, detail });
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${group} — ${label}${!cond && detail ? "  «" + String(detail).slice(0, 120) + "»" : ""}`);
}

const env = {};
for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
env.PROMETHIST_COOKIE = COOKIE;
env.PROMETHIST_BASE_URL = BASE;
env.PROMETHIST_NO_BROWSER = "1"; // never pop a browser mid-benchmark

const client = new Client({ name: "promethist-bench", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/src/index.js"], env }));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).map((c) => c.text || "").join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  return { isError: !!r.isError, text, parsed };
}
async function token() {
  try { return (await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: COOKIE } })).json()).accessToken || ""; } catch { return ""; }
}

// preflight
const pre = await call("list_tenants");
if (pre.isError) {
  console.error("\nPreflight failed (list_tenants errored): " + pre.text.slice(0, 200));
  console.error("Your cookie is likely expired — set a FRESH PROMETHIST_COOKIE.");
  await client.close();
  process.exit(2);
}
const TOKEN = await token();
console.log(`Connected. Project=${PROJECT}  Tenant=${TENANT || "(unset)"}  tag=${TAG}\n`);

async function group(title, fn) {
  console.log(title);
  try { await fn(); } catch (e) { check(title, "unexpected exception", false, e.message); }
}

// ---------------------------------------------------------------- AGENTS
await group("agents", async () => {
  const c = await call("create_agent", { projectId: PROJECT, name: `${TAG} Coach`, description: "bench agent", purpose: "practice negotiation" });
  check("agents", "create_agent", !c.isError && c.parsed?.id, c.text);
  const agentId = c.parsed?.id;
  if (!agentId) return;
  try {
    check("agents", "get_agent", !(await call("get_agent", { agent_id: agentId })).isError);
    await call("edit_agent", { agentId, purpose: `UPDATED ${TAG}` });
    await call("edit_agent", { agentId, identityDescription: `Persona ${TAG}` });
    const g2 = (await call("get_agent", { agent_id: agentId })).parsed;
    check("agents", "edits STACK (latest revision)", g2?.purpose?.includes("UPDATED") && g2?.identityDescription?.includes("Persona"), `purpose=${(g2?.purpose || "").slice(0, 24)}`);
    await call("edit_agent", { agentId, avatar_ref: "crea", environment_ref: "livingroom", camera_preset: "Static" });
    const g3 = (await call("get_agent", { agent_id: agentId })).parsed;
    check("agents", "avatar persists in visualProperties", g3?.visualProperties?.avatarRef === "crea", JSON.stringify(g3?.visualProperties));
    const voices = (await call("get_voices")).parsed;
    const vid = Array.isArray(voices) ? voices[0]?.id : undefined;
    if (vid) check("agents", "edit_agent set voice", !(await call("edit_agent", { agentId, realtime_configuration_id: vid })).isError);
    const rev = (await call("get_agent_revisions", { agent_id: agentId })).parsed;
    check("agents", "get_agent_revisions (stacked ≥2)", Array.isArray(rev) && rev.length >= 2, `revs=${rev?.length}`);
  } finally {
    if (TOKEN) try { await fetch(`${BASE}/api/v1/agents/${agentId}/archive-all`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }); } catch { /* */ }
  }
});

// ------------------------------------------------------------ EVALUATIONS
await group("evals", async () => {
  let evalId = (await call("create_evaluation", { project_id: PROJECT, name: `${TAG} quality`, description: "bench" })).parsed?.evaluation?.id;
  if (!evalId) {
    const l = (await call("list_evaluations", { project_id: PROJECT })).parsed || [];
    evalId = l.find((e) => e.evaluation?.name === `${TAG} quality`)?.evaluation?.id;
  }
  check("evals", "create_evaluation", !!evalId);
  if (!evalId) return;
  try {
    check("evals", "add_insight(Bool)", !(await call("add_insight", { project_id: PROJECT, evaluation_id: evalId, type: "Bool", name: "Resolved?", description: "resolved", prompt: "Was it resolved?", true_text: "Yes", false_text: "No" })).isError);
    check("evals", "add_insight(Number)", !(await call("add_insight", { project_id: PROJECT, evaluation_id: evalId, type: "Number", name: "Helpfulness", description: "score", prompt: "Rate helpfulness", min_value: 0, max_value: 10 })).isError);
    let ins = (await call("get_evaluation", { project_id: PROJECT, evaluation_id: evalId })).parsed?.insights || [];
    check("evals", "2 insights present", ins.length === 2, `n=${ins.length}`);
    if (ins[0]?.ref) check("evals", "edit_insight", !(await call("edit_insight", { project_id: PROJECT, evaluation_id: evalId, insight_ref: ins[0].ref, description: `edited ${TAG}` })).isError);
    ins = (await call("get_evaluation", { project_id: PROJECT, evaluation_id: evalId })).parsed?.insights || []; // refs regenerate
    check("evals", "remove_insight refused w/o confirm", (await call("remove_insight", { project_id: PROJECT, evaluation_id: evalId, insight_ref: ins[0]?.ref })).isError);
    if (ins[0]?.ref) await call("remove_insight", { project_id: PROJECT, evaluation_id: evalId, insight_ref: ins[0].ref, confirm: true });
    check("evals", "insight removed (now 1)", ((await call("get_evaluation", { project_id: PROJECT, evaluation_id: evalId })).parsed?.insights || []).length === 1);
    await call("edit_evaluation", { project_id: PROJECT, evaluation_id: evalId, description: `edited eval ${TAG}` });
    check("evals", "edit_evaluation preserves insights", ((await call("get_evaluation", { project_id: PROJECT, evaluation_id: evalId })).parsed?.insights || []).length === 1);
    check("evals", "delete refused w/o confirm", (await call("delete_evaluation", { project_id: PROJECT, evaluation_id: evalId })).isError);
  } finally {
    await call("delete_evaluation", { project_id: PROJECT, evaluation_id: evalId, confirm: true });
  }
});

// -------------------------------------------------------------- KNOWLEDGE
await group("knowledge", async () => {
  const c = await call("add_web_knowledge", { project_id: PROJECT, url: "https://example.com", name: `${TAG} KB` });
  check("knowledge", "add_web_knowledge (ingest)", !c.isError, c.text);
  const row = ((await call("list_knowledge", { project_id: PROJECT })).parsed || []).find((k) => k.name === `${TAG} KB`);
  check("knowledge", "list_knowledge shows it", !!row?.ref);
  if (!row?.ref) return;
  try {
    check("knowledge", "get_knowledge_spec", !(await call("get_knowledge_spec", { project_id: PROJECT, ref: row.ref })).isError);
    check("knowledge", "edit_knowledge (rename)", !(await call("edit_knowledge", { project_id: PROJECT, ref: row.ref, name: `${TAG} KB v2` })).isError);
    check("knowledge", "delete refused w/o confirm", (await call("delete_knowledge", { project_id: PROJECT, ref: row.ref })).isError);
  } finally {
    await call("delete_knowledge", { project_id: PROJECT, ref: row.ref, confirm: true });
  }
});

// ------------------------------------------------------------- MULTIMODAL
await group("multimodal", async () => {
  const c = await call("create_multimodal_interaction", { project_id: PROJECT, type: "webpage", name: `${TAG} Page`, url: "https://example.com" });
  check("multimodal", "create webpage interaction", !c.isError, c.text);
  const row = ((await call("list_multimodal_interactions", { project_id: PROJECT })).parsed || []).find((m) => m.name === `${TAG} Page`);
  check("multimodal", "list shows it", !!row?.ref);
  if (!row?.ref) return;
  try {
    check("multimodal", "edit (full-replace RMW)", !(await call("edit_multimodal_interaction", { project_id: PROJECT, ref: row.ref, type: "webpage", title: `${TAG} Page v2` })).isError);
  } finally {
    await call("delete_multimodal_interaction", { project_id: PROJECT, ref: row.ref, confirm: true });
  }
});

// ------------------------------------------------------------ INTEGRATIONS
await group("integration", async () => {
  const li = await call("list_integrations", { project_id: PROJECT });
  check("integration", "list_integrations", !li.isError && li.parsed && ("pre" in li.parsed || "during" in li.parsed || "connector" in li.parsed));
  check("integration", "list_connectors", Array.isArray((await call("list_connectors", { project_id: PROJECT })).parsed));
  const c = await call("create_pre_integration", { project_id: PROJECT, name: `${TAG} hook`, url: "https://example.com" });
  check("integration", "create_pre_integration", !c.isError, c.text);
  const row = ((await call("list_integrations", { project_id: PROJECT })).parsed?.pre || []).find((x) => x.name === `${TAG} hook`);
  check("integration", "webhook appears in pre[]", !!row?.ref);
  if (!row?.ref) return;
  try {
    check("integration", "delete refused w/o confirm", (await call("delete_integration", { project_id: PROJECT, type: "pre", ref: row.ref })).isError);
  } finally {
    await call("delete_integration", { project_id: PROJECT, type: "pre", ref: row.ref, confirm: true });
  }
});

// -------------------------------------------------------------- WORKSPACE
await group("workspace", async () => {
  check("workspace", "get_project_context (role)", !!(await call("get_project_context", { project_id: PROJECT })).parsed?.userRole);
  if (!TENANT) {
    console.log("  (member/invite checks skipped — set BENCH_TENANT_ID)");
    return;
  }
  check("workspace", "get_tenant_context (role)", !!(await call("get_tenant_context", { tenant_id: TENANT })).parsed?.userRole);
  check("workspace", "list_projects includes test project", ((await call("list_projects", { tenant_id: TENANT })).parsed || []).some((p) => p.id === PROJECT));
  const tm = await call("list_tenant_members", { tenant_id: TENANT });
  check("workspace", "list_tenant_members (needs owner)", !tm.isError && Array.isArray(tm.parsed), tm.text);
  const email = `bench-${TS}@example.com`;
  const inv = await call("invite_members_to_tenant", { tenant_id: TENANT, emails: [email], role: "Viewer" });
  check("workspace", "invite_members_to_tenant (needs owner)", !inv.isError, inv.text);
  const invRow = ((await call("list_tenant_invitations", { tenant_id: TENANT })).parsed || []).find((x) => x.email === email);
  check("workspace", "invitation appears", !!invRow?.id);
  if (invRow?.id) {
    check("workspace", "revoke refused w/o confirm", (await call("revoke_tenant_invitation", { tenant_id: TENANT, invitation_id: invRow.id })).isError);
    check("workspace", "revoke_tenant_invitation (confirm)", !(await call("revoke_tenant_invitation", { tenant_id: TENANT, invitation_id: invRow.id, confirm: true })).isError);
  }
});

await client.close();

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
const byGroup = {};
for (const r of results) {
  byGroup[r.group] ??= { p: 0, n: 0 };
  byGroup[r.group].n++;
  if (r.pass) byGroup[r.group].p++;
}
console.log(`\n==== SCORE: ${pass}/${results.length} checks passed ====`);
for (const [g, s] of Object.entries(byGroup)) console.log(`  ${g}: ${s.p}/${s.n}`);
if (fail) {
  console.log("\nFailures:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.group} / ${r.label}${r.detail ? " — " + String(r.detail).slice(0, 160) : ""}`));
}
process.exit(fail ? 1 : 0);
