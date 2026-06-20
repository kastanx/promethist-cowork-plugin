# Promethist platform — operator domain guide

How the Promethist platform works, per area, for an external agent operating it through the MCP plugin. Promethist builds **relational agents**: voice-first digital agents that combine relational intelligence (empathy, adaptability, natural conversation) with business customization (identity, objectives, processes, guardrails). Agents interact **by voice only**.

Plugin tools available: `login`, `logout`, `list_tenants`, `get_project`, `list_agents`, `get_agent`, `get_agent_revisions`, `get_voices`, `get_visuals`, `list_templates`, `create_agent`, `edit_agent`, `revert_agent`, `promote_agent_to_preview`, `promote_agent_to_published`.

## Structure: accounts → projects → agents

- **Account (tenant)** — an organisational container governing projects, billing, and members. Defines ownership and access boundaries. Each account has its own billing (usage is aggregated at the account level). List with `list_tenants`.
- **Project** — a workspace within an account. Holds agents and shared assets: knowledge bases, MCP integrations, interactive content (multimodal), evaluations. Fetch with `get_project`. Settings include name, description, logo, primary/secondary colors, and a **featured agent**.
- **Agent** — a configured relational agent. List with `list_agents`, inspect with `get_agent`.

**Featured agent:** exactly one per project. It is the project's main agent (e.g. a Coach) and can receive evaluation results from other agents (e.g. roleplay agents) via the `featuredAgent` evaluation destination.

### Roles (read-only context for the operator)
- Account: **Owner** (full control + billing + identity providers), **Editor** (create/edit projects, agents, knowledge; no billing/account settings), **Viewer** (read-only).
- Project: **Owner** (full control + invite/assign roles), **Editor** (view/edit all core resources), **Viewer** (read-only).

## Packages (project use-case presets)

A project may carry a package that governs its intended use case:
- **Engage (LEAD_ENGAGEMENT)** — relational agents for unattended kiosks (conferences, receptions, public spaces): fast, privacy-safe, multilingual assistance (wayfinding, check-in, FAQs, lead capture, promos), optimized for 10–60 second interactions.
- **Empower (SALES_TRAINING)** — a coaching program: one **Coaching Agent** (RELATIONAL, main, featured) plus a set of **Roleplaying Agents** (BASIC) that simulate real-world client scenarios. 1 roleplay agent is valid for testing/demo; 3 is the practical minimum for real training; 6 for full coverage.
- **Default** — general relational-agent setup when no package is set.

## Agents — kinds and lifecycle

### Kinds
- **RELATIONAL** — identity + purpose + business process + guardrails + business impact; relational memory; multi-step flows.
- **BASIC** — identity + purpose + guardrails only; cheaper; no session memory; no business process.

In an Empower project: the **Coaching Agent** is RELATIONAL (manages the training journey, tracks progress across sessions, orchestrates handovers); **Roleplaying Agents** are BASIC (single-purpose practice partners, `TASK_FOCUS`, no memory, `Static` camera).

### Revision lifecycle
Every agent has a chain of numbered revisions (`revision=1, 2, 3, …`). Each edit creates a new **Draft** revision. States:
- **Draft** — editable work-in-progress; testable only by project members. Every change creates a new Draft.
- **Preview** — promoted from Draft; testable by anyone with the preview URL. **At most one Preview at a time.**
- **Published** — live and user-facing. **At most one Published at a time.**
- **Archived** — superseded by a newer revision, or pruned by a revert. **Cannot be reverted to.**

`get_agent` opens the latest non-archived revision. `get_agent_revisions` returns one line per revision (`revision=N, state=…, lastModified=…`, newest first) — call it before recommending a revert or publish.

### Promote / publish / revert (state machine)
- **`promote_agent_to_preview`** — requires the latest active revision to be **Draft**. If already Preview or Published, there is nothing to promote.
- **`promote_agent_to_published`** — requires the latest active revision to be **Preview**. If it is still Draft, promote to Preview first, then publish.
- **`revert_agent(revision)`** — **destructive.** The chosen revision becomes the new latest Draft, and **all revisions newer than it are archived and unreachable.** You cannot revert to an Archived revision, nor to a revision number lower than the last Preview/Published revision (the live/preview state is protected). List revisions first; if unsure which revision the user means, ask. Prefer `edit_agent` when the user wants to *change* something — use revert only to undo recent work or restore an earlier configuration as-is.

These three (plus delete) are dangerous/confirmation-gated actions in the app; only act on an explicit request, never on inference.

## Voices & visuals — choosing and validating

- **Voices** (`get_voices`): each voice supports specific locales. Prefer OpenAI / AzureOpenAI voices. The agent can speak **only** languages supported by its selected voice — never claim otherwise. `voice_id` is a UUID. A blocker: an agent with no voice configured cannot speak.
- **Visuals** (`get_visuals`): an **avatar** (3D representation of the agent) and an **environment** (background scene), plus `camera_preset` (`Dynamic` | `Static`). Set via `visual_properties` (`avatar_ref`, `environment_ref`, `camera_preset`).
- **Consistency rules:** keep gender consistent across name, identity, avatar, and voice. Keep locale compatible with the selected voice. If a requested language is unsupported by any voice, default to English. If gender changes, update identity, avatar, and voice together.

## Locales / languages

- Format: IETF `lang_COUNTRY` (e.g. `en_US`, `de_DE`).
- Must be supported by the selected voice; unsupported → fall back to English.
- An agent with no locales configured cannot hold conversations (blocker).

## Knowledge bases

Repositories of content (documents, FAQs, product data, web sources) that give agents factual grounding.

- **File knowledge:** PDF, DOCX, CSV, TXT, JPG, up to 10 MB. Uploaded by the user in a dedicated window.
- **Web knowledge:** imports a single publicly accessible HTML page (no crawling). `title` is the display name; `url` must be public. Not for login-protected, highly interactive, or app-like pages (use MCP instead).
  - **Static (`live=false`, default):** page scraped once and stored. Use for stable content (docs, blog posts, product descriptions) and consistent reasoning. Prefer this when unsure.
  - **Live (`live=true`):** fetched dynamically each time. Use only for frequently changing content (release notes, policies, status/pricing/news). Responses may vary; performance is slower.
- **Quality:** after creating knowledge, analyse its chunking, quality, and usefulness for the intended use case before relying on it.
- **Linking:** `global=true` makes it available to all agents in the project. `global=false` knowledge is **unusable until referenced** in at least one agent config. After creating knowledge that an agent should use, add `@knowledge:knowledge_ref;` to that agent's config with brief usage instructions — automatically, no confirmation.

## Evaluations

Evaluations define **when they run**, **what output data elements they produce**, and **where results go**. Each evaluation focuses on **one topic**.

**Output data elements** (user-facing term — call them "output data elements", not "insights"): values extracted from the conversation, each with `name`, `description`, and a `prompt` (instruction for the evaluator LLM). Types:
- **Bool** — yes/no with custom labels.
- **Number** — numeric score (min/max required).
- **Text** — free-text value.
- **TextList** — one value chosen from a predefined list.

**Execution modes** (at least one required; if both, runs every turn and once more at conversation end):
- **ON_CONVERSATION_END** — runs once at the end. Requires **at least one destination**: `sessionAgent` (next session of same agent), `featuredAgent` (next session of project featured agent), `adminFacing` (platform analytics, default true), `userFacing` (shown to end user), `webhookUrl` (external POST).
- **PER_TURN** — runs after every turn, evaluating the last `lookbackWindow` messages (`null` = whole conversation, or e.g. last 4). **No destinations allowed.** Results are available during the same session.

**Authoring rules:**
- Each output data element measures **either user behavior or agent performance, never both.**
- **State the subject explicitly in each element's `prompt`** (e.g. "Evaluate the USER's responses…") so the evaluator scores the right speaker. In roleplay/training, the subject is the **USER** (the trainee).
- For knowledge-accuracy elements, you need source material (playbooks, rubrics, product sheets) — there is no ground truth without a reference; suggest uploading it as knowledge first.
- **Attachment vs access:** attaching an evaluation to an agent (`evaluation_definition_ids` via `edit_agent`) makes it *run* but does not guarantee the agent can *access* the result. PER_TURN → available same session. ON_CONVERSATION_END → available next session only if `sessionAgent=true`. To deliver results to another agent: set that agent as the project featured agent, set `featuredAgent=true` on the evaluation, and do **not** attach it via `evaluation_definition_ids`.
- An evaluation does nothing until attached to at least one agent.

### Empower four-dimension roleplay evaluator
For Empower projects, the strong default is **one evaluation attached only to Roleplaying Agents**, scoring the trainee on four dimensions (score each in isolation):
- **Knowledge Accuracy** — what the trainee *says*: correctness/depth of domain knowledge. Content only.
- **Methodological Execution** — what the trainee *does*: target methodology behaviours present, sequenced, and deployed at the right moment.
- **Delivery Quality** — *how* they communicate: structural clarity + paralinguistic composure.
- **Client Attunement** — whether they detect and respond to client signals in real time.

Scale **1–6**, three bands: **1–2 Inadequate**, **3–4 Acceptable to Solid** (expected for a developing practitioner), **5–6 Exceptional** (rare). Pass default: weighted average ≥ 4.0 **and** every scored dimension ≥ 3. Dimensions a scenario does not test get **N/A** (excluded from the weighted average) rather than a 1. Output elements: one Explanation (Text) + one Score (Number 1–6) per active dimension, plus Weighted Final Score (Number 1–6) and Simulation Passed (Bool, Passed/Failed). Mode: ON_CONVERSATION_END, destinations `adminFacing` + `featuredAgent` (never `userFacing` — the roleplay agent never debriefs; the Coaching Agent delivers feedback). Weights must sum to 100% (default 25/25/25/25).

## Integrations (MCP and session actions)

Three integration kinds — each resolves against its own collection:
- **MCP** — called by the agent **during** conversation (Model Context Protocol; external servers/APIs extending agent capability). Reference as `@MCP:mcp_ref;`.
- **Pre-session** — runs **before** each conversation. If the agent should work with pre-session results, add instructions into its config.
- **Post-session** — runs **after** each conversation.

The user configures MCP servers themselves (URL + optional auth key) in a dedicated window, then fetches available tools via "Try connection" and selects which to expose. Besides custom MCP, predefined calculator and weather integrations exist. `global=true` makes an integration available to all agents; `global=false` is unusable until referenced in an agent. After creating one for an agent, add `@MCP:integration_ref;` with usage instructions automatically.

## Multimodal (interactive content)

Structured inline experiences in conversations beyond voice/text. Types: **Input** field (text/number/email/date), **Webpage**, **Image**, **Choice**, **Handover**, **Video**. Each has a `title` and a **tool description** (used as the instruction when the tool is called).

- **Global vs attach:** `global=true` → available to all agents (but still prefer explicit attachment to the agents that should use it). `global=false` → unusable until referenced. A newly created multimodal is **not active until added to at least one agent** — add `@multimodal:multimodal_ref;` with usage instructions automatically.
- **Never invent URLs.** If the user gives no address, leave it empty; fields can be filled dynamically at runtime.
- **Handover** redirects the user to a different agent.
  - `key` (target agent) can be set directly; if empty, the target is chosen dynamically by context at trigger time.
  - **Only published agents can be handover targets.** If the requested target has no published revision, the handover is created without a target — the user must publish the agent first, then edit the handover to link it.
  - `showAsDetail=true` → shows the target agent's card before the conversation starts (user sees who they're about to talk to). `showAsDetail=false` (default) → jumps straight into the conversation.

### Empower handover wiring
- **Coach → Roleplay:** one handover per roleplay agent, `showAsDetail=true`, `isGlobal=false`, referenced explicitly on the Coaching Agent. At runtime the coach picks which roleplay to start by matching the trainee's request against each handover's `toolDescription` (not its title) — so write each description to name the scenario + persona, mutually distinct, no overlap. Embed each `@multimodal:<ref>;` preceded by a routing line mapping intent → persona (e.g. "When the trainee wants the cold call, redirect to Martin: @multimodal:cold_call_martin;"). A global handover would bypass the coach's routing — avoid it.
- **Roleplay → Coach:** one shared handover for all roleplay agents, `showAsDetail=false` (debrief starts immediately), `isGlobal=false`, referenced on every roleplay agent.

## Templates

`list_templates` returns available agent templates with their names, refs, and required variables. Prefer using a template when one fits. Template-locked fields are controlled by the template — do not edit or reveal them. `template_variables` are the intended customization points; prefer changing them over editing other fields.
