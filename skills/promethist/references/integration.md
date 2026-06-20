# Promethist — integrations & MCP connectors (operator guide)

Integrations connect agents to the outside world. There are **four kinds**, in **three runtime moments**, plus the **connector catalog**. New plugin tools: `list_integrations`, `create_pre_integration`, `create_post_integration`, `create_mcp_integration`, `edit_integration`, `delete_integration`, `list_connectors`, `enable_connector`, `update_connector`, `delete_connector`, `load_mcp_tools` (plus `edit_agent` to reference them).

## The four kinds and when each runs

| Kind (`type`) | Runs | Storage collection | What it is |
|---|---|---|---|
| `pre` | **Before** each conversation | `webhookSpecifications` (`hook=PRE_SESSION`) | A pre-session webhook (e.g. fetch context to seed the session). |
| `during` | **During** a conversation, called by the agent | `mcpServerSpecifications` | A full MCP server the agent can call mid-conversation. |
| `post` | **After** each conversation | `webhookSpecifications` (`hook=POST_SESSION`) | A post-session webhook (e.g. push results somewhere). |
| `connector` | During a conversation | `mcpConnectorSpecifications` | A pre-built MCP connector enabled from the platform's **catalog**. |

These live in **different collections and route differently** — getting the kind wrong silently targets the wrong place. Two routing surfaces:
- **create/edit** route the kind via the **path segment** (`/integrations/pre|/during|/post|/connector`).
- **delete** routes the kind via the **`?type=` query param** (`pre|during|post|connector`) — there is **no separate `kind` param**, `type` IS the selector. A wrong `type` deletes nothing or 400s.
Always confirm a row's `type` via `list_integrations` before editing/deleting.

## Listing — `list_integrations(project_id)`

Returns four buckets: `{ pre:[…], during:[…], post:[…], connector:[…] }`. Every row carries its `ref` and a `type` discriminator (`pre|during|post|connector`). Use this to discover refs and the exact kind before any edit/delete. (Note: `apiKey` on MCP-server rows is always `null` on read — it's stripped.)

## Pre / post webhooks

- **`create_pre_integration(project_id, name, url, method?, headers?, enabled?, llm_description?, default_value?, timeout?, retries?)`** — a before-conversation webhook. `llm_description` and `default_value` are **pre-only** (a pre-session action's result can be described to the LLM and given a default). `method` defaults to POST; `timeout` 5000ms; `retries` 0; `headers` is `[{name,value}]`.
- **`create_post_integration(project_id, name, url, method?, headers?, enabled?, timeout?, retries?)`** — an after-conversation webhook (no `llm_description`/`default_value`).
- Edit either with **`edit_integration(project_id, kind, ref, …)`** using `kind="pre"` / `"post"` (see Editing).
- If the user should act on a **pre-session result** inside the conversation, add instructions about it into the agent's configuration.

## MCP server integrations (`during`)

A `during` integration is a full external MCP server the agent calls mid-conversation. In the app the user fills the URL/auth themselves — through the plugin you build it directly:

1. **Probe the server first** — `load_mcp_tools(url, transport_type, auth_header_name?, auth_header_value?)` connects live and returns the server's available tools. `transport_type` ∈ `SSE | StreamableHttp`. (This call is **not project-scoped**.) Take the `.name`s for the next step.
2. **Create it** — `create_mcp_integration(project_id, name, url, transport_type, auth_header_name?, auth_header_value?, tool_names?, is_global?)`. `tool_names` is the **subset of tool NAMES** to expose. **Empty `tool_names` = ALL tools** (the server's whole toolset).
3. Auth is via `auth_header_name`/`auth_header_value` (e.g. `Authorization` / `Bearer …`). There is no separate `apiKey` field exposed.

## The connector catalog

Connectors are pre-built MCP integrations the platform offers; you can only **enable** and **tool-select** from the catalog — you cannot create catalog entries through this API.

- **`list_connectors(project_id)`** — the catalog + per-project state: each `{ ref, name, description, iconUrl, toolSpecifications, enabled, selectedTools, isGlobal }`. Read the catalog `ref` and tool `.name`s here before enabling. `selectedTools` (names) round-trips into `update_connector`. **Orphan rows** (an enabled connector that left the catalog) show up with `enabled=true` and `name=ref` so you can clear them.
- **`enable_connector(project_id, ref, tool_names?, is_global?)`** — enable a catalog connector with a subset of its tools. **`ref` must match a catalog ref byte-for-byte** (else 404). `tool_names` are tool **names**; an unknown name → 400. **Empty `tool_names` = NO usable tools** (the OPPOSITE of an MCP server, where empty = all).
- **`update_connector(project_id, ref, tool_names, is_global?)`** — **full replace** of the selection: pass the **complete** desired tool-name set (read the current set from `list_connectors.selectedTools` first); omitting/emptying clears the selection.
- **`delete_connector(project_id, ref, confirm: true)`** — there is **no separate disable endpoint**; deleting IS disabling. This is also the only way to clear an orphan row. (Equivalent to `delete_integration(type="connector", …)`.)

## Editing — `edit_integration` (full replace → read-modify-write)

`edit_integration(project_id, kind, ref, …)` covers `pre` / `during` / `post` (connectors use `update_connector`). The PUT is a **full replace**, so the tool GETs the current row from `list_integrations` and merges your changes over it. Rules:
- **`kind` MUST equal the row's `type`** from `list_integrations` — it routes via the path segment; a mismatched kind won't find the ref in that collection.
- For `during`, the server **re-filters** tool names on update — pass the complete desired `tool_names` (or empty for all).

## Deleting — `delete_integration` (DANGEROUS)

`delete_integration(project_id, type, ref, confirm: true)` is the **single delete path for all four kinds** (incl. connectors). `type` ∈ `pre|during|post|connector` — it is the kind selector (no separate `kind` param). It maps to `DELETE /integrations?type=<type>&ref=<ref>`. Irreversible and has **no server-side confirm**, so `confirm: true` is the only guard — surface the deletion first. A wrong `type` silently no-ops (pre/post both hit webhooks but resolve different refs).

## Referencing from an agent — `@MCP:` vs `@mcp:{ref}_{tool}`

An agent uses only **global** integrations or ones it **explicitly references**. Two distinct reference mechanisms (this is NOT just casing):

- **Whole-integration / global form — `@MCP:mcp_ref;`** — references an entire MCP-server (or global) integration. Trailing `;` mandatory (same family as `@knowledge:ref;`, `@multimodal:ref;`).
- **Per-tool form for NON-GLOBAL connectors — `@mcp:{ref}_{toolName};`** — when a connector is enabled with **`is_global=false`**, the engine serves a tool **only** to agents that reference it individually by composing `connector ref` + `_` + tool name. The whole-integration `@MCP:ref;` form does **not** pull in a non-global connector's tools.

Visibility rules:
- **`is_global=true`** (default everywhere) → available to all agents. Only `false` triggers the per-tool `@mcp:` requirement.
- **`is_global=false`** → unusable until explicitly referenced. After enabling/creating an integration an agent should use, **immediately reference it** (`@MCP:integration_ref;`, or `@mcp:{ref}_{tool};` per tool for a non-global connector) with a one-line usage instruction — automatically, no confirmation.
- Never reference tools that don't exist; never create placeholder references.

## Empty-selection trap (memorize)

| Shape | Empty tool selection means |
|---|---|
| MCP **server** (`during`) | **ALL** tools exposed |
| **Connector** | **NO** usable tools |

## Tool quick-reference

| Task | Tool |
|---|---|
| List all integrations (find refs/types) | `list_integrations(project_id)` |
| Add before-conversation webhook | `create_pre_integration(project_id, name, url, …)` |
| Add after-conversation webhook | `create_post_integration(project_id, name, url, …)` |
| Add an MCP server (during) | `create_mcp_integration(project_id, name, url, transport_type, …)` |
| Probe an MCP server's tools | `load_mcp_tools(url, transport_type, …)` |
| Edit pre/during/post (read-modify-write) | `edit_integration(project_id, kind, ref, …)` |
| Delete any integration | `delete_integration(project_id, type, ref, confirm: true)` |
| List the connector catalog + state | `list_connectors(project_id)` |
| Enable a connector | `enable_connector(project_id, ref, tool_names?, …)` |
| Change a connector's tool set | `update_connector(project_id, ref, tool_names, …)` |
| Disable/delete a connector | `delete_connector(project_id, ref, confirm: true)` |
| Make it usable by an agent | `edit_agent` + `@MCP:ref;` (or `@mcp:{ref}_{tool};` for non-global connectors) |

GAPs: no API to **create catalog connectors** (catalog is read-only — enable/select only); no separate connector **disable** (delete = disable); MCP-server **`apiKey`** is not settable here (use `auth_header_name`/`auth_header_value`) and is `null` on read.

---

All three outputs are above with their exact delimiters. Key conflicts/decisions flagged inline:
- **Param naming:** REST mapping used `projectId`; I specced `project_id` to match the live plugin convention in the newer modules (`knowledge-tools.ts`, `evaluation-tools.ts`). All param names are snake_case per the brief.
- **Read vs write discriminator** (multimodal `__typename` on read, `type` on write) and **delete-via-`?type=` vs edit-via-path-segment** (integration) are both load-bearing and called out in the SPEC and guides.
- No tools were created for the file-upload GAPs (image/video bytes; catalog-connector creation; connector disable) or the CLAUDE-NATIVE items (handover key resolution; in-app websocket UI tools).
- Relevant existing files I conformed to: `/Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin/mcp-server/src/{client.ts,tool-result.ts,knowledge-tools.ts,index.ts,guides.ts,agent-tools.ts}` and `guides/knowledge.md`.
