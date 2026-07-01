# Promethist Platform — Claude connector

Operate the **Promethist Platform** from Claude: create/edit agents, evaluations, knowledge,
multimodal content, integrations, manage tenants/projects/members, read analytics & billing, and
**live-test agents** — all as the logged-in user. 84 tools + on-demand guides, no backend changes.

It ships in **two forms from this one repo** (same MCP server underneath):

| Surface | How to add it |
|---|---|
| **Claude Desktop cowork** | a Desktop Extension — `promethist-platform.mcpb` (double-click, or org-upload) |
| **Claude Code** (terminal / Code panel) | this repo is a **plugin marketplace** — `claude plugin ...` |

Auth is **browser login** — the first tool call opens your browser to Promethist and you log in as
yourself; the session is cached and auto-refreshed. Nothing to paste, no cookies to share.

---

## Use it in Claude Code (plugin marketplace)

This repo is itself a marketplace (`.claude-plugin/marketplace.json`, name `promethist`). Add it,
then install the plugin:

```bash
# from a git host (after pushing this repo):
claude plugin marketplace add <git-url>          # or a github owner/repo, or a local path
claude plugin install promethist-platform@promethist
```

Inside Claude Code you can also use the slash forms: `/plugin marketplace add …` then
`/plugin install promethist-platform@promethist`. Update later with `/plugin marketplace update`.

Then ask: *"list my Promethist tenants."* First call opens a browser to log in.

> The plugin runs a **self-contained bundle** (`mcp-server/dist/bundle.mjs`) with plain `node` — no
> `npm install` on the user's side. They only need Node on PATH (Claude Code has it).

## Use it in Claude Desktop cowork (Desktop Extension)

Cowork loads Desktop Extensions, not Claude Code plugins. Build/get the `.mcpb` and install it:

- **Double-click** `promethist-platform.mcpb` → Install (or Settings → Extensions → Advanced → Install).
- **For a team:** a Team/Enterprise **org admin** uploads it at *Organization settings → Connectors →
  Desktop*; members then click **"Add to team"** inside Claude — no file passing.

Build the `.mcpb` (from `mcp-server/`):

```bash
cd mcp-server && npm install && npm run build
npx -y @anthropic-ai/mcpb@latest pack . ~/Desktop/promethist-platform.mcpb
```

---

## What's inside

- **Agents** — create/edit/get/list, revisions, revert, promote to preview/published, voices, visuals, templates.
- **Evaluations, Knowledge, Multimodal/interactive content, Integrations & MCP connectors.**
- **Workspace** — tenants, projects, members/roles, invitations.
- **Analytics & billing** — read-only.
- **`test_agent`** — hold a real conversation with a live agent (any published/preview/draft) to test behavior, then critique the config. See `get_guide('testing')`.
- **`get_guide(topic)`** — the in-app copilot's authoring/quality/area playbooks on demand.
- Read tools return a **`webUrl`** deep link into the Promethist studio.

## Develop

```bash
cd mcp-server
npm install
npm run build        # tsc → dist/src, then esbuild → dist/bundle.mjs (the plugin runtime)
npm run test:e2e     # optional: needs PROMETHIST_BASE_URL + a session
```

After changing server code: `npm run build` (rebuilds the committed `dist/bundle.mjs`), then
`/reload-plugins` (Claude Code) and/or repack the `.mcpb`. Bump `version` in
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `mcp-server/manifest.json`.

`PROMETHIST_BASE_URL` selects the environment (default `https://eu.promethist.ai`).

## Layout

```
.claude-plugin/
  marketplace.json     # makes this repo a plugin marketplace
  plugin.json          # the plugin: runs mcp-server/dist/bundle.mjs via node
mcp-server/
  src/                 # TypeScript sources (index + per-area tool modules)
  dist/bundle.mjs      # committed single-file runtime (the plugin uses this)
  guides/*.md          # get_guide content
  manifest.json        # Desktop Extension (.mcpb) manifest
skills/promethist/     # skill + reference copies of the guides
```
