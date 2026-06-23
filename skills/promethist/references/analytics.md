# Promethist — analytics (operator guide)

How to query and interpret a project's/agent's analytics through the MCP plugin. Tools: `get_analytics_summary`, `get_conversation_analytics`, `get_usage_analytics`, `get_user_analytics`, `get_relational_analytics`, `get_multimodal_analytics`, `get_evaluation_analytics`, `get_extractor_analytics`, `list_analytics_users`, `export_analytics`.

All analytics are **aggregate** reads scoped to a **project** (optionally narrowed to one agent and/or one user). They require the **viewer** role on the project. You can view stats for all agents in a project or for a specific one; for Preview/Published agents you can also look at an older `agent_revision` and compare versions.

## What you CAN and CANNOT see

- **CAN:** all the aggregate metrics below.
- **CANNOT:** the per-session **conversation list** (date / user / short summary). The metric tools never return it, and `get_analytics_summary` explicitly excludes it. The only way to get the full session list + per-session evaluation results is `export_analytics` — and that is privacy-gated (see below).

## The metric taxonomy

These are the real metrics the platform computes (richer than the prose UI describes):

**Conversation counts** — `get_conversation_analytics`
- `totalSessionsInPeriod` (+ `totalSessionsChange` %) — every session.
- `conversationsInPeriod` — sessions where **the user actually spoke** (a "conversation" requires user speech).
- `longConversationsInPeriod` — conversations with **5+ turns** (fixed threshold; a proxy for depth/engagement).
- `totalConversationsLifetime`.

**Usage / minutes** — `get_usage_analytics`
- Total/avg conversation **length in SECONDS** (+ change %), lifetime variants, and `avgTurnCount` (+ change, lifetime).
- This is where "usage / minutes / how long do conversations run" lives. **Length is in seconds — divide by 60 for minutes.** (Billing "minutes" is a separate tenant-level number from `get_usage` in the billing guide; this one is the conversation-length metric.)

**Users** — `get_user_analytics`
- `mau` (+ change), `wau`, `dau`, `uniqueForPeriod`, `lifetime` unique users.

**Relational + business metrics (LLM-judge scores)** — `get_relational_analytics`
These are scored by LLM judges and are the platform's **satisfaction/quality signal**. Relational:
- **Interaction Style Matching** — how well the agent mirrors the user's communication style, tone, verbosity.
- **Build Relationship** — how well it maintains a positive, respectful, emotionally supportive connection.
- **User Engagement** — how well it detects/responds to disengagement to sustain flow.
- **User Empowerment** — how well it helps the user grow, learn, gain independence beyond the task.
- **Task Completion** — how completely/correctly/efficiently it solves the request per the business process.

Business:
- **Business Fulfilment Rate** (a.k.a. Purpose Completion, binary 0/1 per conversation, aggregated) — was the conversation's overall purpose fulfilled.
- **Business Process Adherence** — how accurately the agent followed the defined business process.

**Multimodal executions** — `get_multimodal_analytics`
- Per multimodal `ref`: `totalExecutedCount` (+ parameter/action breakdowns). Returns a JSON **array**; empty ⇒ no multimodal content in the project.

**Evaluation outcomes** — `get_evaluation_analytics`
- The results of the project's evaluations / output data elements (see `get_guide('evaluation')`), grouped by element type:
  - `booleans[]` — per-element pass/fail **session counts**.
  - `numbers[]` — per-element **avg / min / max**.
  - `texts[]` — sampled free-text values.
  - `textLists[]` — **category frequency histograms** (classification distributions).
- This is the richer DTO; prefer it over the raw aggregation the in-app summary shows.

**Custom-extractor trends** — `get_extractor_analytics`
- Per custom extractor: `extractorRef`, `displayName`, `type`, and `trends` (time-bucketed `{from,to}` buckets) — e.g. behavior of users who spend a given time in the app. Note: this endpoint is a POST that performs a READ and returns HTTP 201; it does **not** mutate anything.

**User list (no metric)** — `list_analytics_users`
- A paginated, searchable list of the project's users. Keyset paging: pass `nextOffset` back as `offset`, stop when `hasMore` is false. `limit` 1–500 (default 200). **No date/agent filters** here.

## NPS — there is none

There is **no NPS metric** in Promethist. "NPS" appears only as a planning *proxy* concept in prose, never as a measured number. If a user asks for NPS / CSAT / "would they recommend it" / a satisfaction score, answer with:
1. `get_relational_analytics` (the LLM-judge relational + business scores — the closest first-class signal), and/or
2. `get_evaluation_analytics` boolean outcomes if the project defined a satisfaction-style output data element.
Say plainly that there is no literal NPS; these are the substitutes.

## How to query

Start with **`get_analytics_summary`** for "how is my agent/project doing" — it fans out conversation + usage + user + relational + multimodal + evaluation metrics in one call and merges them (it excludes the session list). Then drill into a specific tool for detail.

**Scope params** (all metric tools): `project_id` (required). Narrow with `agent_ref` (+ `agent_revision` to pin/compare a version of a Preview/Published agent), `agent_state` (`Draft|Preview|Published`, supported on multimodal/evaluations/extractors), and `user_id` to focus on one user. Omit them for the whole project.

**Time window** — `from` / `to`, ISO-8601 date-time **with offset**, e.g. `2026-06-01T00:00:00Z`. The REST API does NOT understand `7d`/`30d`/`from:…,to:…` shorthand — that is in-app sugar only. Expand relative windows yourself before calling:
- `7d` ⇒ `from = now − 7 days`, `to = now`.
- `30d` ⇒ `from = now − 30 days`, `to = now`.
- `from:2026-06-01,to:2026-06-10` ⇒ `from=2026-06-01T00:00:00Z`, `to=2026-06-10T23:59:59Z`.
- Omit both ⇒ the server applies its own default reporting period.

## Interpreting deltas

Change fields are percentages vs. the previous comparable period: `null` ⇒ "n/a" (no prior data), `+x.x%` up, `-x.x%` down, `0%` flat. When the user doesn't ask for a specific metric, lead with the most interesting/important current results (a big swing in sessions, a low relational score, a drop in fulfilment rate) rather than dumping every number.

## Exporting (sensitive)

`export_analytics` is the **only** source of the full per-session conversation list + per-session evaluation results (it includes user identities). It requires a **mandatory bounded range** (`from` < `to`) and a `format` (`xlsx|csv|json`). Prefer `format=json` if you need to read it in-context (xlsx/csv come back as binary you can't read inline — offer those for the user to download in the web app instead). It can return **403 even for a viewer** when the account's "Display full conversation data" privacy toggle is off — if that happens, tell the user to enable it in the web app; do not retry.

---
