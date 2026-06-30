#!/usr/bin/env -S npx tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { interactiveLogin, logout } from "./auth.js";
import { toTool } from "./tool-result.js";
import { registerAgentTools } from "./agent-tools.js";
import { registerEvaluationTools } from "./evaluation-tools.js";
import { registerKnowledgeTools } from "./knowledge-tools.js";
import { registerMultimodalTools } from "./multimodal-tools.js";
import { registerIntegrationTools } from "./integration-tools.js";
import { registerWorkspaceTools } from "./workspace-tools.js";
import { registerAnalyticsTools } from "./analytics-tools.js";
import { buildCompoundVisualRef, CAMERA_PRESETS } from "./visuals.js";
import { PROMETHIST_INSTRUCTIONS } from "./instructions.js";
import { config } from "./config.js";
import { tenantUrl, projectUrl, agentUrl } from "./links.js";
const server = new McpServer({ name: "promethist-platform", version: "0.1.0" }, { instructions: PROMETHIST_INSTRUCTIONS });
// ---- auth --------------------------------------------------------------------
server.registerTool("login", {
    title: "Log in to Promethist",
    description: "Open a browser to log in to Promethist via the web app and cache the session locally. " +
        "Run this once; afterwards every tool works and the session refreshes automatically. " +
        "Not needed if PROMETHIST_COOKIE or PROMETHIST_TOKEN is already set.",
    inputSchema: {},
}, async () => {
    try {
        const email = await interactiveLogin();
        return {
            content: [{ type: "text", text: `Logged in as ${email}. You can now use the other tools.` }],
        };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Login failed: ${e.message}` }], isError: true };
    }
});
server.registerTool("logout", {
    title: "Log out of Promethist",
    description: "Forget the cached Promethist session (deletes the local session cache and clears the in-memory " +
        "token) so the next tool call prompts a fresh browser login. Handy for re-testing the login flow.",
    inputSchema: {},
}, async () => {
    const r = logout();
    const msg = `Logged out${r.clearedFile ? " (cleared cached session)" : " (no cached session found)"}.` +
        (r.note ? ` ${r.note}` : "");
    return { content: [{ type: "text", text: msg }] };
});
// ---- read tools --------------------------------------------------------------
server.registerTool("list_tenants", {
    title: "List tenants",
    description: "List all tenants (accounts) the authenticated user can access, each with its projects " +
        "(id, name, description, logo). Takes no arguments — call this first to discover IDs. " +
        "Maps to GET /api/v1/tenants.",
    inputSchema: {},
}, async () => {
    const r = await apiGet("/api/v1/tenants");
    if (r.ok && Array.isArray(r.data)) {
        for (const t of r.data) {
            if (t?.id)
                t.webUrl = tenantUrl(t.id);
            if (Array.isArray(t?.projects))
                for (const p of t.projects)
                    if (p?.id)
                        p.webUrl = projectUrl(t.id, p.id);
        }
    }
    return toTool(r);
});
server.registerTool("get_project", {
    title: "Get project",
    description: "Get full details of a single project by its ID (use list_tenants to find IDs). " +
        "Maps to GET /api/v1/project/{projectId}.",
    inputSchema: {
        projectId: z.string().describe("The project ID (as returned by list_tenants)."),
    },
}, async ({ projectId }) => {
    const r = await apiGet(`/api/v1/project/${encodeURIComponent(projectId)}`);
    if (r.ok && r.data && typeof r.data === "object") {
        const p = r.data;
        if (p.tenantId && p.id)
            p.webUrl = projectUrl(p.tenantId, p.id);
    }
    return toTool(r);
});
// ---- write tools (agents) ----------------------------------------------------
const OPTIONAL_CONTENT = [
    "purpose",
    "identityDescription",
    "businessProcessSteps",
    "initialPlan",
    "guardrails",
];
server.registerTool("create_agent", {
    title: "Create agent",
    description: "Create a new (draft) conversational agent in a project. Only `projectId` and `name` are " +
        "required; title/description default to the name. The relational-content fields (purpose, " +
        "identityDescription, businessProcessSteps, initialPlan, guardrails) shape what the agent does. " +
        "Maps to POST /api/v1/project/{projectId}/agents. Requires editor role in the project.",
    inputSchema: {
        projectId: z.string().describe("Project ID to create the agent in (from list_tenants)."),
        name: z.string().describe("Agent name."),
        title: z.string().optional().describe("Display title. Defaults to name."),
        description: z.string().optional().describe("Short description. Defaults to title/name."),
        purpose: z.string().optional().describe("What the agent is for (relational 'purpose')."),
        identityDescription: z.string().optional().describe("The agent's identity / persona."),
        businessProcessSteps: z.string().optional().describe("Steps/process the agent should follow."),
        initialPlan: z.string().optional().describe("Initial plan / opening behavior."),
        guardrails: z.string().optional().describe("Guardrails / things the agent must not do."),
        kind: z.enum(["RELATIONAL", "LIGHTWEIGHT"]).optional().describe("Agent kind. Default RELATIONAL."),
        businessImpact: z.number().min(0).max(1).optional().describe("Business impact 0..1 (default 0.5)."),
    },
}, async (a) => {
    const body = {
        name: a.name,
        title: a.title ?? a.name,
        description: a.description ?? a.title ?? a.name,
        kind: a.kind ?? "RELATIONAL",
        businessImpact: a.businessImpact ?? 0.5,
    };
    for (const k of OPTIONAL_CONTENT)
        if (a[k] !== undefined)
            body[k] = a[k];
    const r = await apiRequest("POST", `/api/v1/project/${encodeURIComponent(a.projectId)}/agents`, body);
    if (r.ok && r.data && typeof r.data === "object") {
        const ag = r.data;
        const proj = await apiGet(`/api/v1/project/${encodeURIComponent(a.projectId)}`);
        const tid = proj.ok && proj.data && typeof proj.data === "object" ? proj.data.tenantId : undefined;
        if (tid && ag.id)
            ag.webUrl = agentUrl(tid, a.projectId, ag.id);
    }
    return toTool(r);
});
server.registerTool("edit_agent", {
    title: "Edit agent",
    description: "Edit an existing agent. Resolves the LATEST revision, applies ONLY the fields you pass on top of it, and " +
        "saves a new draft (edits STACK; untouched fields preserved). Covers behavior/text AND visuals, voice, structure. " +
        "For visuals, get refs from get_visuals and set BOTH avatar_ref and environment_ref (an avatar needs an " +
        "environment to render). Voice id from get_voices. Requires editor role.",
    inputSchema: {
        agentId: z.string().describe("ID of the agent to edit."),
        // behavior / text
        name: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        purpose: z.string().optional().describe("Replace the agent's purpose."),
        identityDescription: z.string().optional().describe("Replace the agent's identity/persona."),
        businessProcessSteps: z.string().optional().describe("Replace the business process steps (relational agents)."),
        initialPlan: z.string().optional(),
        guardrails: z.string().optional(),
        businessImpact: z.number().min(0).max(1).optional(),
        // visuals — refs come from get_visuals. NOTE: setting environment/camera WITHOUT an avatar won't persist:
        // the server drops visualProperties when avatarRef is null. Avatars apply to relational agents.
        avatar_ref: z.string().optional().describe("visualProperties.avatarRef (an avatar ref from get_visuals)."),
        environment_ref: z.string().optional().describe("visualProperties.environmentRef (from get_visuals)."),
        camera_preset: z.string().optional().describe("Camera preset: Dynamic, Smooth, or Static."),
        visual_ref: z.string().optional().describe("Top-level visualRef (thumbnail / lightweight-agent visual)."),
        // voice — id comes from get_voices
        realtime_configuration_id: z.string().optional().describe("realtimeConfigurationId (a voice id from get_voices)."),
        // other structural
        gender: z.string().optional().describe("Gender enum name (e.g. Male / Female)."),
        locales: z.array(z.string()).optional().describe('Language tags, e.g. ["en-US"].'),
        is_enabled: z.boolean().optional(),
        has_memory: z.boolean().optional().describe("Whether the agent keeps memory (toggles anonymousMode = !hasMemory)."),
        evaluation_definition_ids: z.array(z.string()).optional().describe("Evaluation definition IDs to attach."),
    },
}, async (a) => {
    // STACKING FIX: read+write the LATEST non-archived revision, not the (often published) id passed.
    // The backend chains a new Draft off the latest active revision; reading a stale id resets fields.
    const head = await apiGet(`/api/v1/agents/${encodeURIComponent(a.agentId)}`);
    if (!head.ok)
        return toTool(head);
    let d = head.data;
    let targetId = a.agentId;
    const ref = d.ref;
    if (ref) {
        const revs = await apiGet(`/api/v1/agents/${encodeURIComponent(ref)}/revisions`);
        if (revs.ok && Array.isArray(revs.data)) {
            // revisions are newest-first; the first non-archived one is the latest the FE would edit.
            const latest = revs.data.find((r) => r.state !== "Archived");
            if (latest?.id && latest.id !== a.agentId) {
                targetId = latest.id;
                const got = await apiGet(`/api/v1/agents/${encodeURIComponent(targetId)}`);
                if (got.ok)
                    d = got.data;
            }
        }
    }
    // VISUALS FIX: persist visualProperties with BARE refs (avatarRef never null, else the server drops
    // the whole block) AND the compound visualRef the backoffice reads, so the avatar actually shows.
    let visualProperties = d.visualProperties ?? null;
    let visualRef = a.visual_ref ?? d.visualRef ?? null;
    if (a.avatar_ref !== undefined || a.environment_ref !== undefined || a.camera_preset !== undefined) {
        const cameraPreset = a.camera_preset ?? d.visualProperties?.cameraPreset ?? null;
        if (cameraPreset != null && !CAMERA_PRESETS.includes(cameraPreset)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Invalid camera_preset "${cameraPreset}". Must be one of: ${CAMERA_PRESETS.join(", ")}.`,
                    },
                ],
                isError: true,
            };
        }
        const avatarRef = a.avatar_ref ?? d.visualProperties?.avatarRef ?? "orb";
        const environmentRef = a.environment_ref ?? d.visualProperties?.environmentRef ?? null;
        visualProperties = { avatarRef, environmentRef, cameraPreset };
        const compound = await buildCompoundVisualRef(avatarRef, environmentRef);
        if (compound)
            visualRef = compound;
    }
    // hasMemory and anonymousMode are coupled (anonymousMode = !hasMemory).
    const hasMemory = a.has_memory ?? d.hasMemory;
    const anonymousMode = a.has_memory !== undefined ? !a.has_memory : d.anonymousMode;
    // Full replace body off the LATEST revision: override only passed fields, echo the rest.
    const body = {
        id: d.id,
        ref: d.ref,
        name: a.name ?? d.name,
        title: a.title ?? d.title,
        description: a.description ?? d.description,
        kind: d.kind,
        locales: a.locales ?? d.locales,
        isEnabled: a.is_enabled ?? d.isEnabled,
        gender: a.gender ?? d.gender,
        thumbnail: d.thumbnail,
        visualRef,
        visualProperties,
        identityDescription: a.identityDescription ?? d.identityDescription,
        purpose: a.purpose ?? d.purpose,
        businessProcessSteps: a.businessProcessSteps ?? d.businessProcessSteps,
        guardrails: a.guardrails ?? d.guardrails,
        initialPlan: a.initialPlan ?? d.initialPlan,
        businessImpact: a.businessImpact ?? d.businessImpact ?? 0.5,
        anonymousMode,
        hasMemory,
        realtimeConfigurationId: a.realtime_configuration_id ?? d.realtimeConfigurationId,
        evaluationDefinitionIds: a.evaluation_definition_ids ?? d.evaluationDefinitionIds ?? [],
        templateRef: d.templateRef,
        templateVariables: d.templateVariables,
    };
    const r = await apiRequest("PUT", `/api/v1/agents/${encodeURIComponent(targetId)}`, body);
    if (r.ok && r.data && typeof r.data === "object") {
        const ag = r.data;
        const tid = d.project?.tenant?.id;
        const pid = d.project?.id;
        if (tid && pid && ag.id)
            ag.webUrl = agentUrl(tid, pid, ag.id);
    }
    return toTool(r);
});
registerAgentTools(server);
registerEvaluationTools(server);
registerKnowledgeTools(server);
registerMultimodalTools(server);
registerIntegrationTools(server);
registerWorkspaceTools(server);
registerAnalyticsTools(server);
async function main() {
    await server.connect(new StdioServerTransport());
    const mode = config.token ? "token" : config.cookie ? "cookie" : "NONE";
    // stdout is the protocol channel — only ever log to stderr.
    console.error(`[promethist] connected. api=${config.baseUrl} auth=${mode}`);
}
main().catch((e) => {
    console.error("[promethist] fatal:", e);
    process.exit(1);
});
