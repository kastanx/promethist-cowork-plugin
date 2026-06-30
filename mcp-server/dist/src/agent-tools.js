import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";
import { fetchVisualsBundle, projectCatalog } from "./visuals.js";
import { readGuide, GUIDE_TOPICS } from "./guides.js";
import { agentUrl } from "./links.js";
// Ported from the in-app AgentDetailTools (copilot). Read tools + the guarded
// state-transition writes; the copilot's LLM-internal tools (editAgent's NL diff,
// checkAgentQuality) collapse into Claude itself reasoning over these data tools.
export function registerAgentTools(server) {
    // ---- guidance --------------------------------------------------------------
    server.registerTool("get_guide", {
        title: "Get Promethist guide",
        description: "Load detailed Promethist reference guidance on demand (the in-app copilot's authoring playbook). " +
            "Topics: 'authoring' — how to write each agent field (identity, purpose, business process, guardrails) " +
            "with rules and good/bad examples; 'domain' — how Promethist works per area " +
            "(agents/projects/voices/visuals/locales/knowledge/evaluations/integrations/multimodal); 'quality' — the " +
            "agent quality-review rubric; 'evaluation' — evaluations & output data elements (insights); 'knowledge' — " +
            "knowledge bases (RAG); 'multimodal' — interactive content; 'integration' — integrations & MCP connectors; " +
            "'workspace' — accounts/projects/members & roles; 'analytics' — metrics/usage; 'billing' — " +
            "subscription/usage/invoices (read-only). ALWAYS read 'authoring' before writing/editing agent fields, " +
            "'quality' before reviewing/publishing, and the matching guide before working in that area.",
        inputSchema: {
            topic: z.enum(GUIDE_TOPICS).describe("Which guide to load: authoring | domain | quality."),
        },
    }, async ({ topic }) => {
        const md = readGuide(topic);
        return md
            ? { content: [{ type: "text", text: md }] }
            : textTool(`Unknown guide "${topic}". Available: ${GUIDE_TOPICS.join(", ")}.`, true);
    });
    // ---- reads -----------------------------------------------------------------
    server.registerTool("get_agent", {
        title: "Get agent",
        description: "Get full detail of an agent by its UUID (name, title, description, state, kind, purpose, " +
            "identityDescription, businessProcessSteps, guardrails, initialPlan, businessImpact, locales, gender, " +
            "visualProperties, realtimeConfigurationId, evaluationDefinitionIds, ref, revision, ...). Read this before " +
            "editing, to review agent quality, or to resolve an agent's `ref`. GET /api/v1/agents/{id}.",
        inputSchema: { agent_id: z.string().describe("Agent UUID.") },
    }, async ({ agent_id }) => {
        const r = await apiGet(`/api/v1/agents/${encodeURIComponent(agent_id)}`);
        if (r.ok && r.data && typeof r.data === "object") {
            const a = r.data;
            const tid = a.project?.tenant?.id;
            const pid = a.project?.id;
            if (tid && pid && a.id)
                a.webUrl = agentUrl(tid, pid, a.id);
        }
        return toTool(r);
    });
    server.registerTool("list_agents", {
        title: "List agents",
        description: "List the latest revision of each agent in a project (id, ref, name, state, ...). Use to find an agent's " +
            "UUID/ref by name. GET /api/v1/project/{projectId}/agents/latest.",
        inputSchema: {
            project_id: z.string().describe("Project ID (from list_tenants)."),
            include_archived: z.boolean().optional().describe("Include archived agents. Default false."),
        },
    }, async ({ project_id, include_archived }) => {
        const r = await apiGet(`/api/v1/project/${encodeURIComponent(project_id)}/agents/latest?includeArchived=${include_archived ? "true" : "false"}`);
        if (r.ok && Array.isArray(r.data)) {
            const proj = await apiGet(`/api/v1/project/${encodeURIComponent(project_id)}`);
            const tid = proj.ok && proj.data && typeof proj.data === "object" ? proj.data.tenantId : undefined;
            if (tid)
                for (const row of r.data)
                    if (row?.id)
                        row.webUrl = agentUrl(tid, project_id, row.id);
        }
        return toTool(r);
    });
    server.registerTool("get_agent_revisions", {
        title: "Get agent revisions",
        description: "List all revisions of an agent (newest first) with revision number, state " +
            "(Draft/Preview/Published/Archived), and last-modified. Call before revert/publish. " +
            "GET /api/v1/agents/{ref}/revisions. NOTE: the path uses the agent REF (slug), not the UUID — pass " +
            "agent_ref, or pass agent_id and it is resolved to a ref first.",
        inputSchema: {
            agent_ref: z.string().optional().describe("Agent ref (slug). Stable across revisions."),
            agent_id: z.string().optional().describe("Agent UUID; used to resolve the ref if agent_ref is omitted."),
        },
    }, async ({ agent_ref, agent_id }) => {
        let ref = agent_ref;
        if (!ref) {
            if (!agent_id)
                return textTool("Provide agent_ref or agent_id.", true);
            const got = await apiGet(`/api/v1/agents/${encodeURIComponent(agent_id)}`);
            if (!got.ok)
                return toTool(got);
            ref = got.data.ref;
            if (!ref)
                return textTool("Could not resolve ref from agent_id.", true);
        }
        return toTool(await apiGet(`/api/v1/agents/${encodeURIComponent(ref)}/revisions`));
    });
    server.registerTool("get_voices", {
        title: "Get voices",
        description: "List available voice / realtime configurations (id, ref, title, description, gender, locales, " +
            "type/provider). The `id` is what an agent's realtimeConfigurationId is set to — wire a voice via edit_agent. " +
            "GET /api/v1/realtime-configurations.",
        inputSchema: {},
    }, async () => toTool(await apiGet("/api/v1/realtime-configurations")));
    server.registerTool("get_visuals", {
        title: "Get visuals",
        description: 'List available avatars and environments (the visual catalog). Pass an item\'s avatarRef / ' +
            'environmentRef value (the bare ref, e.g. "bwon" / "livingroom" — NOT the display name) into ' +
            "edit_agent's avatar_ref / environment_ref. An avatar needs an environment too for the visual to render. " +
            "Sourced from the public Promethist asset bundle.",
        inputSchema: {
            type: z.enum(["avatar", "environment"]).optional().describe("Filter to one kind. Default: both."),
        },
    }, async ({ type }) => {
        try {
            const bundle = await fetchVisualsBundle();
            return { content: [{ type: "text", text: JSON.stringify(projectCatalog(bundle, type), null, 2) }] };
        }
        catch (e) {
            return textTool(`Failed to fetch visuals bundle: ${e.message}`, true);
        }
    });
    server.registerTool("list_templates", {
        title: "List agent templates",
        description: "List published agent templates (catalog): id, ref, name, title, description, kind, variables, and the " +
            "purpose/businessProcessSteps/guardrails presets. Use to clone/seed a new agent or guide an edit. " +
            "GET /api/v1/templates.",
        inputSchema: {},
    }, async () => toTool(await apiGet("/api/v1/templates")));
    // ---- guarded writes (state transitions) ------------------------------------
    server.registerTool("revert_agent", {
        title: "Revert agent",
        description: "Revert an agent to a previous revision. Call get_agent_revisions first. The server only allows reverting " +
            "back to the most recent Preview/Published revision (older targets are rejected). Guarded: requires " +
            "confirm=true. POST /api/v1/agents/{id}/revert?revision=N.",
        inputSchema: {
            agent_id: z.string().describe("Agent UUID."),
            revision: z.number().int().describe("Revision number to revert to."),
            confirm: z.boolean().optional().describe("Must be true to execute. Surface the action to the user first."),
        },
    }, async ({ agent_id, revision, confirm }) => {
        const g = confirmGuard(confirm, `Will revert agent ${agent_id} to revision ${revision} (discards newer changes).`);
        if (g)
            return g;
        return toTool(await apiRequest("POST", `/api/v1/agents/${encodeURIComponent(agent_id)}/revert?revision=${revision}`));
    });
    server.registerTool("promote_agent_to_preview", {
        title: "Promote agent to Preview",
        description: "Promote a Draft agent to Preview (available to internal testers). Only valid from Draft — check state via " +
            "get_agent / get_agent_revisions first. Guarded: requires confirm=true. POST /api/v1/agents/{id}/preview.",
        inputSchema: {
            agent_id: z.string().describe("Agent UUID (must be in Draft)."),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async ({ agent_id, confirm }) => {
        const g = confirmGuard(confirm, `Will promote agent ${agent_id} from Draft to Preview.`);
        if (g)
            return g;
        return toTool(await apiRequest("POST", `/api/v1/agents/${encodeURIComponent(agent_id)}/preview`));
    });
    server.registerTool("promote_agent_to_published", {
        title: "Promote agent to Published",
        description: "Publish an agent revision — makes it LIVE for all end users. Only valid from Preview (promote to Preview " +
            "first if it's a Draft). Guarded: requires confirm=true. POST /api/v1/agents/{id}/publish.",
        inputSchema: {
            agent_id: z.string().describe("Agent UUID (must be in Preview)."),
            confirm: z.boolean().optional().describe("Must be true to execute. This goes live for end users."),
        },
    }, async ({ agent_id, confirm }) => {
        const g = confirmGuard(confirm, `Will PUBLISH agent ${agent_id} — live for all end users.`);
        if (g)
            return g;
        return toTool(await apiRequest("POST", `/api/v1/agents/${encodeURIComponent(agent_id)}/publish`));
    });
}
