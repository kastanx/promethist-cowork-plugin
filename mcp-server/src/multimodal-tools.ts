import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";

// Ports the in-app MultimodalTools ("Interactive Content" shown during a voice call).
// Write DTO discriminator = `type` (capitalized) + a nested object keyed by the lowercased
// type. READ DTO discriminator = `__typename` (different field). Edits are full-replace PUTs
// (read-modify-write). Image/video BINARY upload is multipart/UI-only (GAP) — image/video by URL works.

const MM_TYPES = ["input", "webpage", "image", "video", "choice", "handover"] as const;
const INPUT_FIELD_TYPES = ["Text", "Number", "Email", "Date"] as const;
const TYPE_NAME: Record<string, string> = {
  input: "Input",
  webpage: "Webpage",
  image: "Image",
  video: "Video",
  choice: "Choice",
  handover: "Handover",
};

/** Build the nested type object (merging passed params over an existing read-row for edits). */
function buildNested(t: string, a: Record<string, any>, ex?: Record<string, any>) {
  const v = (param: string, exKey: string) => (a[param] !== undefined ? a[param] : ex?.[exKey]);
  const nested: Record<string, any> = {};
  const setIf = (k: string, val: any) => {
    if (val !== undefined) nested[k] = val;
  };
  setIf("name", v("name", "name"));
  setIf("title", v("title", "title"));
  setIf("toolDescription", v("tool_description", "toolDescription"));
  setIf("isGlobal", v("is_global", "isGlobal"));
  if (t === "input") {
    setIf("description", v("description", "description"));
    nested.type = v("input_field_type", "type") ?? "Text";
  } else if (t === "webpage" || t === "image" || t === "video") {
    setIf("url", v("url", "url"));
  } else if (t === "choice") {
    setIf("description", v("description", "description"));
    nested.options = v("options", "options") ?? [];
  } else if (t === "handover") {
    nested.toolDescription = v("tool_description", "toolDescription") ?? null;
    nested.key = v("agent_key", "key") ?? null;
    nested.showAsDetail = v("show_as_detail", "showAsDetail") ?? false;
  }
  return nested;
}

const fieldSchema = {
  title: z.string().optional().describe("Display title shown to the user (defaults to name)."),
  tool_description: z.string().optional().describe("When/how the interaction fires. REQUIRED for handover."),
  description: z.string().optional().describe("Content description (input & choice)."),
  url: z.string().optional().describe("Asset/page URL (webpage/image/video). Never invent a URL."),
  input_field_type: z.enum(INPUT_FIELD_TYPES).optional().describe("input only: Text|Number|Email|Date (default Text)."),
  options: z
    .array(z.object({ title: z.string(), description: z.string().optional(), imageUrl: z.string().optional() }))
    .optional()
    .describe("choice only: [{title, description?, imageUrl?}]."),
  agent_key: z
    .string()
    .optional()
    .describe("handover only: published-agent key <agentRef>.<revision> (NOT a raw agentId; resolve via get_agent_revisions)."),
  show_as_detail: z.boolean().optional().describe("handover only: show target agent card first (default false)."),
  is_global: z.boolean().optional().describe("Available to all agents (default true). Non-global needs @multimodal:ref;."),
};

export function registerMultimodalTools(server: McpServer) {
  const enc = encodeURIComponent;
  const base = (pid: string) => `/api/v1/project/${enc(pid)}`;

  server.registerTool(
    "list_multimodal_interactions",
    {
      title: "List multimodal interactions",
      description:
        "List a project's interactive content (input/webpage/image/video/choice/handover). Each row's type is in " +
        "`__typename`. GET /api/v1/project/{projectId}/multimodal-interactions. Read get_guide('multimodal').",
      inputSchema: { project_id: z.string().describe("Project ID (from list_tenants).") },
    },
    async ({ project_id }) => toTool(await apiGet(`${base(project_id)}/multimodal-interactions`)),
  );

  server.registerTool(
    "get_multimodal_interaction",
    {
      title: "Get multimodal interaction",
      description:
        "Get one multimodal interaction by ref (client-side filter over the list — there is no single-ref endpoint).",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        ref: z.string().describe("Interaction ref (from list_multimodal_interactions)."),
      },
    },
    async ({ project_id, ref }) => {
      const got = await apiGet(`${base(project_id)}/multimodal-interactions`);
      if (!got.ok) return toTool(got);
      const row = ((got.data as Array<Record<string, any>>) ?? []).find((x) => x.ref === ref);
      return row
        ? { content: [{ type: "text" as const, text: JSON.stringify(row, null, 2) }] }
        : textTool(`No multimodal interaction with ref "${ref}".`, true);
    },
  );

  server.registerTool(
    "create_multimodal_interaction",
    {
      title: "Create multimodal interaction",
      description:
        "Create an interactive-content element. `type` picks the shape (input/webpage/image/video/choice/handover). " +
        "image/video are by URL here (binary upload is UI-only). For handover, agent_key is <agentRef>.<revision> of a " +
        "PUBLISHED agent. POST /api/v1/project/{projectId}/multimodal-interactions.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        type: z.enum(MM_TYPES).describe("input | webpage | image | video | choice | handover."),
        name: z.string().describe("Internal name (required, non-blank). The server derives the ref from it."),
        ...fieldSchema,
      },
    },
    async (a) => {
      if (!a.name || !a.name.trim()) return textTool("name must not be blank.", true);
      if (a.type === "handover" && (a.tool_description === undefined || !a.tool_description.trim()))
        return textTool("tool_description is required for a handover interaction.", true);
      const body = { type: TYPE_NAME[a.type], [a.type]: buildNested(a.type, a) };
      const r = await apiRequest("POST", `${base(a.project_id)}/multimodal-interactions`, body);
      if (!r.ok) return toTool(r);
      const out = toTool(r);
      if (a.type === "handover" && !a.agent_key) {
        out.content.push({
          type: "text" as const,
          text: "\nNote: created without a target — set agent_key (<agentRef>.<revision> of a published agent) via edit_multimodal_interaction.",
        });
      }
      return out;
    },
  );

  server.registerTool(
    "edit_multimodal_interaction",
    {
      title: "Edit multimodal interaction",
      description:
        "Edit an interaction. Full-replace PUT — read-modify-write preserves untouched fields. `type` must equal the " +
        "row's existing __typename (lowercased). Changing `name` re-derives the ref (prefer editing `title` to rename). " +
        "PUT /api/v1/project/{projectId}/multimodal-interactions/{ref}.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        ref: z.string().describe("Interaction ref."),
        type: z.enum(MM_TYPES).describe("Must equal the existing interaction's type (__typename lowercased)."),
        name: z.string().optional().describe("Internal name (changing it re-derives the ref)."),
        ...fieldSchema,
      },
    },
    async (a) => {
      const got = await apiGet(`${base(a.project_id)}/multimodal-interactions`);
      if (!got.ok) return toTool(got);
      const ex = ((got.data as Array<Record<string, any>>) ?? []).find((x) => x.ref === a.ref);
      if (!ex) return textTool(`No multimodal interaction with ref "${a.ref}".`, true);
      const existingType = String(ex.__typename ?? "").toLowerCase();
      const t = existingType || a.type; // the stored type wins — the nested key must match it
      const body = { type: TYPE_NAME[t] ?? TYPE_NAME[a.type], [t]: buildNested(t, a, ex) };
      return toTool(await apiRequest("PUT", `${base(a.project_id)}/multimodal-interactions/${enc(a.ref)}`, body));
    },
  );

  server.registerTool(
    "delete_multimodal_interaction",
    {
      title: "Delete multimodal interaction",
      description:
        "Permanently delete an interactive-content element. Irreversible — requires confirm:true. " +
        "DELETE /api/v1/project/{projectId}/multimodal-interactions/{ref}.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        ref: z.string().describe("Interaction ref."),
        confirm: z.boolean().optional().describe("Must be true to execute."),
      },
    },
    async (a) => {
      const g = confirmGuard(a.confirm, `Will permanently DELETE multimodal interaction "${a.ref}".`);
      if (g) return g;
      const r = await apiRequest("DELETE", `${base(a.project_id)}/multimodal-interactions/${enc(a.ref)}`);
      return r.ok ? textTool(`Deleted multimodal interaction "${a.ref}".`) : toTool(r);
    },
  );
}
