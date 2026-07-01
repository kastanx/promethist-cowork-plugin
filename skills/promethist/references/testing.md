# Promethist — testing an agent (live roleplay)

Reading an agent's config catches *missing* fields. It does NOT catch *behavioral* problems — the ones that ruin a real interaction: the agent fires the wrong interactive element, says "let me show you…" and shows nothing, gives shallow answers, ignores what the user asked, or railroads them down a script. The only way to surface those is to talk to the running agent like a real, unpredictable user. The `test_agent` tool connects to the live engine and holds an actual conversation, one turn per call, so you react turn by turn.

Works for ANY agent — coach, sales-roleplay persona, support assistant, kiosk, guide. Don't assume a domain; derive the scenario from the agent's own purpose.

## When to use
- The user asks to test / try / QA / "talk to" / break / get feedback on an agent.
- Proactively, right after `create_agent` or `edit_agent`, and BEFORE `promote_agent_to_preview` / `_published`. Offer it: "Want me to roleplay a few users against it before you promote it?"

## Step 0 — read the agent first (targeted testing)
Before talking to it, call `get_agent` (and look at its knowledge / multimodal interactions / integrations / handovers) to learn:
- its **purpose, persona, and business process** — defines who you should roleplay and what "correct" looks like;
- every **interactive/multimodal element, tool, knowledge source, and handover** it has — so you can deliberately try to trigger each and confirm the *right* one fires (and that nothing fires when it shouldn't).
Let the agent's own config drive your personas and probes — not a fixed template.

## How to drive it (`test_agent`)
- ONE call = ONE turn. The conversation persists internally (a session label threads turns), so **call repeatedly and write each next line from the reply you just read**.
- Start each persona with `message="#intro"` + `new=true` (triggers the agent's opening, fresh session). Then continue with `new` omitted.
- Test a **Published / live-Preview** agent with `agent_ref`. Test a **Draft / specific revision** with `agent_ref` + `revision` (from `get_agent` / `get_agent_revisions`). Drafts are fully testable — no need to promote first.
- Use a **distinct `session` label per persona** so scenarios don't bleed together (and you can run personas independently).
- Read the markers in each reply: `⟦tool: X⟧` = a tool/element was invoked; `⟦shows: X⟧` = an interactive element was actually shown. This is how you verify the *right* element fired (or that one fired at all).
- If a turn behaves oddly, re-run it with `diagnose=true` to see the reasoning→realtime hand-off (`⟦plan⟧` / `⟦instruction⟧`) — i.e. WHY the answer came out as it did.

## Methodology — roleplay, do NOT pre-script
The trap: deciding all your messages up front. That only proves the system is *up*. Instead adopt a persona with a goal that fits the agent's purpose, read each reply, and choose your next line from what the agent actually said — including behaving like real, imperfect users.

Pick 1–3 personas spanning different *behaviours* (instantiated in the agent's actual domain):
- a user with a clear, specific goal who wants to complete a task;
- a user who keeps changing the subject and won't follow a script;
- a terse, one-word responder;
- a skeptic who pushes back, provokes, or tries to break it;
- a user who wants something **outside** the agent's scope.

Across ~5–10 turns, deliberately exercise the behaviours that expose real failures:
- change subject mid-thread — does it follow you?
- request something **not** in its content/scope;
- try to trigger **each** interactive element/tool, and confirm the correct one fires;
- ask something where **no** element should fire (pure conversation) — check it doesn't fire one anyway;
- give a vague/ambiguous answer — does it clarify?
- raise an edge/provocative/misinformation question — does it stay accurate, safe, on-policy?
- for relational agents, revisit an earlier topic to test memory / building on prior turns;
- push one task all the way to completion (including the closing/farewell).

Watch for the common failures:
- **Wrong element fires** (shows/calls the wrong interaction or tool).
- **Over-promising:** "let me show you…" but nothing displays (often a runtime / dynamic-URL issue — interactive content needs a concrete, resolvable target).
- **Shallow/generic** answers; not building on earlier turns.
- **Railroading:** dragging the user back to a script instead of following them.
- **Spamming** elements/links every turn.
- **Scope or accuracy slips**, unsafe or inappropriate handling.

## Output — stream the WHOLE conversation, both sides
Never report only a verdict like "it works." The user needs to see the actual dialogue.
- **Show both sides of every turn, verbatim** — your `You:` line AND the agent's `Agent:` reply (the tool prints both; relay exactly, including the `⟦tool/shows⟧` markers). Don't hide your messages.
- **Stream it turn by turn** as it unfolds, so the user can follow and redirect you — not one dump at the end.
- **Keep showing the agent's words to the very end** — don't trail off into paraphrase on the last turns.
- After the run, add a short findings list separating what worked from concrete issues, **quoting the agent's own words** for each issue.

## Then propose changes in plain language (no tool names)
Describe fixes the way the user thinks about them — *what* should change, not which API does it. For each issue, say plainly which part to adjust and how:
- the **persona / how it speaks**;
- the **conversation flow** (a step that should behave differently);
- a **rule / guardrail** (something it should always/never do);
- an **interactive element** (which one, and *when* it should appear — e.g. "show the shop link as soon as the parent asks where to buy, not only when they ask for a link");
- a **knowledge gap** (a fact it stated that isn't in its sources, or a question it couldn't answer).
Give concrete wording where it helps, then offer to make the changes (`edit_agent`) and **re-run the same scenario** to confirm the fix. Iterate.

## Etiquette & speed
- No secrets needed — the engine pipeline is public; `test_agent` handles it.
- Fresh session per persona (`new=true`); keep runs short (real sessions = real usage).
- Text-only + stop-at-`#response-end` are built in (≈halves per-turn latency). Keep each turn purposeful.
