# Agent quality-review rubric

Use this to self-review an agent (fetch it with `get_agent`) before promoting it. There are two layers: a **deterministic completeness checklist** (mechanical blockers/warnings) and the **qualitative criteria** a reviewer LLM applies.

## Layer 1 — deterministic completeness checklist

### Blockers (the agent cannot function — must fix)
- **No purpose set** — "The agent's objective isn't defined yet — set its purpose." Purpose is required.
- **No identity description** — "The agent has no personality or backstory. Add an identity description to make it feel human and relatable." Identity is required.
- **No supported languages / locales** — "No supported languages are configured — the agent can't hold conversations yet." `locales` must be non-empty.
- **No voice** — "No voice is configured — the agent won't be able to speak." `voice_id` / realtime configuration must be set.
- **Broken tool references:**
  - References to tools that don't exist in the project: "The agent references tools that don't exist in this project: …"
  - Malformed references: "Some tool references are incorrectly formatted and won't work: …"
  - Valid reference pattern: `@(knowledge|MCP|multimodal|extractor|skill):([\w-]+);` — every ref must match and resolve to a real project asset.

### Warnings (degraded quality — should fix)
- **No guardrails** — "No guardrails are set. Define boundaries to keep conversations on-brand and professional."
- **No business process** (RELATIONAL only) — "The conversation flow hasn't been defined yet. Add a business process." A relational agent without a flow won't behave consistently.
- **No avatar / visual appearance** — "The agent has no avatar or visual appearance assigned." (`visual_properties` and `visualRef` both empty.)

### Consistency checks (mechanical)
- **Gender** consistent across name, identity, avatar, and voice.
- **Locale ↔ voice**: every configured locale must be supported by the selected voice; unsupported locales should be sanitized to English (produces a locale warning).
- **Name propagation**: if the agent name changed, no field should still mention the old name.

## Layer 2 — qualitative review criteria

This agent definition trains a digital employee embedded as a system prompt before user interactions. Evaluate how well its fields **teach the agent its job** and enable consistent, purposeful behavior.

1. **Identity** — Are the traits, tone, and background **vivid, coherent, and aligned with the role**? (Not generic "helpful/friendly"; a real backstory, a defined linguistic style, concrete values.)
2. **Purpose** — Are the main and sub-objectives **clear, actionable, and motivating the correct behavior**? (Opens with "You are [name], [role] for [context]"; one primary objective; 2–5 concrete sub-objectives.)
3. **Business Process Steps** — Are the steps **logical, complete, and making good use of referenced assets** (`@knowledge`, `@multimodal`, `@MCP`)? (Numbered flow; opens with a welcome step; ends with an explicit farewell step; each step has a concrete example utterance.)
4. **Guardrails** — Do they **effectively set safe, professional, and brand-consistent limits**? (5–12 imperative rules covering hard prohibitions, sensitive topics, scope redirects, source restrictions, deployment policies.)
5. **Overall Effectiveness** — Would this configuration **reliably guide an LLM to act as intended** in conversation?

### Cross-field qualities to confirm
- **No fluff / domain-grounded:** identity, purpose, process, and guardrails reflect the specific industry and use case — not generic descriptions.
- **One field, one purpose:** no content repeated across fields; no contradictions.
- **Second person / imperative / English** throughout (agent config in English even when it speaks another language).
- **Asset use is real:** every `@type:ref;` resolves to an existing tool, is referenced with usage instructions, and is genuinely used by a step or rule — not a placeholder.
- **Voice/visual/locale coherence:** voice supports all locales; gender matches across name/identity/avatar/voice; an avatar and environment are assigned.

### Review output shape
1. **Readiness Summary** — 2–3 sentences, in plain business language, on whether the agent is ready to deliver effective conversations.
2. **Next Steps** — a concise, specific list of improvements in plain business language. For **template-locked fields**, note if the template content *could* be improved, but do not suggest modifying them as agent-level fields.

## Project-level readiness (when reviewing a whole project)

### Default project
- **Agent coverage** — do the agents address the project's purpose and use cases?
- **Configuration quality** — clear purpose, identity, business process per agent?
- **Asset usage** — are knowledge bases, integrations, and tools actually referenced in agent configs?
- **Overall readiness** — ready for end users?

### Empower (sales-training) project
- **Completeness** — is a Coaching Agent present and set as featured? Enough diverse roleplaying agents, handovers, and evaluations?
- **Agent diversity** — do roleplaying agents cover varied scenarios, temperaments, and difficulty levels?
- **Workflow integrity** — are handovers and evaluations wired correctly to support the coaching loop (coach→roleplay handovers referenced on the coach with distinct tool descriptions; one shared roleplay→coach handover; evaluations attached to roleplay agents only, delivered to the coach via `featuredAgent`)?
- **Asset usage** — are knowledge bases, integrations, and tools actually referenced?
- **Overall readiness** — ready for trainees?

Output the same two-part shape: a Readiness Summary (2–3 sentences, plain business language) and a specific Next Steps list.
