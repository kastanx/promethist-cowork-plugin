# Promethist — interactive content / multimodal (operator guide)

Interactive Content (a.k.a. multimodal) = structured inline experiences inside a conversation — forms, images, videos, buttons/choices, web views, and agent handovers — that let a voice-first agent guide a user **beyond plain text or voice**. New plugin tools: `list_multimodal_interactions`, `get_multimodal_interaction`, `create_multimodal_interaction`, `edit_multimodal_interaction`, `delete_multimodal_interaction` (plus `edit_agent` to reference it). One creation tool covers all six types via a `type` parameter — there is no per-type tool.

## The six interaction types — and when to use each

| Type (`type=`) | What it is | Use when |
|---|---|---|
| `input` | A single typed input field (`Text`/`Number`/`Email`/`Date`) | You need ONE structured value from the user (email, a number, a date). |
| `choice` | A set of selectable options (buttons/cards) | The user should pick from a fixed list; each option has a `title` (and optional `description`/`imageUrl`). |
| `webpage` | An inline web view of a URL | You want to show an external page in-conversation. |
| `image` | An inline image by URL | You want to show a picture (already hosted at a URL). |
| `video` | An inline video by URL | You want to play a video (already hosted at a URL). |
| `handover` | Redirect the conversation to **another agent** | A different (published) agent should take over (e.g. coach → roleplay persona). |

## The load-bearing field distinction: `name` vs `title`

- **`name`** is the **internal name** — required, non-blank. On create the server **derives the `ref` from `name`** (`sanitizeToRef`). This is the identity used in `@multimodal:<ref>;` references.
- **`title`** is the **display title** shown to the user; optional (falls back to `name`).
- **Renaming gotcha:** changing `name` on edit **re-derives the `ref`** → it can change the interaction's identity and break existing `@multimodal:` references. To rename what the user sees, change **`title` only**. Change `name` deliberately, knowing references must be updated.
- **`tool_description`** is not a label — it is the **instruction used when the tool fires** (when/how the agent should use this interaction). It is **required for `handover`**.

## Creating — `create_multimodal_interaction(project_id, type, name, …)`

Pass `type` plus the fields that type uses; unrelated params are ignored. Per type:

- **`input`** → `name` (req), `title?`, `tool_description?`, `description?` (user-facing input description), `input_field_type` (`Text`|`Number`|`Email`|`Date`, default `Text`), `is_global?`.
- **`choice`** → `name` (req), `title?`, `tool_description?`, `description?`, `options` (required: `[{title, description?, imageUrl?}]`; minimal portable form `[{title:"…"}]`), `is_global?`.
- **`webpage` / `image` / `video`** → `name` (req), `title?`, `tool_description?`, `url?`, `is_global?`. **Never invent a URL** — if the user didn't give one, leave it empty; the content is filled dynamically at execution.
- **`handover`** → `name` (req), `title?` (shown to user), `tool_description` (**required**), `agent_key?`, `show_as_detail?` (default false), `is_global?`.

You can leave most fields empty — interactive content is allowed to be partially defined and completed dynamically during execution.

### Handover specifics (the most nuanced type)
- The target is set via **`agent_key`** = `"<agentRef>.<revision>"` of a **Published** agent — **NOT a raw agentId**. This is Claude-native: use `get_agent` / `get_agent_revisions` to find the published revision, then compose the key. If you pass nothing, the target is chosen **dynamically by context** at runtime.
- **Only published agents** can be handover targets. If the user names an unpublished agent, tell them and don't proceed (or create the handover with no target and warn: "publish the agent first, then edit the handover to link it").
- **`show_as_detail=true`** → the user sees the target agent's card/detail before the conversation starts (they see who they're about to talk to). **`false`** (default) jumps straight in.
- **Coaching → roleplay routing pattern (canonical):** create one handover per roleplay persona with **`is_global=false`** and **`show_as_detail=true`**; reference each explicitly on the coach with a per-persona routing line, e.g. `When the trainee wants the cold call, redirect to Martin: @multimodal:cold_call_martin;`. One routing line + one reference per persona — **never a bare reference with no context**. A global handover would be exposed to every agent and bypass the coach's routing.

## Reading

- **`list_multimodal_interactions(project_id)`** — all interactions. **The type is in `__typename`** (`Input|Webpage|Image|Video|Choice|Handover`) — note: read uses `__typename`, write uses `type` (different field names). Each row has `ref`, `name`, `title?`, `toolDescription?`, `isGlobal`, and type-specific fields.
- **`get_multimodal_interaction(project_id, ref)`** — one interaction. There is **no GET-by-single-ref endpoint** — the tool filters the list client-side.

## Editing — full replace, so read-modify-write

`edit_multimodal_interaction(project_id, ref, type, …)` is a **full-object PUT** — any field you don't set is **wiped**. The tool protects you by GET-ing the current interaction and merging your changes over it, so always go through the tool (never hand-build the body). Notes:
- Pass `type` equal to the existing interaction's type (the `__typename` lowercased). The nested body key MUST match the stored type or the server rejects it ("Missing input for type").
- Prefer changing `title` for a display rename; changing `name` re-derives `ref` (identity change — see above).
- Same handover/`agent_key` published-agent rule as create.

## Global vs non-global — the usability gate

- **`is_global=true`** (default) → available to **all** agents in the project. Prefer adding it explicitly to the agents that should use it anyway.
- **`is_global=false`** → **unusable until explicitly referenced** in at least one agent configuration. A non-global interaction that's never referenced is dead (the platform warns it's "not active yet — you have to add it to at least one agent").

## Referencing from an agent — `@multimodal:ref;`

This grants an agent access to an interaction. Edit the agent's text fields (`purpose` / `businessProcessSteps` / `guardrails`) via `edit_agent` and embed the reference:

- **Canonical form (trailing semicolon mandatory, regex-enforced `@multimodal:([\w-]+);`):** `@multimodal:multimodal_ref;` (same family: `@knowledge:ref;`, `@MCP:ref;` — all end with `;`).
- The `ref` must be the **exact** ref (from `list_multimodal_interactions` or the create result); placeholder/nonexistent refs are flagged broken; a missing `;` makes it silently inert.
- An agent uses only **global** interactions or ones it **explicitly references**. So after creating an interaction an agent should use, **immediately reference it** with a one-line usage instruction (when/how to use it) — automatically, no confirmation needed. For a **non-global** interaction this reference is what makes it usable at all.
- Never add references for interactions the agent doesn't need, and never invent refs.

## Deleting

- **`delete_multimodal_interaction(project_id, ref, confirm: true)`** — permanently deletes the interaction; cannot be undone. There is **no server-side confirm dialog** over REST, so `confirm: true` is the only guard — surface the deletion to the user before passing it.

## GAPs — file uploads (UI only)

Creating an `image`/`video` **by URL** is fully supported via `create`/`edit` (this is exactly what the in-app tools do). **Uploading new image/video bytes from local disk is a GAP** — it needs the multipart endpoints `POST /api/v1/project/multimodality-image` / `…-video` (which also require the interaction to already exist), and a remote MCP server has no local file access. Direct the user to upload the asset in the platform UI (or host it somewhere and pass the `url`).

## Tool quick-reference

| Task | Tool |
|---|---|
| List interactions | `list_multimodal_interactions(project_id)` |
| Inspect one | `get_multimodal_interaction(project_id, ref)` |
| Create (any type) | `create_multimodal_interaction(project_id, type, name, …)` |
| Edit (read-modify-write) | `edit_multimodal_interaction(project_id, ref, type, …)` |
| Delete | `delete_multimodal_interaction(…, confirm: true)` |
| Resolve handover target key | **Claude-native — `get_agent` / `get_agent_revisions` → `<ref>.<revision>`** |
| Upload image/video bytes | **UI only — no plugin tool (URL is supported)** |
| Make it usable by an agent | `edit_agent` + `@multimodal:<ref>;` |
