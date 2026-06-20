# Promethist Platform — Claude cowork plugin

A Claude Code / cowork **plugin** that lets Claude operate the Promethist Platform.
It bundles an MCP server (`mcp-server/`) that wraps the platform REST API (`/api/v1`) and a
skill (`skills/promethist/`) that teaches Claude when and how to use it.

This is **Approach A**: zero backend changes — the plugin authenticates as the logged-in user and
calls the existing API. (Approach B = make the platform itself an MCP server, reusing its in-app
`@Tool` functions; that needs backend work and is the production target.)

## Layout

```
promethist-cowork-plugin/
├── .claude-plugin/plugin.json     # manifest + MCP server registration
├── mcp-server/                    # the bundled MCP server (TypeScript)
│   ├── src/{index,config,auth,client}.ts
│   ├── test/e2e.ts
│   └── package.json
└── skills/promethist/SKILL.md     # how Claude should use the tools
```

## Tools

| Tool | Args | REST call |
|------|------|-----------|
| `list_tenants` | none | `GET /api/v1/tenants` |
| `get_project` | `projectId` | `GET /api/v1/project/{projectId}` |

## Auth (how it connects as you)

The platform backend is an OAuth2 resource server (Keycloak realm `platform`) and only accepts a
`Bearer` JWT — it does **not** read cookies. The web app uses an Auth.js session cookie whose
encrypted blob holds the Keycloak token. So the server resolves auth like this:

```
authjs.session-token cookie ──▶ GET {webUrl}/api/auth/session ──▶ { accessToken } ──▶ Bearer ──▶ /api/v1
```

The token is cached and auto-refreshed (the session endpoint refreshes it), so the long-lived
cookie keeps working without the ~30-min access-token expiry.

Provide **`PROMETHIST_COOKIE`** (recommended) or **`PROMETHIST_TOKEN`** via the environment or a
gitignored `mcp-server/.env.local`. See `mcp-server/.env.example`.

> Get the cookie: in a logged-in web session, DevTools → Application → Cookies →
> copy `authjs.session-token`, and set `PROMETHIST_COOKIE=authjs.session-token=<value>`.

## Try it

```bash
cd mcp-server && npm install
PROMETHIST_BASE_URL=https://preview.eu.promethist.ai \
PROMETHIST_COOKIE='authjs.session-token=...' \
npm run test:e2e            # spawns the server, lists tools, prints your live tenants
```

Interactive inspector:

```bash
cd mcp-server && PROMETHIST_COOKIE='...' npm run inspect
```

## Install into Claude Code

A local plugin must be installed *through a marketplace* — `claude plugin install <path>` does not
work. This repo ships a `.claude-plugin/marketplace.json` (marketplace `promethist`), so:

```bash
export PROMETHIST_COOKIE='authjs.session-token=...'   # manifest passes ${PROMETHIST_COOKIE} through
claude plugin marketplace add /Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin
claude plugin install promethist-platform@promethist   # name@marketplace
```

Then ask: *"list my Promethist tenants"*. After editing plugin files, run `/reload-plugins`.

### Or register just the MCP server (no skill)

```bash
# create mcp-server/.env.local from .env.example first (holds PROMETHIST_COOKIE), then:
claude mcp add promethist -- npx tsx /Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin/mcp-server/src/index.ts
```

> Runtime needs `mcp-server/node_modules` (`cd mcp-server && npm install`) — `npx tsx` resolves
> `tsx` and the MCP SDK from there.

## Next steps

- Add more read tools (`get_project_context`, list agents, analytics).
- Add write tools (create agent, edit prompt, upload knowledge) — each maps to a `/api/v1` endpoint;
  they require a token with editor/owner roles in the target tenant/project.
- Automate token acquisition with a Keycloak grant (for non-interactive use).
