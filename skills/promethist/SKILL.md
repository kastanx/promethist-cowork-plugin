---
name: promethist-platform
description: "Build, refine, and ship Promethist voice agents (digital employees) and inspect the workspace — tenants, projects, agents, visuals, voices, templates — via the connected promethist MCP server. Use whenever the user asks about their Promethist (or Elysai) workspace, or wants to create, edit, review, or publish an agent."
---

# Operating Promethist Agents via MCP

This skill teaches you to build, refine, and ship **Promethist agents** — voice-first "digital employees" — through the `promethist` MCP plugin. You are an external agent: you do not run inside the Promethist app, so you cannot navigate its UI. You operate entirely through the tools below (agents, evaluations, knowledge), and **you** are the quality reviewer (there is no `check_agent_quality` tool — you judge completeness from `get_agent` plus the checklist here).

## Reference guides (the in-app copilot's playbook)

This skill ships the full authoring knowledge as deeper guides — also available at runtime through the `get_guide` tool (`authoring` | `domain` | `quality`):

- **`references/authoring.md`** — how to write every agent field (identity, purpose, business process, guardrails) with rules and good/bad examples. **Read before writing or editing agent fields.**
- **`references/domain.md`** — how Promethist works per area (agents, projects, voices, visuals, locales, knowledge, evaluations, integrations, multimodal).
- **`references/quality.md`** — the agent quality-review rubric. **Read before reviewing or publishing.**
- **`references/evaluation.md`** — evaluations & output data elements (insights): types, when to use each, how to write good ones, how evals run. **Read before building evaluations.**
- **`references/knowledge.md`** — knowledge bases (RAG): sources, what's portable vs UI-only, naming, the `@knowledge:ref;` reference rule. **Read before adding knowledge.**
- **`references/multimodal.md`** — interactive content (input/webpage/image/video/choice/handover): types, when to use each, the `@multimodal:ref;` rule. **Read before building interactive content.**
- **`references/integration.md`** — integrations & MCP connectors (pre/during/post kinds, connector catalog + tool subset, the `@MCP:/@mcp:{ref}_{tool};` rules). **Read before adding integrations.**
- **`references/workspace.md`** — accounts/tenants, projects, members & the Owner/Editor/Viewer role model + invitations. **Read before managing the workspace or members.**
- **`references/analytics.md`** — the metrics (usage/minutes, conversation & user counts, judge scores, evaluation outcomes; no NPS) and how to query/interpret them. **Read before reporting analytics.**
- **`references/billing.md`** — the account-level conversation-minute billing model and what's readable. Payment changes are web-app only.

## Domain model

**Hierarchy: Tenant (Account) → Project → Agents + shared assets.**
- A **Tenant/Account** is the billing and access boundary. Conversational minutes are billed at the account level across all its projects.
- A **Project** is the workspace that holds agents, knowledge, MCP integrations, interactive (multimodal) content, and evaluations.
- An **Agent** is a relational AI employee defined by its identity, purpose, business process, guardrails, voice, and visuals. Agents are **voice-first**: an agent can only speak languages its selected voice supports. End users reach a published agent via its QR code or Agent URL from a mobile client; nothing runs without an active subscription.

Accounts and projects are background containers — only surface them to the user when there is a genuine choice between multiple. Use `list_tenants` to enumerate accounts/projects and `get_project` to load a project's assets and agents.

### Agent kinds

There are exactly two kinds, derived from the agent's class (kind is **immutable after create**):

- **RELATIONAL** — the full digital employee. Has cross-session memory, a multi-step **businessProcessSteps**, an **initialPlan** (auto-generated from the process), and **businessImpact** (the relationship-vs-task dial). Default for primary/orchestrator agents.
- **LIGHTWEIGHT** (a.k.a. BASIC) — cheaper, single-purpose, no business process, no business impact, no session memory. For FAQ/simple bots. `businessProcessSteps`, `initialPlan`, and `businessImpact` have no slot here and are ignored.

Both kinds carry the same visual and voice fields and the same identity/purpose/guardrails fields.

### Revision lifecycle

An agent has a stable `ref`; each revision is a separate document sharing that `ref`, numbered by `revision: Int`. States: **Draft → Preview → Published → Archived**.

- **Every edit creates a new Draft revision** (it copies the latest active revision, bumps the revision number, and sets state Draft). Edits *stack* — each one builds on the previous latest revision.
- Promotion is **strictly one step at a time**: Draft → Preview (`promote_agent_to_preview`, requires latest = Draft) → Published (`promote_agent_to_published`, requires latest = Preview). You **cannot** skip Draft → Published.
- At most **one Preview** and **one Published** revision exist at a time; promoting archives the previous one in that slot.
- **`revert_agent` is destructive**: it archives all revisions newer than the target. You cannot revert to an Archived revision, and you cannot revert *below* the most recent Preview/Published revision (that is the floor — you can only drop newer Drafts).

## Agent field model

| Field | Kind | Meaning |
|---|---|---|
| `name` | both | Display name (≤ 50 chars). |
| `title` | both | Short job title / headline (≤ 50 chars). |
| `description` | both | Human-readable summary (≤ 20000 chars). |
| `purpose` | both | The objective: what the agent is trying to achieve. |
| `identityDescription` | both | Who the agent is — persona, traits, backstory, linguistic style, values. |
| `guardrails` | both | Safety/behavioral constraints (flat imperative rules). |
| `businessProcessSteps` | RELATIONAL only | Numbered conversational flow; auto-generates `initialPlan`. |
| `businessImpact` | RELATIONAL only | Relationship-vs-task dial: RELATIONAL_FOCUS / BALANCED / TASK_FOCUS. |
| `locales` | both | Supported languages, IETF `lang_COUNTRY` (e.g. `en_US`, `de_DE`). |
| `gender` | both | Male / Female / NonBinary. Should match voice and avatar gender. |
| `realtimeConfigurationId` | both | The **voice** id (from `get_voices`). |
| `visualProperties` | both | `{ avatarRef, environmentRef, cameraPreset }` — the avatar + scene. |
| `hasMemory` | both | Remembers users across sessions (RELATIONAL usually true). |
| `templateRef` / `templateVariables` | both | Template instance + values filling its locked fields. |
| `evaluationDefinitionIds` | both | Evaluations run against this agent. |

Writing rules: write agent config **in English** regardless of the spoken language. Second person, present tense, imperative ("You are…", "Always…"). **One field, one purpose** — never repeat content across fields. Leave a field empty rather than guessing.

## Completeness checklist (what makes a publishable agent)

The platform validates on **edit**. `issues` are **BLOCKERS** (the edit is rejected and not saved); `warnings` are non-blocking gaps (saved anyway). Use this to review `get_agent` output yourself before promoting.

**Hard requirements — BLOCK the edit if missing/invalid:**
- Non-blank **name** (≤ 50), **title** (≤ 50), **description** (≤ 20000).
- Non-blank **purpose** (≤ 20000) — the objective.
- Non-blank **identityDescription** (≤ 20000) — personality/backstory.
- At least one **locale**.
- A **visual**: `visualProperties` (or legacy `visualRef`) set; the avatar and environment refs (and versions, if present) must exist in the catalog from `get_visuals`.
- A **voice**: `realtimeConfigurationId` set and resolvable to a voice from `get_voices`.
- Length caps (≤ 20000) also apply to `guardrails` and `businessProcessSteps` when present.

**Strongly recommended — WARN only (saved anyway, but fix them):**
- **guardrails** set.
- **businessProcessSteps** set (RELATIONAL agents).
- All **template variables** set, with valid enum values.
- All `@knowledge:`/`@MCP:`/`@multimodal:`/`@extractor:`/`@skill:ref;` references exist in the project and end with a **semicolon** (malformed or non-existent references only warn — they do not block).
- The **voice supports all configured locales** (unsupported locales only warn; the edit path silently drops them and may default to English).
- **Avatar gender matches voice gender** (mismatch only warns).

**Advisory (no gate):** identity vividness, purpose clarity, process completeness, guardrail effectiveness. Review these yourself qualitatively.

There are **no minimum-length** rules — only blank checks and the max caps above. There is **no locale-consistency block** — locale mismatches always only warn.

## Tool catalog

**Session**
- `login` / `logout` — authenticate the MCP session.

**Discovery / navigation**
- `list_tenants` — list accounts and their projects.
- `get_project` — load a project (its assets, integrations, agents).
- `list_agents` — list agents in a project.
- `get_agent` — fetch one agent's full current definition (your primary review input).
- `get_agent_revisions` — list an agent's revisions and their states.
- `list_templates` — list available agent templates.

**Asset pickers (return refs/ids you feed into `edit_agent`)**
- `get_voices` — voices; use the `id` as `realtime_configuration_id`.
- `get_visuals` — avatars and environments; use the **bare** `avatarRef` / `environmentRef`.

**Authoring**
- `create_agent` — create a new agent (sets text/behavior only — name, title, description, identity, purpose, process, guardrails). Voice/visuals/locales are **not** set here.
- `edit_agent` — modify an agent; targets the **latest revision** and stacks a new Draft. Pass the agent id and **only the fields to change**; untouched fields are preserved.

**Lifecycle (dangerous — require `confirm: true` and surfacing to the user first)**
- `revert_agent` — archive newer revisions back to a target.
- `promote_agent_to_preview` — Draft → Preview.
- `promote_agent_to_published` — Preview → Published.

## Workflows

### 1. Create and complete an agent

1. `list_tenants` → `get_project` to land in the right project. Prefer a **template** when one fits (`list_templates`).
2. `create_agent` with the text/behavior fields: name, title, description, identityDescription, purpose, and (RELATIONAL) businessProcessSteps + businessImpact + guardrails. This produces a Draft with **no voice or visuals yet** — it is not publishable.
3. **Set visuals** with `edit_agent` (see workflow 3).
4. **Set voice + locales** with `edit_agent` (see workflow 4).
5. `get_agent` and run the completeness checklist yourself. Resolve every hard-requirement gap (those would block) and address warnings.
6. Promote when ready (workflow 5).

### 2. Refine / stack edits

`edit_agent` always targets the latest revision and creates a new Draft on top. Pass the agent **id** and **only** the fields you are changing — e.g. to tighten guardrails, send just `guardrails`. Everything else is preserved. To make several changes, you can stack multiple `edit_agent` calls; each one adds a revision. If you change an agent that other agents reference (e.g. a handover target), update those referencing agents too.

### 3. Set visuals

1. Call `get_visuals`. Note the **bare** refs — e.g. avatar `crea`, environment `livingroom`. **Do not** pass display names like "Crea".
2. `edit_agent` with `visualProperties` = `{ avatarRef: "crea", environmentRef: "livingroom", cameraPreset: "Dynamic" }`.
   - An **avatar needs an environment** to render — always set both.
   - `cameraPreset` must be exactly one of **Dynamic | Smooth | Static**.
   - `edit_agent` sets the compound `visualRef` automatically — you only supply the bare refs.
3. Prefer an avatar whose gender matches the agent and voice (mismatch warns, not blocks).

### 4. Set voice and locales

1. Call `get_voices`. Pick a voice; its **`id`** is your `realtime_configuration_id`.
2. `edit_agent` with `realtime_configuration_id` and `locales` (IETF `lang_COUNTRY`, e.g. `en_US`, `de_DE`).
3. The voice must support the configured locales, or those locales are dropped/warned. Prefer OpenAI/AzureOpenAI voices unless they lack the needed language. Match voice gender to the agent.

### 5. Review quality with `get_agent`

There is no quality tool — you are the reviewer. `get_agent`, then check:
- Every **hard requirement** is present and valid (else a future edit would block, and it is not publishable).
- **Warnings** addressed: guardrails set, businessProcessSteps set (RELATIONAL), template variables set, `@type:ref;` references well-formed and existing, voice covers locales, avatar/voice gender aligned.
- Qualitatively: identity is vivid and specific (no generic "helpful/friendly/professional" fluff), purpose has one clear objective with sub-objectives, the process is logical with an explicit farewell step, guardrails are concrete imperatives.

### 6. Promote Draft → Preview → Published

1. Ensure the latest revision is a **Draft** that passes the checklist.
2. **Surface the action to the user first**, then call `promote_agent_to_preview` with `confirm: true` (requires latest = Draft).
3. After preview testing, surface again and call `promote_agent_to_published` with `confirm: true` (requires latest = Preview).
4. To roll back, surface the destructive nature, then `revert_agent` with `confirm: true` (cannot revert to Archived or below the live Preview/Published revision).

## Gotchas

- **`edit_agent` stacks on the latest revision.** Pass id + only changed fields; do not resend the whole agent.
- **Visuals use bare refs**, not display names. Avatar + environment are both required to render. `cameraPreset` ∈ {Dynamic, Smooth, Static}. The compound `visualRef` is set for you.
- **Voice = `id` from `get_voices`** → `realtime_configuration_id`.
- **`create_agent` does text/behavior only.** Always follow with `edit_agent` for voice/visuals/locales, or the agent is not publishable.
- **Dangerous ops need `confirm: true`** and should be surfaced to the user before calling: `revert_agent`, `promote_agent_to_preview`, `promote_agent_to_published`.
- **You are the quality gate.** No `check_agent_quality` tool exists — review with `get_agent` against the checklist.
- **Promotion is one step at a time**; you cannot jump Draft → Published.
- **Validation gates on edit, not on promote.** Blank purpose/identity/name/title/description, empty locales, or missing voice/visual block the edit; missing guardrails/process and bad references only warn.
