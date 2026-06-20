import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";

// Ports the in-app EvaluationTools. Evaluations have "insights" (output data elements).
// There is NO per-insight REST endpoint, so add/edit/remove insight are read-modify-write
// PUTs of the whole evaluation — and the PUT body's insight `type` is a DIFFERENT enum than
// the GET response, so every existing insight must be translated before re-sending.

const EXEC_MODES = ["ON_CONVERSATION_END", "PER_TURN"] as const;
const LOOKBACK = ["START_TO_NOW", "LAST_4"] as const;
const INSIGHT_TYPES = ["Bool", "Number", "Text", "TextList"] as const;

// GET-response insight type (output) -> PUT-body insight type (input).
const OUT_TO_IN: Record<string, string> = { boolean: "Bool", number: "Number", text: "Text", list: "TextList" };

/** Translate a GET-response insight into the PUT-body input shape (drops id/ref). */
function toInsightInput(o: Record<string, any>) {
  const t = OUT_TO_IN[o.type] ?? o.type;
  const base: Record<string, any> = { type: t, name: o.name, description: o.description, prompt: o.prompt };
  if (t === "Bool") {
    base.trueText = o.trueText ?? null;
    base.falseText = o.falseText ?? null;
  } else if (t === "Number") {
    base.minValue = o.minValue;
    base.maxValue = o.maxValue;
  } else if (t === "TextList") {
    base.values = o.values ?? [];
  }
  return base;
}

/** Pick the evaluation definition fields for the PUT/POST body (drops id/ref/etc.). */
function evalDefToInput(e: Record<string, any>) {
  return {
    name: e.name,
    description: e.description ?? null,
    prompt: e.prompt ?? null,
    executionModes: e.executionModes ?? ["ON_CONVERSATION_END"],
    lookbackWindow: e.lookbackWindow ?? null,
    sessionAgent: e.sessionAgent ?? false,
    injectIntoFeaturedAgent: e.injectIntoFeaturedAgent ?? false,
    userFacing: e.userFacing ?? false,
    adminFacing: e.adminFacing ?? true,
    webhookUrl: e.webhookUrl ?? null,
    webhookHeaders: e.webhookHeaders ?? null,
  };
}

type InsightParams = {
  name?: string;
  description?: string;
  prompt?: string;
  true_text?: string;
  false_text?: string;
  min_value?: number;
  max_value?: number;
  values?: string[];
};

function buildInsightInput(type: string, p: InsightParams) {
  const base: Record<string, any> = { type, name: p.name, description: p.description, prompt: p.prompt };
  if (type === "Bool") {
    base.trueText = p.true_text ?? null;
    base.falseText = p.false_text ?? null;
  } else if (type === "Number") {
    base.minValue = p.min_value;
    base.maxValue = p.max_value;
  } else if (type === "TextList") {
    base.values = p.values ?? [];
  }
  return base;
}

function validateInsightFields(type: string, p: InsightParams): string | null {
  if (type === "Number") {
    if (p.min_value === undefined || p.max_value === undefined) return "A Number insight requires min_value and max_value.";
    if (p.min_value > p.max_value) return "min_value must be <= max_value.";
  }
  if (type === "TextList" && (!Array.isArray(p.values) || p.values.length === 0)) {
    return "A TextList insight requires a non-empty values array.";
  }
  return null;
}

export function registerEvaluationTools(server: McpServer) {
  const enc = encodeURIComponent;
  const evalsPath = (pid: string) => `/api/v1/project/${enc(pid)}/evaluations`;
  const evalPath = (pid: string, eid: string) => `${evalsPath(pid)}/${enc(eid)}`;

  server.registerTool(
    "list_evaluations",
    {
      title: "List evaluations",
      description:
        "List a project's evaluations, each with its output data elements (insights) and attached agents. " +
        "GET /api/v1/project/{projectId}/evaluations. Read get_guide('evaluation') for how evaluations work.",
      inputSchema: { project_id: z.string().describe("Project ID (from list_tenants).") },
    },
    async ({ project_id }) => toTool(await apiGet(evalsPath(project_id))),
  );

  server.registerTool(
    "get_evaluation",
    {
      title: "Get evaluation",
      description:
        "Get one evaluation with its definition and insights (incl. each insight's ref). " +
        "GET /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        evaluation_id: z.string().describe("Evaluation ID (from list_evaluations)."),
      },
    },
    async ({ project_id, evaluation_id }) => toTool(await apiGet(evalPath(project_id, evaluation_id))),
  );

  server.registerTool(
    "create_evaluation",
    {
      title: "Create evaluation",
      description:
        "Create an evaluation (keep it to ONE topic). It starts with no insights — add them with add_insight " +
        "afterwards (mirrors the app). Read get_guide('evaluation') first. POST /api/v1/project/{projectId}/evaluations.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        name: z.string().describe("Evaluation name (one topic per evaluation)."),
        description: z.string().optional(),
        prompt: z.string().optional().describe("Top-level instruction for the evaluator LLM."),
        execution_modes: z
          .array(z.enum(EXEC_MODES))
          .optional()
          .describe("When it runs. Default [ON_CONVERSATION_END]. PER_TURN = per message."),
        lookback_window: z.enum(LOOKBACK).optional().describe("PER_TURN only (START_TO_NOW | LAST_4)."),
        session_agent: z.boolean().optional().describe("ON_CONVERSATION_END destination: inject into next session."),
        inject_into_featured_agent: z.boolean().optional(),
        user_facing: z.boolean().optional(),
        admin_facing: z.boolean().optional().describe("Show in admin analytics (default true)."),
        webhook_url: z.string().optional(),
        webhook_headers: z.record(z.string()).optional(),
      },
    },
    async (a) => {
      const evaluation: Record<string, any> = { name: a.name, adminFacing: a.admin_facing ?? true };
      if (a.description !== undefined) evaluation.description = a.description;
      if (a.prompt !== undefined) evaluation.prompt = a.prompt;
      if (a.execution_modes !== undefined) evaluation.executionModes = a.execution_modes;
      if (a.lookback_window !== undefined) evaluation.lookbackWindow = a.lookback_window;
      if (a.session_agent !== undefined) evaluation.sessionAgent = a.session_agent;
      if (a.inject_into_featured_agent !== undefined) evaluation.injectIntoFeaturedAgent = a.inject_into_featured_agent;
      if (a.user_facing !== undefined) evaluation.userFacing = a.user_facing;
      if (a.webhook_url !== undefined) evaluation.webhookUrl = a.webhook_url;
      if (a.webhook_headers !== undefined) evaluation.webhookHeaders = a.webhook_headers;
      return toTool(await apiRequest("POST", evalsPath(a.project_id), { evaluation, insights: [] }));
    },
  );

  server.registerTool(
    "edit_evaluation",
    {
      title: "Edit evaluation",
      description:
        "Edit an evaluation's DEFINITION (not its insights — use add/edit/remove_insight for those). " +
        "Read-modify-write: it re-sends the existing insights so they are preserved. NOTE: every save " +
        "regenerates insight refs. PUT /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string().describe("Project ID."),
        evaluation_id: z.string().describe("Evaluation ID."),
        name: z.string().optional(),
        description: z.string().optional(),
        prompt: z.string().optional(),
        execution_modes: z.array(z.enum(EXEC_MODES)).optional(),
        lookback_window: z.enum(LOOKBACK).optional(),
        session_agent: z.boolean().optional(),
        inject_into_featured_agent: z.boolean().optional(),
        user_facing: z.boolean().optional(),
        admin_facing: z.boolean().optional(),
        webhook_url: z.string().optional(),
        webhook_headers: z.record(z.string()).optional(),
      },
    },
    async (a) => {
      const got = await apiGet(evalPath(a.project_id, a.evaluation_id));
      if (!got.ok) return toTool(got);
      const d = got.data as Record<string, any>;
      const evaluation = evalDefToInput(d.evaluation ?? {});
      if (a.name !== undefined) evaluation.name = a.name;
      if (a.description !== undefined) evaluation.description = a.description;
      if (a.prompt !== undefined) evaluation.prompt = a.prompt;
      if (a.execution_modes !== undefined) evaluation.executionModes = a.execution_modes;
      if (a.lookback_window !== undefined) evaluation.lookbackWindow = a.lookback_window;
      if (a.session_agent !== undefined) evaluation.sessionAgent = a.session_agent;
      if (a.inject_into_featured_agent !== undefined) evaluation.injectIntoFeaturedAgent = a.inject_into_featured_agent;
      if (a.user_facing !== undefined) evaluation.userFacing = a.user_facing;
      if (a.admin_facing !== undefined) evaluation.adminFacing = a.admin_facing;
      if (a.webhook_url !== undefined) evaluation.webhookUrl = a.webhook_url;
      if (a.webhook_headers !== undefined) evaluation.webhookHeaders = a.webhook_headers;
      const insights = ((d.insights ?? []) as Array<Record<string, any>>).map(toInsightInput);
      return toTool(await apiRequest("PUT", evalPath(a.project_id, a.evaluation_id), { evaluation, insights }));
    },
  );

  server.registerTool(
    "add_insight",
    {
      title: "Add insight (output data element)",
      description:
        "Add an output data element to an evaluation — the unit it extracts/scores. Types: Bool (yes/no), " +
        "Number (scale), Text (free text), TextList (classification set). Read-modify-write; regenerates all " +
        "insight refs. PUT /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string(),
        evaluation_id: z.string(),
        type: z.enum(INSIGHT_TYPES).describe("Bool | Number | Text | TextList."),
        name: z.string().describe("Display name."),
        description: z.string().describe("What it measures/extracts/classifies."),
        prompt: z.string().describe("Instruction for the evaluator LLM."),
        true_text: z.string().optional().describe("Bool: label when true (e.g. Resolved)."),
        false_text: z.string().optional().describe("Bool: label when false."),
        min_value: z.number().optional().describe("Number: range minimum."),
        max_value: z.number().optional().describe("Number: range maximum."),
        values: z.array(z.string()).optional().describe("TextList: allowed classification values."),
      },
    },
    async (a) => {
      const err = validateInsightFields(a.type, a);
      if (err) return textTool(err, true);
      const got = await apiGet(evalPath(a.project_id, a.evaluation_id));
      if (!got.ok) return toTool(got);
      const d = got.data as Record<string, any>;
      const insights = ((d.insights ?? []) as Array<Record<string, any>>).map(toInsightInput);
      insights.push(buildInsightInput(a.type, a));
      return toTool(
        await apiRequest("PUT", evalPath(a.project_id, a.evaluation_id), {
          evaluation: evalDefToInput(d.evaluation ?? {}),
          insights,
        }),
      );
    },
  );

  server.registerTool(
    "edit_insight",
    {
      title: "Edit insight",
      description:
        "Edit an existing output data element by its ref (from get_evaluation). Type is fixed (to change type, " +
        "remove + add). Read-modify-write; ALL insight refs regenerate after — re-fetch with get_evaluation. " +
        "PUT /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string(),
        evaluation_id: z.string(),
        insight_ref: z.string().describe("Ref of the element to edit (refs change on every save — re-fetch first)."),
        name: z.string().optional(),
        description: z.string().optional(),
        prompt: z.string().optional(),
        true_text: z.string().optional(),
        false_text: z.string().optional(),
        min_value: z.number().optional(),
        max_value: z.number().optional(),
        values: z.array(z.string()).optional(),
      },
    },
    async (a) => {
      const got = await apiGet(evalPath(a.project_id, a.evaluation_id));
      if (!got.ok) return toTool(got);
      const d = got.data as Record<string, any>;
      const raw = (d.insights ?? []) as Array<Record<string, any>>;
      const idx = raw.findIndex((x) => x.ref === a.insight_ref);
      if (idx < 0) return textTool(`No output data element with ref "${a.insight_ref}" in this evaluation.`, true);
      const inType = OUT_TO_IN[raw[idx].type] ?? raw[idx].type;
      if (inType !== "Bool" && (a.true_text !== undefined || a.false_text !== undefined))
        return textTool("true_text/false_text only apply to a Bool insight.", true);
      if (inType !== "Number" && (a.min_value !== undefined || a.max_value !== undefined))
        return textTool("min_value/max_value only apply to a Number insight.", true);
      if (inType !== "TextList" && a.values !== undefined)
        return textTool("values only applies to a TextList insight.", true);

      const insights = raw.map(toInsightInput);
      const mod = insights[idx];
      if (a.name !== undefined) mod.name = a.name;
      if (a.description !== undefined) mod.description = a.description;
      if (a.prompt !== undefined) mod.prompt = a.prompt;
      if (inType === "Bool") {
        if (a.true_text !== undefined) mod.trueText = a.true_text;
        if (a.false_text !== undefined) mod.falseText = a.false_text;
      } else if (inType === "Number") {
        if (a.min_value !== undefined) mod.minValue = a.min_value;
        if (a.max_value !== undefined) mod.maxValue = a.max_value;
        if (mod.minValue > mod.maxValue) return textTool("min_value must be <= max_value.", true);
      } else if (inType === "TextList") {
        if (a.values !== undefined) mod.values = a.values;
      }
      return toTool(
        await apiRequest("PUT", evalPath(a.project_id, a.evaluation_id), {
          evaluation: evalDefToInput(d.evaluation ?? {}),
          insights,
        }),
      );
    },
  );

  server.registerTool(
    "remove_insight",
    {
      title: "Remove insight",
      description:
        "Remove an output data element from an evaluation by ref. Data loss — requires confirm:true. " +
        "Read-modify-write; remaining refs regenerate. PUT /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string(),
        evaluation_id: z.string(),
        insight_ref: z.string().describe("Ref of the element to remove."),
        confirm: z.boolean().optional().describe("Must be true to execute (removal is permanent)."),
      },
    },
    async (a) => {
      const g = confirmGuard(a.confirm, `Will remove output data element "${a.insight_ref}" from evaluation ${a.evaluation_id}.`);
      if (g) return g;
      const got = await apiGet(evalPath(a.project_id, a.evaluation_id));
      if (!got.ok) return toTool(got);
      const d = got.data as Record<string, any>;
      const raw = (d.insights ?? []) as Array<Record<string, any>>;
      if (!raw.some((x) => x.ref === a.insight_ref)) return textTool(`No output data element with ref "${a.insight_ref}".`, true);
      const insights = raw.filter((x) => x.ref !== a.insight_ref).map(toInsightInput);
      return toTool(
        await apiRequest("PUT", evalPath(a.project_id, a.evaluation_id), {
          evaluation: evalDefToInput(d.evaluation ?? {}),
          insights,
        }),
      );
    },
  );

  server.registerTool(
    "delete_evaluation",
    {
      title: "Delete evaluation",
      description:
        "Permanently delete an evaluation and all its output data elements. Irreversible — requires confirm:true. " +
        "DELETE /api/v1/project/{projectId}/evaluations/{id}.",
      inputSchema: {
        project_id: z.string(),
        evaluation_id: z.string(),
        confirm: z.boolean().optional().describe("Must be true to execute."),
      },
    },
    async (a) => {
      const g = confirmGuard(a.confirm, `Will permanently DELETE evaluation ${a.evaluation_id} and all its output data elements.`);
      if (g) return g;
      const r = await apiRequest("DELETE", evalPath(a.project_id, a.evaluation_id));
      return r.ok ? textTool(`Deleted evaluation ${a.evaluation_id}.`) : toTool(r);
    },
  );
}
