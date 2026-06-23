import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool } from "./tool-result.js";
// Ports the in-app analytics + billing reads. ALL READ-ONLY — no confirmGuard.
// Billing payment mutations (Stripe portal/checkout sessions, webhooks) are DELIBERATELY NOT
// exposed: an AI tool must never move money or change a plan. Those stay in the web app.
// Dates are ISO-8601 date-time WITH offset (e.g. 2026-06-01T00:00:00Z); the REST API has no
// "7d"/"30d" shorthand — Claude must expand relative windows into concrete from/to instants.
const enc = encodeURIComponent;
function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
        if (v !== undefined && v !== "")
            sp.append(k, String(v));
    const s = sp.toString();
    return s ? `?${s}` : "";
}
// Shared analytics filter params (snake_case → camelCase query keys).
const FILTER = {
    agent_ref: z.string().optional().describe("Filter to one agent (ref)."),
    agent_revision: z.number().optional().describe("Filter to a specific agent revision."),
    from: z.string().optional().describe("Window start, ISO-8601 date-time (e.g. 2026-06-01T00:00:00Z). Expand relative windows yourself."),
    to: z.string().optional().describe("Window end, ISO-8601 date-time."),
    user_id: z.string().optional().describe("Filter to one end-user."),
};
const STATE = { agent_state: z.enum(["Draft", "Preview", "Published"]).optional().describe("Filter by agent state.") };
function filterQs(a, withState = false) {
    return qs({
        agentRef: a.agent_ref,
        agentRevision: a.agent_revision,
        from: a.from,
        to: a.to,
        userId: a.user_id,
        ...(withState ? { agentState: a.agent_state } : {}),
    });
}
export function registerAnalyticsTools(server) {
    const aBase = (pid) => `/api/v1/project/${enc(pid)}/analytics`;
    const tBase = (tid) => `/api/v1/tenant/${enc(tid)}`;
    // ---- analytics (reads) -----------------------------------------------------
    server.registerTool("get_conversation_analytics", {
        title: "Conversation analytics",
        description: "Session & conversation counts for a project (total sessions + change %, conversations where the user spoke, " +
            "long 5+-turn conversations, lifetime totals). GET /api/v1/project/{id}/analytics/conversations. " +
            "Read get_guide('analytics').",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/conversations${filterQs(a)}`)));
    server.registerTool("get_usage_analytics", {
        title: "Usage analytics (minutes)",
        description: "Conversation length / usage: total & average length (in SECONDS — divide by 60 for minutes) + change %, " +
            "average turn count, lifetime variants. The conversational-minute usage signal. " +
            "GET /api/v1/project/{id}/analytics/conversations/length.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/conversations/length${filterQs(a)}`)));
    server.registerTool("get_user_analytics", {
        title: "User analytics",
        description: "Active-user metrics: MAU/WAU/DAU (+ change %), unique users for the period, lifetime. " +
            "GET /api/v1/project/{id}/analytics/users.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/users${filterQs(a)}`)));
    server.registerTool("get_relational_analytics", {
        title: "Relational analytics (judge scores)",
        description: "LLM-judge relational + business scores: userEngagement, userEmpowerment, taskCompletion, " +
            "interactionStyleMatching, buildRelationship, businessFulfilmentRate, businessProcessAdherence. This is the " +
            "closest satisfaction/quality signal (there is no NPS). GET /api/v1/project/{id}/analytics/relational.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/relational${filterQs(a)}`)));
    server.registerTool("get_multimodal_analytics", {
        title: "Multimodal analytics",
        description: "Per interactive-content element: how often it was shown/executed, parameter counts, action counts. " +
            "GET /api/v1/project/{id}/analytics/multimodal.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER, ...STATE },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/multimodal${filterQs(a, true)}`)));
    server.registerTool("get_evaluation_analytics", {
        title: "Evaluation analytics",
        description: "Aggregated evaluation results across sessions: booleans (pass/fail counts), numbers (avg/min/max), texts " +
            "(samples), textLists (category histograms). GET /api/v1/project/{id}/analytics/evaluations.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER, ...STATE },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/evaluations${filterQs(a, true)}`)));
    server.registerTool("get_extractor_analytics", {
        title: "Extractor analytics",
        description: "Per custom-extractor trends over time. NOTE: this endpoint is a POST that performs a READ (returns 201, does " +
            "NOT mutate anything). POST /api/v1/project/{id}/analytics/extractors.",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER, ...STATE },
    }, async (a) => toTool(await apiRequest("POST", `${aBase(a.project_id)}/extractors${filterQs(a, true)}`)));
    server.registerTool("list_analytics_users", {
        title: "List analytics users",
        description: "Paged list of end-users seen in a project (keyset paging — pass the returned nextOffset back as offset). " +
            "GET /api/v1/project/{id}/analytics/users/list.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            query: z.string().optional().describe("Search string."),
            offset: z.number().optional().describe("Keyset offset (default 0)."),
            limit: z.number().optional().describe("Page size 1–500 (default 200)."),
        },
    }, async (a) => toTool(await apiGet(`${aBase(a.project_id)}/users/list${qs({ query: a.query, offset: a.offset, limit: a.limit })}`)));
    server.registerTool("get_analytics_summary", {
        title: "Analytics summary",
        description: "One-shot 'how is my agent doing' snapshot — fans out to conversation, usage, user, relational, multimodal, " +
            "and evaluation analytics in parallel and merges them (per-section error if one fails). Call this first, then " +
            "drill into the specific tools. Read get_guide('analytics').",
        inputSchema: { project_id: z.string().describe("Project ID."), ...FILTER, ...STATE },
    }, async (a) => {
        const q = filterQs(a);
        const qSt = filterQs(a, true);
        const base = aBase(a.project_id);
        const sections = {
            conversations: `${base}/conversations${q}`,
            usage: `${base}/conversations/length${q}`,
            users: `${base}/users${q}`,
            relational: `${base}/relational${q}`,
            multimodal: `${base}/multimodal${qSt}`,
            evaluations: `${base}/evaluations${qSt}`,
        };
        const keys = Object.keys(sections);
        const results = await Promise.all(keys.map((k) => apiGet(sections[k])));
        const out = {};
        keys.forEach((k, i) => {
            const r = results[i];
            out[k] = r.ok ? r.data : { error: r.error, status: r.status };
        });
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    });
    server.registerTool("export_analytics", {
        title: "Export analytics",
        description: "Export per-session analytics for a window. Use format='json' to read it in context (xlsx/csv come back as " +
            "raw text — those are for the user to download in the web app). May 403 if the account's 'Display full " +
            "conversation data' privacy toggle is off (surface that to the user). GET /api/v1/project/{id}/analytics/export.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            format: z.enum(["json", "csv", "xlsx"]).describe("Prefer 'json' to read in context."),
            from: z.string().describe("Window start, ISO-8601 date-time (required)."),
            to: z.string().describe("Window end, ISO-8601 date-time (required, must be after from)."),
            agent_ref: z.string().optional(),
            agent_revision: z.number().optional(),
            user_id: z.string().optional(),
            agent_name: z.string().optional().describe("Display label only."),
            user_label: z.string().optional().describe("Display label only."),
        },
    }, async (a) => {
        if (new Date(a.to).getTime() <= new Date(a.from).getTime())
            return textTool("`to` must be after `from`.", true);
        const q = qs({
            format: a.format,
            agentRef: a.agent_ref,
            agentRevision: a.agent_revision,
            userId: a.user_id,
            from: a.from,
            to: a.to,
            agentName: a.agent_name,
            userLabel: a.user_label,
        });
        return toTool(await apiGet(`${aBase(a.project_id)}/export${q}`));
    });
    // ---- billing (READ-ONLY) ---------------------------------------------------
    server.registerTool("get_subscription", {
        title: "Get subscription",
        description: "Get a tenant's subscription { id, status (active/past_due/canceled), description (plan) }. Read-only. " +
            "GET /api/v1/tenant/{id}/subscription. Read get_guide('billing').",
        inputSchema: { tenant_id: z.string().describe("Tenant ID.") },
    }, async ({ tenant_id }) => toTool(await apiGet(`${tBase(tenant_id)}/subscription`)));
    server.registerTool("get_subscription_by_project", {
        title: "Get subscription (by project)",
        description: "Subscription resolved from a project → its tenant. GET /api/v1/project/{id}/subscription.",
        inputSchema: { project_id: z.string().describe("Project ID.") },
    }, async ({ project_id }) => toTool(await apiGet(`/api/v1/project/${enc(project_id)}/subscription`)));
    server.registerTool("get_subscription_by_agent", {
        title: "Get subscription (by agent)",
        description: "Subscription resolved from an agent → project → tenant. GET /api/v1/agent/{id}/subscription.",
        inputSchema: { agent_id: z.string().describe("Agent ID.") },
    }, async ({ agent_id }) => toTool(await apiGet(`/api/v1/agent/${enc(agent_id)}/subscription`)));
    server.registerTool("list_invoices", {
        title: "List invoices",
        description: "List a tenant's invoices { id, status, total (in the currency's MINOR unit — divide by 100), currency, " +
            "created, invoicePdf, hostedInvoiceUrl }. The invoice links are read-only views. Page with starting_after = " +
            "the last invoice id. GET /api/v1/tenant/{id}/invoices.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            first: z.number().optional().describe("Page size (default 100)."),
            starting_after: z.string().optional().describe("Stripe cursor — pass the last invoice id to page."),
        },
    }, async (a) => toTool(await apiGet(`${tBase(a.tenant_id)}/invoices${qs({ first: a.first, startingAfter: a.starting_after })}`)));
    server.registerTool("get_usage", {
        title: "Get billing usage",
        description: "Per-day conversation count and MINUTES (the conversational-minute billing unit) for a window. Both from & to " +
            "are required (no default window). GET /api/v1/tenant/{id}/usage. Read get_guide('billing').",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            from: z.string().describe("Window start, ISO-8601 date-time (required)."),
            to: z.string().describe("Window end, ISO-8601 date-time (required)."),
        },
    }, async (a) => {
        if (!a.from || !a.to)
            return textTool("get_usage requires from and to (ISO-8601 date-times).", true);
        return toTool(await apiGet(`${tBase(a.tenant_id)}/usage${qs({ from: a.from, to: a.to })}`));
    });
}
