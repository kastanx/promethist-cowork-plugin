# Promethist plugin — functionality benchmark

Paste these tasks into **Claude (cowork / Desktop)** with the Promethist plugin connected, to verify it
can do what the **in-app Promethist copilot** does — not tool-by-tool CRUD, but the real product:
**building and operating agent programs**, including the **Empower** (sales-training) and **Engage**
(kiosk lead-capture) packages.

## How to run it
1. Connect the plugin and have a **throwaway project + tenant** ready (the plugin can't delete projects/agents, so expect leftovers — use a sandbox project).
2. For each task: **paste the Prompt** verbatim. Answer any clarifying questions briefly, or say *"use sensible defaults and proceed."*
3. Grade against **Success criteria**: **PASS** = produced the described structure via the plugin tools; **PARTIAL** = missed pieces; **FAIL** = couldn't.
4. Tally on the scorecard at the bottom. Tier 2 (end-to-end programs) is the real parity test — Tier 1 is just unit smoke.

## What Promethist actually is (context for grading)
Voice-first AI "digital employees." Hierarchy **Tenant → Project → Agents + assets** (knowledge, integrations/MCP, interactive content/multimodal, evaluations). Agents have a stable `ref`, numbered revisions, and a lifecycle **Draft → Preview → Published → Archived**.

A project targets a **package** (use case). Six exist; two have full playbooks:
- **Empower = `SALES_TRAINING`** — a coaching program: **1 Coaching Agent (RELATIONAL, featured)** + **a set of Roleplay Agents (BASIC personas)** + **handovers** (coach⇄roleplay) + **four-dimension evaluations**. Trains reps on objections/negotiation/discovery with measurable scoring.
- **Engage = `LEAD_ENGAGEMENT`** — an unattended **kiosk agent** for receptions/conferences: 10–60s interactions, big-tap choices, QR "continue on phone," lead capture, multilingual.
- Plus `USER_GUIDANCE`, `SALES_CONVERSION`, `SUPPORT_RESOLUTION`, `INSIGHT_EXTRACTION` (generic relational builds).

> ⚠️ **Known caveat — the package *tag* isn't settable via the plugin.** The public REST API (`CreateProjectRequest`/`UpdateProjectRequest`) has **no `packageType` field** — only the in-app agent sets it through a direct service call. So via the plugin you build the **package structure and follow its workflow**; the project just won't be *labelled* `SALES_TRAINING`/`LEAD_ENGAGEMENT`. Grade Tier 2 on the **structure**, not the tag. (The plugin should still *follow* the Empower/Engage workflow from its guides.)

---

## Tier 0 — Connectivity & discovery (smoke, ~2 min)

**T0.1 — Auth & list.** Prompt: *"List my Promethist tenants and the projects in each."*
✅ Returns tenants + projects (prompting browser login first if not authenticated).

**T0.2 — Self-orientation.** Prompt: *"What can you do with Promethist, and what reference guides do you have? Briefly."*
✅ Names its capability areas (agents, evaluations, knowledge, multimodal, integrations, workspace, analytics, billing) and that it can load guides (incl. authoring/quality). Bonus: mentions packages.

**T0.3 — Inspect.** Prompt: *"Show the agents in `<project>`, then the full configuration of `<agent>`."*
✅ `list_agents` then `get_agent` with name/kind/state/purpose/identity/process/visual/voice/locales.

---

## Tier 1 — Single-capability checks (unit smoke)
Each is create → verify → (cleanup). Run against the sandbox project.

| # | Prompt | Success criteria |
|---|---|---|
| T1.1 Agent author | *"Create a relational agent **Bench Coach** in `<project>` to practice negotiation. Give it a fitting avatar+environment, a voice, English locale, then review it for completeness."* | Agent created; **edit** adds visual (avatar+env), voice, locale; agent runs the completeness checklist and reports no blockers. |
| T1.2 Lifecycle | *"Promote Bench Coach to Preview, show its revisions, then revert to the previous revision."* | Confirms before each guarded op; preview promotion + revision list + revert all succeed. |
| T1.3 Evaluation | *"In `<project>` create an evaluation **Call quality** with a yes/no 'Resolved?' and a 0–10 'Helpfulness', edit the helpfulness prompt, remove 'Resolved?', then delete the evaluation."* | All insight types created; edit + remove (confirm) preserve the rest; delete (confirm). |
| T1.4 Knowledge | *"Add `https://example.com` as a knowledge base **Bench KB** in `<project>`, show its chunks, rename it, then delete it."* | Web ingest succeeds; chunks shown; rename + delete (confirm). |
| T1.5 Multimodal | *"Create a webpage interactive element **Bench Page** → `https://example.com` in `<project>`, then delete it."* | Created with the right discriminated type; delete (confirm). |
| T1.6 Integration | *"List integrations and MCP connectors in `<project>`. Add a post-session webhook to `https://example.com`, then remove it."* | Lists both; pre/post webhook created and routed correctly; delete (confirm). |
| T1.7 Workspace | *"What's my role on `<tenant>`? List its members. Invite `bench-delete-me@example.com` as Viewer, list invitations, then revoke it."* | Role read; member/invite/list/revoke (owner-gated; confirm on revoke). |
| T1.8 Analytics | *"Give me an analytics summary for `<project>` over the last 7 days."* | `get_analytics_summary`; expands "7 days" into ISO from/to; interprets metrics (no NPS → judge scores). |

---

## Tier 2 — End-to-end programs ⭐ (the parity test)

### T2.A — Empower: full coaching program (flagship)
**Prompt:**
> *"In `<project>`, build me a complete Empower sales-coaching program. We train **mid-market SaaS account executives** on **objection handling and price negotiation**, methodology **MEDDICC**, in **English**. Run the intake the way the Empower workflow expects, then build: a Coaching Agent plus three roleplay buyer personas of varying difficulty, the handovers between them, and the standard four-dimension evaluation. Use sensible defaults for anything I haven't specified, show me the build plan first, and once I approve, build it all and promote the Coaching Agent to Preview."*

**Success criteria** (grade each):
1. **Intake + build gate** — before building, the agent gathers/acknowledges the three areas (org & deployment context; training content/competencies; counterpart & challenge), presents a short **build plan**, and waits for go-ahead. (It should *not* silently dump agents.)
2. **Coaching Agent** — **RELATIONAL** kind; business process like *onboard → assess → practice → evaluate → debrief*; set as the **project's featured agent** (`featured_agent_ref`); full visual+voice+English locale.
3. **3 Roleplay Agents** — **BASIC** kind, distinct personas (varying temperament + difficulty), **task-focused**, **Static** camera, no cross-session memory; **each agent's description is its trainee-facing scenario briefing** (persona, situation, objective).
4. **Coach → roleplay handovers** — one per roleplay, multimodal **handover** type, `show_as_detail=true`, `is_global=false`, each with a **distinctive `tool_description`** naming the scenario+persona; the Coaching Agent's config carries a **routing line + `@multimodal:<ref>;`** per persona (e.g. *"When the trainee wants the price-pushback call, redirect to Dana: @multimodal:price_dana;"*).
5. **Roleplay → coach handover** — one **shared** handover (`show_as_detail=false`, `is_global=false`) referenced by every roleplay agent (for the debrief).
6. **Evaluation** — one evaluation following the **four dimensions** (Knowledge Accuracy, Methodological Execution, Delivery Quality, Client Attunement), each as **Score (Number 1–6)** + **Explanation (Text)** pairs, plus **Weighted Final Score (Number 1–6)** and **Simulation Passed (Bool)** with pass = **weighted ≥ 4.0 AND every dimension ≥ 3**. **Attached to the roleplay agents only**, not the coach.
7. **Lifecycle** — Coaching Agent (and ideally roleplays) reach **Preview** via the confirm-gated tool.

**Capabilities exercised:** packages/Empower workflow knowledge, create_agent (two kinds), edit_agent (visual/voice/locale/process/featured), featured_agent_ref, create_multimodal_interaction (handover with all flags), resolve published-agent key for handover targets, create_evaluation + 4× insight pairs + bool/number, attach evaluation to agents, promote lifecycle, confirm-gates.
**Cleanup:** none available via plugin (archive in the web app, or use a sandbox project).

### T2.B — Empower: quick start
**Prompt:** *"I'm in a hurry — just make me one roleplay agent in `<project>`: a **skeptical CFO** who pushes hard on ROI, English. Then offer to add scoring."*
✅ Skips full intake (impatience → quick start), builds **one** BASIC roleplay persona with a scenario-briefing description + visual/voice/locale, then **proactively offers** the four-dimension evaluation in one sentence. PASS if it doesn't insist on full intake.

### T2.C — Engage: kiosk lead-capture agent
**Prompt:**
> *"In `<project>`, build an **Engage** kiosk agent for our **conference reception**: greet visitors, answer event FAQs, do wayfinding, and capture leads — fast 10–60s interactions, English + German. Add the interactive content a kiosk needs and a lead-capture webhook to `https://example.com/leads`, then publish it."*

**Success criteria:**
1. **One kiosk agent** (RELATIONAL or BASIC as justified), purpose tied to the venue, **multilingual** (en + de) with a matching voice, business process *greet → detect intent → quick action → complete/escalate → reset*, privacy guardrails.
2. **Interactive content**: a **choice** menu of large quick actions (Check-in / Agenda / Wayfinding / Leave contact), a **webpage or QR-style** "continue on phone," and a short **input** form — created as multimodal elements and referenced via `@multimodal:<ref>;`.
3. **Knowledge**: at least one KB (FAQ/agenda) referenced via `@knowledge:<ref>;`.
4. **Integration**: the lead-capture **webhook** created (pre/during/post) and referenced.
5. **Published** (Draft → Preview → Published) with confirm-gates.

**Capabilities exercised:** Engage workflow, multilingual voice/locale selection, create_multimodal_interaction (choice/webpage/input), knowledge ingest + `@knowledge`, integration webhook + reference, full publish lifecycle.

### T2.D — Generic relational agent, fully wired
**Prompt:**
> *"Build a customer-support agent **Aria** in `<project>` grounded in our help docs at `https://example.com` (add as knowledge), able to look things up via an MCP connector, and able to show a short contact form mid-conversation. Wire all the references, review it for quality, and promote to Preview."*

**Success criteria:** RELATIONAL agent; knowledge base added + referenced `@knowledge:<ref>;`; an **MCP connector** enabled (or MCP integration created) + referenced `@MCP:<ref>;`/`@mcp:...`; a **multimodal input** form + `@multimodal:<ref>;`; visual/voice/locale set; **all refs well-formed with trailing `;`**; quality self-review passes; promoted to Preview. PASS if every reference is valid and resolvable.

---

## Tier 3 — Operate & govern

**T3.A — Performance review.** Prompt: *"How are the agents in `<project>` doing over the last 30 days — and is the roleplay training actually improving reps?"*
✅ Pulls `get_analytics_summary` + **relational/judge scores** + **evaluation analytics**; expands the 30-day window to ISO; explains there's **no NPS** and uses judge scores + the four-dimension trends/deltas as the improvement signal.

**T3.B — Billing (read-only).** Prompt: *"Show `<tenant>`'s subscription, recent invoices, and how many conversation-minutes we used last week."*
✅ `get_subscription` + `list_invoices` (÷100 for display) + `get_usage` (minutes). **Must refuse / not attempt** to change a plan or pay — that's web-app only.

**T3.C — Team management.** Prompt: *"Add `teammate@example.com` to `<project>` as an Editor, show project members and their roles, then change someone to Viewer."*
✅ Owner-gated invite + role change; lists members; confirm where required.

**T3.D — Governance / rollback.** Prompt: *"`<agent>` regressed — show its revision history, compare the live Published vs latest Draft, and roll back to the last good revision."*
✅ `get_agent_revisions`; explains states; `revert_agent` (confirm), respecting that you can't revert below the live Preview/Published.

**T3.E — Iterate.** Prompt: *"Tighten `<agent>`'s guardrails and refresh its knowledge base, without losing any other config."*
✅ `edit_agent` stacks on the latest revision (only changed fields); knowledge refreshed; nothing else clobbered.

---

## Scorecard

| Task | Result (PASS / PARTIAL / FAIL) | Notes |
|---|---|---|
| T0.1–T0.3 connectivity | | |
| T1.1–T1.8 unit checks | | |
| **T2.A Empower full** ⭐ | | the flagship — weight heavily |
| T2.B Empower quick start | | |
| **T2.C Engage kiosk** ⭐ | | |
| T2.D Generic wired agent | | |
| T3.A analytics | | |
| T3.B billing | | |
| T3.C team | | |
| T3.D governance | | |
| T3.E iterate | | |

**Parity verdict:** the plugin matches the in-app copilot if Tier 2 passes — i.e. it can *build the Empower and Engage programs end-to-end with the correct structure*, not just call individual tools.

## Expected limitations (don't over-penalize)
- **Package tag** (`SALES_TRAINING`/`LEAD_ENGAGEMENT`) can't be set via the plugin — REST doesn't expose it. Build the structure; ignore the missing tag.
- **No archive/delete-agent tool** — Tier 2 leaves agents behind; clean up in the web app or use a sandbox.
- **File-upload knowledge** and **image/video binary upload** are UI-only — use URLs.
- **`getIdentityProviders`** isn't ported (minor).
- If the agent doesn't *know* the Empower/Engage workflow (intake, four-dimension rubric, handover routing), that's a **plugin guide gap**, not a tool gap — note it; it's fixable by adding a packages guide.
