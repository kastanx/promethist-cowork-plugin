---
name: test-agent
description: Interactively test a Promethist voice agent by holding a real, multi-turn roleplay conversation with the live agent (not a scripted smoke test), observing which interactive content / multimodal elements, tools, and knowledge actually fire, and then proposing concrete configuration fixes. Use this whenever the user asks to test, try, QA, "talk to", break, or get feedback on a Promethist agent of any kind — coaching, sales roleplay, customer-facing assistant, guide, etc. — and proactively offer to run it right after you create or edit an agent and before promoting it to preview or published, because a config can pass static review yet still behave wrong in conversation (wrong element fires, over-promising, shallow answers, railroading, ignoring the user).
---

# Test a Promethist agent (live roleplay)

## Why this exists
Reading an agent's configuration catches *missing* fields. It does not catch *behavioral* problems, which are the ones that ruin a real interaction: the agent fires the wrong interactive element, promises "let me show you…" and shows nothing, gives shallow answers, ignores what the user actually asked, or railroads them down a script. The only way to surface those is to talk to the running agent like a real, unpredictable user. This skill connects to the live pipeline and holds an actual conversation, reacting turn by turn.

This works for **any** Promethist agent — a coach, a sales-roleplay persona, a support assistant, a guide. Do not assume a domain; derive the scenario from the agent's own purpose.

## When to use
- The user asks to test / try / QA / "talk to" / break / get feedback on an agent.
- Proactively, right after `create_agent` or `edit_agent`, and before `promote_agent_to_preview` / `promote_agent_to_published`. Offer it: "Want me to roleplay a few users against it before you promote it?"

## Step 0 — read the agent first, so testing is targeted
Before talking to it, call `get_agent` (and list its knowledge / multimodal interactions / tools) to learn:
- its **purpose, persona, and business process** — this defines who you should roleplay and what "correct" looks like;
- every **interactive/multimodal element, tool, knowledge source, and handover** it has — so you can deliberately try to trigger each one and confirm the *right* one fires (and that nothing fires when it shouldn't).
Let the agent's own configuration drive your personas and probes — not a fixed template.

## Prerequisites
- The agent must be reachable on the engine. Key format:
  - **Published** (or the live Preview): `agent:<agentRef>`.
  - **A specific Draft / any revision:** `agent:<agentRef>.<revision>` — e.g. `agent:thomasJefferson.8`. Drafts are fully testable; just append the revision number from `get_agent` / `get_agent_revisions`.
- The **engine base URL** (e.g. `https://eu.promethist.ai`).
- `bash` + `curl`. The bundled `scripts/agent_chat.sh` wraps the call.
- **Secrets:** if the engine requires an auth token, do NOT enter or store the secret yourself — ask the user to run the script locally with their token, or to provide non-secret access. Never paste credentials into the command.

## How the conversation works (protocol)
- The pipeline endpoint is `GET {url}/api/pipeline/{key}` with query params `text=<msg>`, `locale=<tag>`, and `outputFormat=TEXT&inputFormat=TEXT&textOnly=true`.
- **Session continuity is a cookie-jar file** (`curl -b/-c`). Each shell call is independent, so the cookie file on disk keeps the conversation alive — **one script call = one turn**. This is the trick that lets you react between turns instead of pre-scripting.
- Start every conversation by sending `#intro` (triggers the agent's opening). Use `--new` for a fresh session per persona.
- The response stream mixes spoken text with control frames. **Reading those frames is the whole point**:
  - `#tool-call ... name=<...>` — the agent invoked a tool / interactive element.
  - `#multimodal-interaction ... "ref":"<ref>"` — the interactive/multimodal element actually shown. This is how you verify the *right* element fired (or that one fired at all).
  - Noise to ignore: `#speech-item`, `#binary` (audio), `#visual-state`, `#ready`, `#transcript`, `#response-end`, `#exit`, `#realtime-*`, and any long `Supporting citations:` block (raw retrieval text, never spoken).
- The bundled script strips the noise and annotates firings as `⟦tool: X⟧` / `⟦shows: X⟧`.

## Running it
Drive it one message per call (cookie persists between calls):

```
bash scripts/agent_chat.sh --url <engine-url> --key agent:<ref> --new "#intro"
bash scripts/agent_chat.sh --url <engine-url> --key agent:<ref> "<your next line, written from the reply you just read>"
```

For a draft: `--key agent:<ref>.<revision>`. Drop `--new` after the first call to continue the session. A human can run it with no message for an interactive `You:` prompt. Add `--raw` to see unfiltered frames when debugging.

## Methodology — roleplay, do not pre-script
The trap to avoid: deciding all your messages up front. That only proves the system is *up*. Instead **adopt a persona with a goal that fits the agent's purpose**, read each reply, and choose your next line from what the agent actually said — including behaving the way real, imperfect users do.

Pick 1–3 personas spanning different *behaviours* (instantiate them in the agent's actual domain):
- a user with a clear, specific goal who wants to complete a task;
- a user who keeps changing the subject and won't follow a script;
- a terse, minimal responder who gives one-word answers;
- a skeptic who pushes back, provokes, or tries to break the agent;
- a user who wants something **outside** the agent's defined scope.

Across ~5–10 turns, deliberately exercise the behaviours that expose real failures — adapted to what this agent is for:
- change subject mid-thread and see if it follows you;
- request something that is **not** in the agent's content/scope;
- try to trigger **each** interactive element/tool it has, and confirm the correct one fires;
- ask something where **no** element should fire (pure conversation) — check it doesn't fire one anyway;
- give a vague or ambiguous answer and see if it clarifies;
- raise an edge / provocative / misinformation question and check it stays accurate, safe, and on-policy;
- for relational agents, revisit an earlier topic to test memory and whether it builds on prior turns;
- push one task all the way to completion (including the closing/farewell step).

Watch for the common failures:
- **Wrong element fires** (it shows/calls the wrong interaction or tool for the request).
- **Over-promising:** says "let me show you…" but nothing is displayed (often a runtime/dynamic-URL issue — interactive content needs a concrete, resolvable target to render).
- **Shallow/generic** answers; not building on earlier turns.
- **Railroading:** dragging the user back to a script instead of following them.
- **Spamming** interactive elements/links on every turn.
- **Scope or accuracy slips**, and unsafe or inappropriate handling.

## Output — stream the WHOLE conversation, both sides
Never report only a verdict like "it works." The user needs to see the actual dialogue, live, without digging through tool output.
- **Show both sides of every turn, verbatim.** Print your own `You:` line AND the agent's `Agent:` reply for each exchange — the bundled script already prints both, so relay exactly what it outputs (including the `⟦tool/shows⟧` markers). Don't hide your messages inside the command; the reader must see what you said.
- **Stream it turn by turn** as the conversation unfolds, so the user can follow along and redirect you — not one big dump at the end.
- **Keep showing the agent's words to the very end.** Don't trail off into paraphrase or summary on the last turns — every turn, including the closing one, shows the agent's actual reply.
- After the run, add a short findings list separating what worked from concrete issues, quoting the agent's own words for each issue.


## Then propose changes in plain language (no tool names)
Describe the configuration changes you recommend the way the user thinks about them — not which API or tool does it. The user cares about *what* should change, not the mechanism. For each issue, say plainly which part of the agent to adjust and how:
- the **persona / how it speaks**;
- the **conversation flow** (a step that should behave differently);
- a **rule / guardrail** (something it should always or never do);
- an **interactive element** (which one, and *when* it should appear — e.g. "show the official-shop link as soon as the parent asks where to buy the uniform, not only when they ask for a link");
- a **knowledge gap** (a fact it stated that isn't in its sources, or a question it couldn't answer).
Give concrete wording where it helps, then offer to make the changes and **re-run the same scenario** to confirm the fix. Iterate.


## Speed — keep it snappy
Per-turn latency is the agent generating its response server-side. Two things already cut it, both built into the bundled script:
- **Text only, no audio.** The call requests text output; the agent skips streaming speech, which would otherwise be the bulk of the payload.
- **Stop at `#response-end`.** The answer is complete at `#response-end`, but the server holds the stream open several more seconds to plan the *next* turn — dead time for a tester. The script stops reading there and drops the connection, which roughly halves wall-clock per turn. (Session continuity is unaffected: it lives in the cookie jar, and the server finishes its planning regardless.)
Beyond that:
- **Keep turns purposeful** — each message should probe something specific; avoid filler.
- **Run personas in parallel, not in series.** Different personas are independent conversations — give each its own `--session <file>` and run them concurrently rather than waiting for one to finish. A 3-persona suite then costs about one conversation's wall-clock instead of three.
- The remaining per-turn time is the model itself; if it's consistently painful, ask the platform team whether a lighter/non-realtime path exists for testing.


## Etiquette
- Never enter or store the user's secret tokens / API keys. If auth is required, have the user run the script.
- Use a fresh session per persona (`--new`) so scenarios don't bleed together.
- Testing a live agent creates real sessions/usage — keep runs reasonably short.