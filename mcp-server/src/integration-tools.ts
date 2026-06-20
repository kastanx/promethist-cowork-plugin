import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";

// Ports the in-app IntegrationTools. Four kinds in different collections:
//   pre / post  = webhookSpecifications (hook = PRE_SESSION / POST_SESSION)
//   during      = mcpServerSpecifications (an MCP server the agent calls)
//   connector   = mcpConnectorSpecifications (a catalog connector, enable + tool subset)
// CREATE/EDIT route the kind via the PATH SEGMENT; DELETE routes via the ?type= query param.
// MCP-server empty tool list = ALL tools; connector empty tool list = NO usable tools (opposite!).

const TRANSPORTS = ["SSE", "StreamableHttp"] as const;
const HEADER_SCHEMA = z
  .array(z.object({ name: z.string(), value: z.string() }))
  .optional()
  .describe("Request headers as [{name, value}].");

/** Map a during-row's toolSpecifications (full specs or names on read) back to plain names. */
function toolNamesOf(row: Record<string, any>): string[] {
  return ((row?.toolSpecifications ?? []) as any[]).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
}

export function registerIntegrationTools(server: McpServer) {
  const enc = encodeURIComponent;
  const base = (pid: string) => `/api/v1/project/${enc(pid)}`;

  server.registerTool(
    "list_integrations",
    {
      title: "List integrations",
      description:
        "List a project's integrations grouped by kind: { pre, during (MCP servers), post, connector }. Each row has " +
        "a `ref` and `type`. GET /api/v1/project/{projectId}/integrations. Read get_guide('integration').",
      inputSchema: { project_id: z.string().describe("Project ID (from list_tenants).") },
    },
    async ({ project_id }) => toTool(await apiGet(`${base(project_id)}/integrations`)),
  );

  server.registerTool(
    "create_pre_integration",
    {
      title: "Create pre-session webhook",
      description:
        "Add a PRE-session webhook (runs before a conversation; can inject context the LLM sees). " +
        "POST /api/v1/project/{projectId}/integrations/pre.",
      inputSchema: {
        project_id: z.string(),
        name: z.string(),
        url: z.string().describe("Webhook URL."),
        method: z.string().optional().describe("HTTP method (default POST)."),
        headers: HEADER_SCHEMA,
        enabled: z.boolean().optional(),
        llm_description: z.string().optional().describe("Description of the returned value exposed to the LLM."),
        default_value: z.string().optional().describe("Default value if the webhook fails."),
        timeout: z.number().optional().describe("ms (default 5000)."),
        retries: z.number().optional().describe("Retry count (default 0)."),
      },
    },
    async (a) => {
      const body = {
        name: a.name,
        method: a.method ?? "POST",
        headers: a.headers ?? [],
        url: a.url,
        hook: "PRE_SESSION",
        enabled: a.enabled ?? true,
        ref: null,
        llmDescription: a.llm_description ?? "",
        default: a.default_value ?? "",
        timeout: a.timeout ?? 5000,
        retries: a.retries ?? 0,
      };
      return toTool(await apiRequest("POST", `${base(a.project_id)}/integrations/pre`, body));
    },
  );

  server.registerTool(
    "create_post_integration",
    {
      title: "Create post-session webhook",
      description:
        "Add a POST-session webhook (runs after a conversation ends; e.g. to deliver a transcript/result). " +
        "POST /api/v1/project/{projectId}/integrations/post.",
      inputSchema: {
        project_id: z.string(),
        name: z.string(),
        url: z.string().describe("Webhook URL."),
        method: z.string().optional().describe("HTTP method (default POST)."),
        headers: HEADER_SCHEMA,
        enabled: z.boolean().optional(),
        timeout: z.number().optional(),
        retries: z.number().optional(),
      },
    },
    async (a) => {
      const body = {
        name: a.name,
        method: a.method ?? "POST",
        headers: a.headers ?? [],
        url: a.url,
        hook: "POST_SESSION",
        enabled: a.enabled ?? true,
        ref: null,
        timeout: a.timeout ?? 5000,
        retries: a.retries ?? 0,
      };
      return toTool(await apiRequest("POST", `${base(a.project_id)}/integrations/post`, body));
    },
  );

  server.registerTool(
    "create_mcp_integration",
    {
      title: "Add MCP server integration",
      description:
        "Add an MCP server the agent can call mid-conversation (kind = during). Use load_mcp_tools first to discover " +
        "tool names. EMPTY tool_names = expose ALL tools. POST /api/v1/project/{projectId}/integrations/during.",
      inputSchema: {
        project_id: z.string(),
        name: z.string(),
        url: z.string().describe("MCP server URL (https://…)."),
        transport_type: z.enum(TRANSPORTS).describe("SSE | StreamableHttp."),
        auth_header_name: z.string().optional().describe("e.g. Authorization."),
        auth_header_value: z.string().optional().describe("e.g. Bearer <token>."),
        tool_names: z.array(z.string()).optional().describe("Tool NAMES to expose (from load_mcp_tools). Empty = ALL."),
        is_global: z.boolean().optional().describe("Default true. Non-global tools need @mcp:{ref}_{tool}; references."),
      },
    },
    async (a) => {
      const body = {
        name: a.name,
        url: a.url,
        authHeaderName: a.auth_header_name ?? null,
        authHeaderValue: a.auth_header_value ?? null,
        transportType: a.transport_type,
        toolSpecifications: a.tool_names ?? [],
        isGlobal: a.is_global ?? null,
      };
      return toTool(await apiRequest("POST", `${base(a.project_id)}/integrations/during`, body));
    },
  );

  server.registerTool(
    "edit_integration",
    {
      title: "Edit integration (pre/during/post)",
      description:
        "Edit a pre/during/post integration. Full-replace PUT — read-modify-write preserves untouched fields. `kind` " +
        "MUST equal the row's `type`. (Connectors use update_connector.) PUT /api/v1/project/{projectId}/integrations/{kind}?ref={ref}.",
      inputSchema: {
        project_id: z.string(),
        kind: z.enum(["pre", "during", "post"]).describe("Must equal the row's type from list_integrations."),
        ref: z.string(),
        name: z.string().optional(),
        url: z.string().optional(),
        method: z.string().optional(),
        headers: HEADER_SCHEMA,
        enabled: z.boolean().optional(),
        llm_description: z.string().optional(),
        default_value: z.string().optional(),
        timeout: z.number().optional(),
        retries: z.number().optional(),
        transport_type: z.enum(TRANSPORTS).optional(),
        auth_header_name: z.string().optional(),
        auth_header_value: z.string().optional(),
        tool_names: z.array(z.string()).optional(),
        is_global: z.boolean().optional(),
      },
    },
    async (a) => {
      const got = await apiGet(`${base(a.project_id)}/integrations`);
      if (!got.ok) return toTool(got);
      const lists = got.data as Record<string, any>;
      const ex = ((lists[a.kind] ?? []) as Array<Record<string, any>>).find((x) => x.ref === a.ref);
      if (!ex) return textTool(`No "${a.kind}" integration with ref "${a.ref}".`, true);

      let body: Record<string, any>;
      if (a.kind === "during") {
        body = {
          name: a.name ?? ex.name,
          url: a.url ?? ex.url,
          authHeaderName: a.auth_header_name ?? ex.authHeaderName ?? null,
          authHeaderValue: a.auth_header_value ?? ex.authHeaderValue ?? null,
          transportType: a.transport_type ?? ex.transportType,
          toolSpecifications: a.tool_names ?? toolNamesOf(ex),
          isGlobal: a.is_global ?? ex.isGlobal ?? null,
        };
      } else {
        body = {
          name: a.name ?? ex.name,
          method: a.method ?? ex.method ?? "POST",
          headers: a.headers ?? ex.headers ?? [],
          url: a.url ?? ex.url,
          hook: a.kind === "pre" ? "PRE_SESSION" : "POST_SESSION",
          enabled: a.enabled ?? ex.enabled ?? true,
          ref: a.ref,
          timeout: a.timeout ?? ex.timeout ?? 5000,
          retries: a.retries ?? ex.retries ?? 0,
        };
        if (a.kind === "pre") {
          body.llmDescription = a.llm_description ?? ex.llmDescription ?? "";
          body.default = a.default_value ?? ex.default ?? "";
        }
      }
      return toTool(await apiRequest("PUT", `${base(a.project_id)}/integrations/${enc(a.kind)}?ref=${enc(a.ref)}`, body));
    },
  );

  server.registerTool(
    "delete_integration",
    {
      title: "Delete integration",
      description:
        "Delete an integration of any kind. `type` is the kind selector (a wrong value deletes nothing). Irreversible — " +
        "requires confirm:true. DELETE /api/v1/project/{projectId}/integrations?type={type}&ref={ref}.",
      inputSchema: {
        project_id: z.string(),
        type: z.enum(["pre", "during", "post", "connector"]).describe("Kind — MUST equal the row's type."),
        ref: z.string(),
        confirm: z.boolean().optional().describe("Must be true to execute."),
      },
    },
    async (a) => {
      const g = confirmGuard(a.confirm, `Will permanently DELETE the "${a.type}" integration "${a.ref}".`);
      if (g) return g;
      const r = await apiRequest("DELETE", `${base(a.project_id)}/integrations?type=${enc(a.type)}&ref=${enc(a.ref)}`);
      return r.ok ? textTool(`Deleted ${a.type} integration "${a.ref}".`) : toTool(r);
    },
  );

  server.registerTool(
    "list_connectors",
    {
      title: "List MCP connectors",
      description:
        "List the project's MCP connector catalog + enable state: each { ref, name, description, toolSpecifications, " +
        "enabled, selectedTools, isGlobal }. GET /api/v1/project/{projectId}/integrations/connectors.",
      inputSchema: { project_id: z.string().describe("Project ID.") },
    },
    async ({ project_id }) => toTool(await apiGet(`${base(project_id)}/integrations/connectors`)),
  );

  server.registerTool(
    "enable_connector",
    {
      title: "Enable MCP connector",
      description:
        "Enable a catalog connector with a chosen tool subset. `ref` must match a catalog ref exactly. EMPTY tool_names " +
        "= no usable tools (opposite of an MCP server). POST /api/v1/project/{projectId}/integrations/connector.",
      inputSchema: {
        project_id: z.string(),
        ref: z.string().describe("Catalog connector ref (byte-for-byte from list_connectors)."),
        tool_names: z.array(z.string()).optional().describe("Tool NAMES to enable. Empty = none usable."),
        is_global: z.boolean().optional().describe("Default true. Non-global tools need @mcp:{ref}_{tool}; references."),
      },
    },
    async (a) =>
      toTool(
        await apiRequest("POST", `${base(a.project_id)}/integrations/connector`, {
          ref: a.ref,
          toolSpecifications: a.tool_names ?? [],
          isGlobal: a.is_global ?? null,
        }),
      ),
  );

  server.registerTool(
    "update_connector",
    {
      title: "Update MCP connector tool selection",
      description:
        "Update an enabled connector's tool subset / global flag. FULL REPLACE — pass the COMPLETE desired tool_names " +
        "(read current via list_connectors.selectedTools first). PUT /api/v1/project/{projectId}/integrations/connector?ref={ref}.",
      inputSchema: {
        project_id: z.string(),
        ref: z.string(),
        tool_names: z.array(z.string()).describe("Complete desired tool-name set (full replace)."),
        is_global: z.boolean().optional(),
      },
    },
    async (a) =>
      toTool(
        await apiRequest("PUT", `${base(a.project_id)}/integrations/connector?ref=${enc(a.ref)}`, {
          ref: a.ref,
          toolSpecifications: a.tool_names,
          isGlobal: a.is_global ?? null,
        }),
      ),
  );

  server.registerTool(
    "delete_connector",
    {
      title: "Disable/delete MCP connector",
      description:
        "Disable a connector (delete IS disable — there is no separate disable). Irreversible — requires confirm:true. " +
        "DELETE /api/v1/project/{projectId}/integrations?type=connector&ref={ref}.",
      inputSchema: {
        project_id: z.string(),
        ref: z.string(),
        confirm: z.boolean().optional().describe("Must be true to execute."),
      },
    },
    async (a) => {
      const g = confirmGuard(a.confirm, `Will DISABLE/DELETE connector "${a.ref}" (the only way to disable it).`);
      if (g) return g;
      const r = await apiRequest("DELETE", `${base(a.project_id)}/integrations?type=connector&ref=${enc(a.ref)}`);
      return r.ok ? textTool(`Disabled connector "${a.ref}".`) : toTool(r);
    },
  );

  server.registerTool(
    "load_mcp_tools",
    {
      title: "Probe an MCP server's tools",
      description:
        "Live-probe an MCP server URL and return its tool specifications (use the names for create_mcp_integration / " +
        "edit_integration). Not project-scoped. GET /api/v1/integration/mcp/load-tools.",
      inputSchema: {
        url: z.string().describe("MCP server URL."),
        transport_type: z.enum(TRANSPORTS).describe("SSE | StreamableHttp."),
        auth_header_name: z.string().optional(),
        auth_header_value: z.string().optional(),
      },
    },
    async (a) => {
      const q = new URLSearchParams({ url: a.url, transportType: a.transport_type });
      if (a.auth_header_name) q.set("authHeaderName", a.auth_header_name);
      if (a.auth_header_value) q.set("authHeaderValue", a.auth_header_value);
      return toTool(await apiGet(`/api/v1/integration/mcp/load-tools?${q.toString()}`));
    },
  );
}
