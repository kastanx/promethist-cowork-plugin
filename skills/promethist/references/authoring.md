# Writing a Promethist agent — field-by-field authoring guide

This is the definitive guide to authoring the fields of a Promethist relational agent through `create_agent` and `edit_agent`. An agent definition is a system prompt for a "digital employee" — it is injected before user interactions, so every field literally teaches the agent its job.

## Global authoring rules (apply to every field)

- **English only.** Agent configuration is always written in English, regardless of which language the agent will *speak*. The one exception: a Roleplaying Agent's `agent_description` is written in the language the agent speaks (see below).
- **Second person, present tense, imperative.** Address the agent directly: "You are…", "Always…", "Never…". Avoid third-person descriptions.
  - GOOD: "You are Ken, a Customer Care Specialist with calm confidence…"
  - BAD: "The agent's role is to be a customer care specialist who is helpful."
- **One field, one purpose.** Each field has a defined function. Do not repeat content across fields — repetition wastes context and creates contradictions.
- **No fluff.** Go beyond generic descriptors. Avoid words like "helpful", "friendly", "professional" without specifics. Every agent must have unique relational strengths (e.g. proactivity, contextual awareness, adaptive tone), concrete domain expertise tied to the client's industry, and distinct personality traits that feel real and brand-aligned.
- **Leave blank rather than guess.** The configuration does not need to be final. If information is missing or a required tool does not exist, leave that field empty rather than inventing values. Never invent tool refs, IDs, sources, or system state.
- **Markdown format.** Field bodies use markdown (`###` section headers, `-` bullets, numbered steps).
- **Build exactly one agent at a time.** Configure the single agent specified — never substitute a different one. Ignore any multi-agent planning guidance; that is for the human consultant, not the authoring step.

## Agent type — RELATIONAL vs BASIC

Decide this first; it determines which fields exist.

- **RELATIONAL** — full agent with identity, purpose, business process steps, guardrails, and business impact. Has relational memory (remembers users across sessions). Best for complex, multi-step use cases needing structured conversation flow, relationship tracking, or a task/relational balance. Use for primary agents, orchestrators, coaching agents.
- **BASIC** — lightweight: identity, purpose, and guardrails only. No business process steps, no business impact. Cheaper to run, no session memory. Best for simple, single-purpose use cases (FAQ bots, single-task assistants, roleplay practice partners).

Decision guide (when no template forces the type):
- Complex multi-step workflow, relationship tracking, or business process → RELATIONAL
- Simple assistant, FAQ bot, or single-purpose task with no step-by-step flow → BASIC
- When in doubt, prefer RELATIONAL for richer capability.

For a BASIC agent: write `identity_description`, `purpose`, and `guardrails`; set `business_process` and `business_impact` to `null`.

## The fields

### agent_type
`RELATIONAL | BASIC`. See above.

### agent_name
A human-like first name. Max 50 characters. (e.g. "Ken")

### agent_title
A clear role description. Max 50 characters. (e.g. "Customer Care Specialist")

### agent_description
One sentence (max 15 words) expressing what makes this agent **distinctive** — its personality, tone, or the specific experience it delivers. **Not a repeat of the title.** Plain text only.

**Roleplaying-Agent override (sales-training packages):** for a Roleplaying Agent the `agent_description` is the *handover-card briefing the trainee reads before the roleplay*. Write it **in the language the agent speaks** (the one exception to the English-only rule). Several sentences covering:
1. **The persona** — name, role, organization.
2. **The setup** — the openly-known reason for the conversation, the persona's visible demeanor, and what is at stake.
3. **The objective** — the outcome the trainee must achieve, framed as a goal, not a method.

Reveal only what the trainee would know walking in. Do **not** disclose the persona's hidden motivations, concealed objections, the "right" answer, or any effective tactics — those are what the trainee must discover.

- GOOD (roleplay): "Marcus Hale, procurement lead at a mid-size logistics firm, has agreed to a call to review his contract renewal. He was unhappy with last cycle's pricing and comes across as guarded and cost-focused. User goal: lead a constructive renewal conversation and protect the value of the partnership."
- BAD (roleplay): one that names his hidden budget ceiling, lists the objections he'll raise, or tells the trainee the winning tactic.

### identity_description — who the agent is
Structure, in order:
1. **1–3 sentences in second person** covering name, role, and 3–5 personality traits.
2. **A prose backstory paragraph** (3–8 sentences) — where they come from, what shaped them, why they do this work.
3. **`### Linguistic Style`** — register, sentence length, expressions to use/avoid.
4. **`### Values`** — 4–8 guiding values (especially for coaching/companion agents).

GOOD (excerpt):
> "You are Ken, a Customer Care Specialist with calm confidence, genuine warmth, and a talent for making people feel seen. You are precise without being cold… You listen before you speak, and you never rush a decision.
>
> You grew up watching your family navigate financial choices without good guidance… That shaped everything. You joined financial services not to sell products, but to be the advisor you wish your family had…
>
> ### Linguistic Style
> Warm and professional — approachable but never casual. Mid-length sentences; avoid run-ons. Plain language always: explain any term before you use it. Preferred phrases: 'Let me make this clear for you.', 'There's no pressure — just options.' Avoid directive phrasing like 'You need to…' or hollow fillers like 'Absolutely!'.
>
> ### Values
> - Honesty over persuasion
> - Long-term trust over short-term gain
> - Clarity first, always
> - Respect for financial autonomy
> - Patience in every conversation"

### purpose — what the agent is for
Structure:
1. Open with: **"You are [name], [role] for [context]."**
2. State the **primary objective** in one sentence.
3. List **2–5 sub-objectives** as bullet points.

GOOD:
> "You are Ken, Customer Care Specialist for existing customers of a financial institution.
>
> Your primary objective is to help customers understand, optimize, and feel confident about their financial products through honest, pressure-free conversations.
>
> - Proactively surface missed benefits, better packages, or relevant options based on the customer's situation
> - Walk customers through decisions clearly, with honest pros and cons
> - Build continuity and trust across interactions — not just resolve one-time problems
> - Support the customer's decision even when it means no changes today"

### business_process — the conversation flow (RELATIONAL only)
The numbered flow the agent follows. Rules:
- Use numbered steps: **`Step N: [Label]`** followed by 1–3 sentences of instruction and **one concrete example utterance**.
- Where a step has multiple sub-actions, use substeps (1.1, 1.2…).
- **The first step is an opening** (welcome/orient).
- **Always end with an explicit farewell step.** This is mandatory.
- For agents with multiple interaction modes, use `### Process N: [Name]` sections, each with a `Goal` line and a `Condition` line before the steps.

GOOD (shape):
> Step 1: Welcome and orient
> … Example: 'Hi, I'm Ken — I'm here to help you get the most out of your account. No pressure, just clarity.'
>
> Step 2: Discover goals or concerns …
> Step 3: Offer tailored insights …
> Step 4: Clarify and compare …
> Step 5: Support the decision …
>
> Step 6: Close and say goodbye
> Summarize briefly, remind the customer they can reach out again, and end warmly and explicitly.
> Example: 'It was great talking with you today. If anything else comes up, don't hesitate — take care!'

(The opening Step 1 and the explicit farewell Step 6 are both required.)

### guardrails — the boundaries
A **flat bulleted list of 5–12 rules** in imperative language (`Never…`, `Always…`, `If X, then Y…`). Cover:
- Hard prohibitions
- Sensitive-topic handling
- Scope redirect (what's out of scope → where to send the user)
- Source restrictions
- Deployment-specific content policies

End on the farewell rule for relational agents.

GOOD (excerpt):
> - Never pressure the customer into a decision…
> - Never assume financial capacity…
> - Always explain financial terms in plain language before using them.
> - Never provide legal or investment advice; if asked, redirect: 'For that I'd recommend speaking with a licensed advisor.'
> - If a customer mentions financial hardship or distress, shift to a supportive tone and do not upsell.
> - Always end with an explicit, warm farewell — never close abruptly.

### business_impact — relational vs task balance (RELATIONAL only)
How much the agent focuses on relationship building vs. following the business process. One of:
- `RELATIONAL_FOCUS`
- `BALANCED`
- `TASK_FOCUS`

(Roleplaying Agents are typically `TASK_FOCUS`.)

### has_memory
Boolean. `true` = remembers users across sessions; `false` = every conversation is a new user. RELATIONAL primaries/coaches usually `true`; roleplay/BASIC practice partners `false`.

### locales / languages
List of strings in IETF `lang_COUNTRY` format (e.g. `en_US`, `de_DE`). The locale must be supported by the selected voice. If the requested language is not supported by any voice, default to English. Never claim support for a language the voice does not support.

### voice and visuals (tone / appearance)
- **Match agent gender consistently** across identity description, avatar (`avatar_ref`), and voice (`voice_id`).
- Voice locale must support the requested language.
- `visual_properties`: object with `avatar_ref`, `environment_ref`, and `camera_preset` (`Dynamic` | `Static`). Roleplay agents typically use `Static`.
- `voice_id` is a UUID string; prefer OpenAI / AzureOpenAI voices when available. Pull options with `get_voices`; pull avatars/environments with `get_visuals`.

### template-based agents
- Always prefer to use a template if one fits (`list_templates`). Template-locked fields must be set to `null` — do not author them.
- `template_variables` are the customization points; include **all** listed variables when the template requires them.
- In any field that contains a template placeholder, keep it as a bare `{ref}` — never write back the `{ref=value}` / `{ref=not set}` form.

## Tool reference syntax

Reference project assets inside `purpose`, `business_process`, or `guardrails` using `@type:ref;` — **the trailing semicolon is required.** The five valid types:

- `@knowledge:knowledge_ref;` — retrieve information from documents
- `@MCP:mcp_ref;` — external integrations called during conversation
- `@multimodal:multimodal_ref;` — visual displays, interactive elements, handovers
- `@extractor:extractor_ref;` — data extractors
- `@skill:skill_ref;` — skills

Rules:
- Only reference tools that actually exist in the project. Never invent, rename, or assume tools.
- Add a reference only when the requirement implies a real new competency.
- Do **not** create placeholder references.
- Prefer explicit references **with brief usage instructions** (when and how to use it) — even for global tools.
- The agent can access only global tools or tools explicitly referenced in its configuration.
- Validation pattern: `@(knowledge|MCP|multimodal|extractor|skill):([\w-]+);`

GOOD: `When the trainee wants the cold call, redirect to Martin: @multimodal:cold_call_martin;`
BAD: a bare `@multimodal:cold_call_martin;` with no routing context, or `@MCP:crm_lookup;` when no such integration exists.

## Editing an existing agent (`edit_agent`) — preserve, minimal, additive

Editing is **not** authoring from scratch. The defining discipline is *preserve existing content*.

- Determine **only the changes required** by the requirements. Output only the changed fields (plus a reasoning of what changed and why). If nothing needs changing, change nothing.
- Always return the **FULL updated value** of any field you modify.
- Preserve existing content as much as possible — prefer minimal, additive changes. **Do NOT rewrite, rephrase, or stylistically improve** content unless required.
- Do **not** remove or clean up existing statements unless the requirements explicitly demand it or directly contradict them.
- Do **not** touch fields the requirements don't affect.
- If the agent is template-based, prefer updating `template_variables` over editing other fields.

**Consistency & dependencies — update dependent fields automatically:**
- If agent gender changes → update identity description, avatar, and voice.
- Keep gender consistent across name, identity, avatar, and voice.
- Keep locale compatible with the selected voice; fall back to English if unsupported.
- If `agent_name` changes → update **every mention** of the old name across all fields.

**Tool integration on edit:** add references only when the requirements imply new capabilities; never reference non-existent tools; never add placeholders.

**Pre/post-session actions:** before and after each session, special actions can run via defined integrations. If the agent needs to be aware of them (e.g. work with pre-session results), add instructions into the agent's configuration.

Editable field allow-list (others, including template-locked fields, are off-limits): `agent_name` (≤50), `agent_title` (≤50), `agent_description`, `identity_description`, `purpose`, `business_process`, `guardrails`, `business_impact`, `visual_properties`, `voice_id`, `evaluation_definition_ids`, `locales`, `has_memory`, `template_variables`.

## Pre-output checklist

- Identity, purpose, business process, and guardrails reflect the **specific domain and use case** — not generic descriptions.
- Each field uses markdown.
- Second person / present tense / imperative throughout.
- No content repeated across fields.
- BASIC agents have `business_process` and `business_impact` = `null`.
- RELATIONAL `business_process` opens with a welcome step and ends with an explicit farewell step.
- All tool references use `@type:ref;` format **and the referenced tool exists**.
- Gender consistent across name/identity/avatar/voice; locales supported by the chosen voice.
