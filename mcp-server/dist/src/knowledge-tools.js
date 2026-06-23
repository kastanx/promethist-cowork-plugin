import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";
// Ports the in-app KnowledgeTools — the portable (web/URL + metadata) paths.
// File upload is multipart/UI-only (a remote server has no local file), and there is no
// raw-text ingest endpoint, so those stay GAPs. analyse_knowledge is Claude-native:
// call get_knowledge to read the chunks and judge quality yourself.
/** URL ingest endpoints stream Flux<ProgressInformation> (NDJSON); summarise the final line. */
function summariseIngest(r) {
    if (!r.ok)
        return toTool(r);
    const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let last = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            last = JSON.parse(lines[i]);
            break;
        }
        catch {
            // keep scanning upward for the last valid JSON line
        }
    }
    if (last && (last.stage || last.ref)) {
        const failed = last.stage === "Failed";
        const refPart = last.ref ? `, ref=${last.ref}` : "";
        const usePart = !failed && last.ref ? ` Reference it from an agent with @knowledge:${last.ref};` : "";
        const msgPart = last.message ? ` (${last.message})` : "";
        return textTool(`Web knowledge ingestion ${last.stage ?? "done"}${refPart}.${usePart}${msgPart}`, failed);
    }
    return { content: [{ type: "text", text }] };
}
export function registerKnowledgeTools(server) {
    const enc = encodeURIComponent;
    const base = (pid) => `/api/v1/project/${enc(pid)}`;
    server.registerTool("list_knowledge", {
        title: "List knowledge",
        description: "List a project's knowledge sources (url/file/static), with their metadata. " +
            "GET /api/v1/project/{projectId}/knowledgeSpecifications. Read get_guide('knowledge') for how RAG works here.",
        inputSchema: { project_id: z.string().describe("Project ID (from list_tenants).") },
    }, async ({ project_id }) => toTool(await apiGet(`${base(project_id)}/knowledgeSpecifications`)));
    server.registerTool("get_knowledge_spec", {
        title: "Get knowledge metadata",
        description: "Get one knowledge source's metadata (name, type, isGlobal, topK, similarity, language). " +
            "GET /api/v1/project/{projectId}/knowledgeSpecification/{ref}.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            ref: z.string().describe("Knowledge ref (from list_knowledge)."),
        },
    }, async ({ project_id, ref }) => toTool(await apiGet(`${base(project_id)}/knowledgeSpecification/${enc(ref)}`)));
    server.registerTool("get_knowledge", {
        title: "Get knowledge content",
        description: "Get a knowledge source's full content and chunks (the text an agent retrieves via RAG). Use this to " +
            "review/analyse knowledge quality yourself (no separate analyse tool exists). " +
            "GET /api/v1/project/{projectId}/knowledge/{ref}.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            ref: z.string().describe("Knowledge ref."),
        },
    }, async ({ project_id, ref }) => toTool(await apiGet(`${base(project_id)}/knowledge/${enc(ref)}`)));
    server.registerTool("add_web_knowledge", {
        title: "Add web knowledge",
        description: "Ingest a single PUBLIC web page as a knowledge source (no crawling; not for login-protected/app-like " +
            "pages). Returns streamed progress; the final ref is what you reference from an agent via @knowledge:<ref>;. " +
            "POST /api/v1/project/{projectId}/knowledgeSpecifications/url.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            url: z.string().describe("Public HTML page URL (single page only)."),
            name: z.string().describe("Display name shown in the knowledge list."),
            description: z.string().optional(),
            is_global: z
                .boolean()
                .optional()
                .describe("Available to all agents (default true). Non-global is unused until @knowledge-referenced."),
            live: z.boolean().optional().describe("true = fetch live each use; false (default) = scrape once and store."),
        },
    }, async (a) => {
        const body = {
            url: a.url,
            name: a.name,
            description: a.description ?? "",
            isGlobal: a.is_global ?? true,
            live: a.live ?? false,
        };
        return summariseIngest(await apiRequest("POST", `${base(a.project_id)}/knowledgeSpecifications/url`, body));
    });
    server.registerTool("refresh_web_knowledge", {
        title: "Refresh web knowledge",
        description: "Re-scrape an existing URL knowledge source. Full-object body — pass url/name (and flags) to avoid resetting " +
            "them. PUT /api/v1/project/{projectId}/knowledgeSpecifications/url/{ref}.",
        inputSchema: {
            project_id: z.string(),
            ref: z.string().describe("Ref of the URL knowledge to re-scrape."),
            url: z.string().describe("URL to (re)scrape."),
            name: z.string().describe("Display name."),
            description: z.string().optional(),
            is_global: z.boolean().optional(),
            live: z.boolean().optional(),
        },
    }, async (a) => {
        const body = {
            url: a.url,
            name: a.name,
            description: a.description ?? "",
            isGlobal: a.is_global ?? true,
            live: a.live ?? false,
        };
        return summariseIngest(await apiRequest("PUT", `${base(a.project_id)}/knowledgeSpecifications/url/${enc(a.ref)}`, body));
    });
    server.registerTool("edit_knowledge", {
        title: "Edit knowledge metadata",
        description: "Edit a knowledge source's metadata (name/description/global). Read-modify-write — preserves " +
            "topK/similarity/language. Metadata only (does NOT re-ingest content). " +
            "PUT /api/v1/project/{projectId}/knowledgeSpecification/{ref}.",
        inputSchema: {
            project_id: z.string(),
            ref: z.string(),
            name: z.string().optional().describe("New display name."),
            description: z.string().optional(),
            is_global: z.boolean().optional(),
        },
    }, async (a) => {
        const got = await apiGet(`${base(a.project_id)}/knowledgeSpecification/${enc(a.ref)}`);
        if (!got.ok)
            return toTool(got);
        const d = got.data;
        const body = {
            name: a.name ?? d.name,
            description: a.description ?? d.description ?? "",
            topK: d.topK ?? 5,
            similarity: d.similarity ?? 0.6,
            language: d.language ?? "en",
            isGlobal: a.is_global ?? d.isGlobal ?? true,
        };
        return toTool(await apiRequest("PUT", `${base(a.project_id)}/knowledgeSpecification/${enc(a.ref)}`, body));
    });
    server.registerTool("delete_knowledge", {
        title: "Delete knowledge",
        description: "Permanently delete a knowledge source and all its content. Irreversible — requires confirm:true. " +
            "DELETE /api/v1/project/{projectId}/knowledgeSpecification/{ref}.",
        inputSchema: {
            project_id: z.string(),
            ref: z.string(),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async (a) => {
        const g = confirmGuard(a.confirm, `Will permanently DELETE knowledge "${a.ref}" and all its content.`);
        if (g)
            return g;
        const r = await apiRequest("DELETE", `${base(a.project_id)}/knowledgeSpecification/${enc(a.ref)}`);
        return r.ok ? textTool(`Deleted knowledge "${a.ref}".`) : toTool(r);
    });
}
