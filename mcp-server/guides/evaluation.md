# Promethist — evaluations & output data elements (operator guide)

How to design, create, and attach **evaluations** through the MCP plugin. Terminology: internally these are "insights", but the user-facing term is **"output data elements"** — always call them that. New plugin tools: `list_evaluations`, `get_evaluation`, `create_evaluation`, `edit_evaluation`, `add_insight`, `edit_insight`, `remove_insight`, `delete_evaluation` (and `edit_agent` to attach them).

## What an evaluation is

An evaluation is a defined metric an agent measures during conversations (alongside its default relational goals). Each evaluation defines three things:
- **when it runs** (execution mode),
- **what output data elements it produces** (the extracted values),
- **where the results go** (destinations).

**One topic per evaluation.** Keep each evaluation focused on a single subject; put all related output data elements for that topic inside it. Use a separate evaluation for a separate topic.

## Output data elements — the four types

An output data element is a value extracted from the conversation. Every element has three shared fields:
- **`name`** — the label shown in the UI.
- **`description`** — what is measured/extracted/classified.
- **`prompt`** — the instruction handed to the evaluator LLM (this IS the per-element evaluator instruction; there is no separate evaluator prompt).

The four types (the `type` param on `add_insight`; input enum values are `Bool|Number|Text|TextList`):

| Type | Use it for | Extra fields |
|---|---|---|
| **Bool** | A yes/no outcome with custom labels | `true_text` (e.g. "Resolved"), `false_text` (e.g. "Not resolved") |
| **Number** | A numeric score within a fixed range | `min_value`, `max_value` (require `min_value <= max_value`; stored as integers) |
| **Text** | A free-text value | — |
| **TextList** | Single-select classification into a predefined set | `values: ["billing","technical","general"]` (required) |

When to pick which: yes/no judgment → **Bool**; a rating/score on a scale → **Number**; an open extracted answer/summary → **Text**; bucketing the conversation into exactly one of N labels → **TextList** (it is single-select, not multi).

## How to write a good output data element

- **One subject per element.** Each element must measure **either user behaviour or agent performance — never both.**
- **State the subject explicitly in the `prompt`** (e.g. "Evaluate the USER's responses…") so the evaluator LLM scores the right speaker. In roleplay/training scenarios the subject is the **USER** (the trainee), not the agent — default to evaluating the trainee (knowledge accuracy, objection handling, tone, process adherence).
- **Knowledge-accuracy elements need a reference.** There is no ground truth for "was the trainee correct" without source material (playbooks, rubrics, product sheets, training docs). Ask the user for it first; suggest uploading it to the knowledge base (`add_web_knowledge`) before authoring such an element.
- For **Number** elements, always anchor the scale in the `prompt` (what each end of the range means) — a bare "score 1–10" is unreliable.
- For **TextList**, make the `values` mutually distinct and exhaustive for the topic so the classifier always has exactly one right bucket.

## Authoring workflow & a critical REST gotcha

The clean flow mirrors the in-app copilot: **create the evaluation first (no elements), then add elements one at a time.**

1. `create_evaluation(project_id, name, …)` — set `insights: []` (default). Pick execution mode + destinations now (see below).
2. `add_insight(project_id, evaluation_id, type, name, description, prompt, …type-specific…)` per element.
3. Attach the evaluation to at least one agent with `edit_agent(evaluation_definition_ids=[…])` — **an evaluation does nothing until attached.**

**The gotcha (read this):** there is no per-element REST endpoint. Under the hood, **every** element mutation — `add_insight`, `edit_insight`, `remove_insight`, and even a definition-only `edit_evaluation` — is a full read-modify-write of the entire evaluation: the plugin GETs it, mutates the elements array, and PUTs the whole thing back. The server **deletes and recreates ALL elements** on every PUT. Consequences:
- **Element `ref`s and ids are NOT stable.** After any of these calls, every element's `ref` is regenerated from its name. So when you need to target an element by `insight_ref` (`edit_insight`/`remove_insight`), **re-fetch with `get_evaluation` immediately before** to get current refs. Don't cache a ref across a mutation.
- The plugin handles type translation for you (output types `boolean/number/text/list` ↔ input types `Bool/Number/Text/TextList`) — you never send the wrong enum — but be aware a manual hand-built PUT would fail Jackson if you echoed output type names.
- `edit_evaluation` carries existing elements through automatically; you only pass the definition fields you want to change. You do **not** need to re-list elements on a definition edit.

## Execution modes — when an evaluation runs

At least one mode is required. If both are set, it runs every turn **and** once more at conversation end.

**`ON_CONVERSATION_END`** — runs once when the conversation ends. Use when results should be visible in another session or in analytics/admin. **Requires at least one destination:**
- `session_agent` — injected into the next session of the **same** agent.
- `inject_into_featured_agent` — injected into the next session of the **project featured agent**.
- `admin_facing` — visible in platform analytics (default `true`).
- `user_facing` — surfaced to the end user in the app.
- `webhook_url` (+ `webhook_headers`) — POSTed to an external system.

**`PER_TURN`** — runs after every turn, evaluating only the last `lookback_window` messages. Use when the agent should see continuously-updating results during the session. Rules:
- `lookback_window` = `START_TO_NOW` (whole conversation so far) or `LAST_4` (last 4 messages).
- **Destinations are NOT allowed for PER_TURN.** Results are available within the same session only.

Server normalisation to expect: empty `execution_modes` defaults to `[ON_CONVERSATION_END]`; `lookback_window` is ignored unless `PER_TURN` is present; all ON_CONVERSATION_END flags/webhook are zeroed unless `ON_CONVERSATION_END` is present.

## How evaluations attach to agents (attachment ≠ access)

- Attach via `edit_agent(evaluation_definition_ids=[…])`. Attaching makes the evaluation **run** for that agent — but it does **not** guarantee the agent can **access** the result.
- **PER_TURN** → result available during the same session.
- **ON_CONVERSATION_END** → available in the agent's next session **only if `session_agent=true`**; otherwise not accessible to that agent.
- **Deliver results to a *different* agent** (e.g. a Coach reads a roleplay's scores): set that agent as the **project featured agent**, set `inject_into_featured_agent=true` on the evaluation, and do **NOT** attach it to the featured agent via `evaluation_definition_ids` (it gets results automatically at the next session start). Only one featured agent per project.

## Empower (SALES_TRAINING) — the four-dimension roleplay evaluator

For Empower projects the strong default is **one evaluation attached only to the Roleplaying Agents**, scoring the trainee (the USER) on four dimensions, each scored **in isolation**:
- **Knowledge Accuracy** — what the trainee *says* (content correctness only).
- **Methodological Execution** — what the trainee *does* (target behaviours present, sequenced, well-timed). A right answer at the wrong moment = Knowledge Accuracy success + Methodological Execution failure.
- **Delivery Quality** — *how* they communicate (structural clarity + paralinguistic composure).
- **Client Attunement** — whether they detected and responded to client signals.

Fixed output shape (max 10 elements when all four dimensions are active): per active dimension a pair — `<dim> Explanation` (**Text**, cite conversation evidence) and `<dim> Score` (**Number**, 1–6) — plus `Weighted Final Score` (**Number**, 1–6; weighted avg of scored dims, N/A excluded) and `Simulation Passed` (**Bool**, Passed/Failed; true when Weighted Final Score ≥ 4.0 **and** every scored dimension ≥ 3).

Scoring scale 1–6, three bands: **1–2 Inadequate**, **3–4 Acceptable to Solid** (the expected band for a developing practitioner), **5–6 Exceptional** (rare — resist score inflation). Dimensions a scenario doesn't test get **N/A** (excluded from the weighted average), not a 1. Weights must sum to 100% (default 25/25/25/25). Save with mode `ON_CONVERSATION_END`, destinations **`admin_facing` + `inject_into_featured_agent`** — explicitly **NOT** `user_facing` (the roleplay agent never debriefs; the Coaching Agent delivers feedback via the featured destination). Attach to each Roleplaying Agent via `edit_agent`; the Coaching Agent (featured) receives results automatically.

## Deleting

- **`remove_insight(project_id, evaluation_id, insight_ref, confirm: true)`** — drops one element. Data loss, no server undo → requires `confirm: true`. (Internally a full-array PUT minus that element; remaining refs regenerate.)
- **`delete_evaluation(project_id, evaluation_id, confirm: true)`** — deletes the evaluation **and all its output data elements**. Irreversible → requires `confirm: true`. There is no in-app confirm dialog over REST; the `confirm` flag is the only guard. Surface the action to the user before passing `confirm: true`.

## Tool quick-reference

| Task | Tool |
|---|---|
| See all evaluations + their elements | `list_evaluations(project_id)` |
| Inspect one (and read current refs) | `get_evaluation(project_id, evaluation_id)` |
| Create (elements empty; add after) | `create_evaluation(project_id, name, …)` |
| Change settings (mode/destinations/prompt) | `edit_evaluation(project_id, evaluation_id, …)` — carries elements through |
| Add an output data element | `add_insight(project_id, evaluation_id, type, …)` |
| Edit one (re-fetch ref first) | `edit_insight(project_id, evaluation_id, insight_ref, …)` |
| Remove one | `remove_insight(…, confirm: true)` |
| Delete the whole evaluation | `delete_evaluation(…, confirm: true)` |
| Make it run | attach via `edit_agent(evaluation_definition_ids=[…])` |
