# Promethist — knowledge bases (operator guide)

How knowledge gives agents factual grounding, what's usable through the plugin vs. UI-only, and how to wire it to an agent. New plugin tools: `list_knowledge`, `get_knowledge_spec`, `get_knowledge`, `add_web_knowledge`, `refresh_web_knowledge`, `edit_knowledge`, `delete_knowledge` (plus `edit_agent` to reference it).

## What knowledge is

Knowledge bases are repositories of content (documents, FAQs, product data, troubleshooting guides, web sources) that give agents **factual grounding** — the agent retrieves relevant chunks at conversation time and answers from them rather than from its own priors. The content is **chunked** on ingest; each knowledge item is a set of chunks the UI lets you preview, and the agent retrieves the most relevant chunks per query.

(Note: the platform exposes retrieval knobs `topK`/`similarity`/`language` on each spec but never explains them to operators; treat them as preserved-on-edit settings — see the `edit_knowledge` gotcha — not things to tune blindly.)

## Supported sources — and which the plugin can create

Three source forms exist; **only Web is creatable through the plugin.**

- **Web knowledge — PORTABLE (plugin).** Imports a **single publicly accessible HTML page** (no crawling — only the given page is ingested). Create with `add_web_knowledge`. Not for login-protected, highly interactive, or app-like pages — use an MCP integration for those instead.
  - **Static (`live=false`, default):** the page is scraped once and stored. Use for stable content (documentation, blog posts, product descriptions) where consistent reasoning matters. **Prefer this when unsure.**
  - **Live (`live=true`):** the page is fetched dynamically on each use. Use only for frequently-changing content (release notes, policies, status/pricing/news). Responses may vary and performance is slower. (`live=true` finishes instantly — nothing is scraped at creation.)
- **File knowledge — UI-ONLY (GAP).** PDF, DOCX, CSV, TXT, JPG up to 10 MB. The in-app flow only opens an upload window, and the REST ingest endpoint takes a multipart file body a remote MCP server has no way to send. **There is no plugin tool for file upload** — direct the user to upload files in the platform UI (Knowledge → Create → File Upload), then you can read/edit/reference the resulting item.
- **Text knowledge — does not exist.** There is no raw-text knowledge endpoint. The only ingest paths are URL and (UI-only) file.

## Creating & refreshing web knowledge

- **`add_web_knowledge(project_id, url, name, description?, is_global?, live?)`** — `name` is the human-readable list label (maps to `title`); if you leave it generic the URL is used. Returns a **progress stream** ending in `Finished` (with the new `ref`) or `Failed` — wait for the terminal item before treating the knowledge as ready. After it succeeds, **link it to an agent** (see referencing) and tell the user the new `ref`.
- **`refresh_web_knowledge(project_id, ref, url, name, …)`** — re-scrapes an existing URL source (e.g. to pull in updated page content). Full-object body — pass the existing `url`/`name`/flags (fetch them with `get_knowledge_spec` first if you don't have them) so nothing is reset. Also streams progress.

## Reading & analysing

- **`list_knowledge(project_id)`** — all specs (polymorphic by `type`: `url|file|static`); each row's source type and chunk count tell you what's there.
- **`get_knowledge_spec(project_id, ref)`** — one spec (name, description, ref, `topK`, `similarity`, `language`, `isGlobal`, plus type-specific fields like `url`/`live` or `filename`/`extension`).
- **`get_knowledge(project_id, ref)`** — the full document including `chunks: [{ text, metadata }]`.
- **Analysing quality (CLAUDE-NATIVE — no tool):** to judge whether a knowledge base is well-chunked and fit for a use case, call `get_knowledge` to pull the chunks, then assess them yourself — focus on **chunking quality**, **knowledge quality**, and **usefulness for the stated use case**, and return a short paragraph. Do this **after creating knowledge**, before relying on it. There is no `analyse_knowledge` endpoint; the analysis is your own reasoning over the chunks.

## Editing metadata (full-object PUT — read-modify-write)

- **`edit_knowledge(project_id, ref, name?, description?, is_global?)`** — renames / re-scopes. It does **not** re-ingest. The endpoint is a **full replace**: the plugin GETs the current spec first and re-sends the existing `topK`/`similarity`/`language` while overlaying only the fields you pass — so always go through the tool (never hand-build the body), or those retrieval settings reset to defaults.

## Naming & description best practices

- **`name`** is the list label and how the user (and you) recognise the item — make it specific to the source (e.g. "Acme Pricing FAQ", not "Web 1"). If left empty on create, the file name / URL is used.
- **`description`** should say what the content is and, when you reference it on an agent, **include brief usage instructions** — when and how the agent should use it. The reference plus its surrounding instruction line is what tells the agent to actually consult it.

## Global vs non-global — the usability gate

- **`is_global=true`** (default on create) → available to **all** agents in the project.
- **`is_global=false`** → **unusable until explicitly referenced** in at least one agent configuration. A non-global knowledge base that isn't referenced anywhere is dead weight (the platform flags it: "exists but isn't connected to any agent — it won't be used in conversations").

## Referencing knowledge from an agent — `@knowledge:ref;`

This is how an agent is granted access to a knowledge base. Edit the agent's text fields (`purpose` / `businessProcessSteps` / `guardrails`) via `edit_agent` and embed the reference:

- **Canonical form (the trailing semicolon is mandatory and regex-enforced):**
  `@knowledge:knowledge_ref;`
  (Same family: `@MCP:ref;`, `@multimodal:ref;`, `@extractor:ref;`, `@skill:ref;` — all end with `;`.)
- The `ref` must be the **exact** knowledge ref (from `list_knowledge` / the `add_web_knowledge` result) and the item must exist — placeholder or non-existent refs are flagged as broken; a missing trailing `;` makes the reference malformed and silently inert.
- An agent can use only **global** tools or tools it **explicitly references**. So:
  - After creating knowledge an agent should use, **immediately add `@knowledge:<ref>;`** to that agent with a one-line usage instruction (when/how to use it) — automatically, no confirmation needed.
  - For a **non-global** item, this reference is what makes it usable at all.
- Don't add references for competencies the agent doesn't need, and never invent refs.

## Deleting

- **`delete_knowledge(project_id, ref, confirm: true)`** — permanently deletes the knowledge item **and all its content**; cannot be undone. There is no in-app confirm dialog over REST, so the `confirm: true` flag is the only guard — surface the deletion to the user before passing it.

## Tool quick-reference

| Task | Tool |
|---|---|
| List knowledge items | `list_knowledge(project_id)` |
| Inspect a spec | `get_knowledge_spec(project_id, ref)` |
| Read content / chunks (for analysis) | `get_knowledge(project_id, ref)` |
| Add a web page as knowledge | `add_web_knowledge(project_id, url, name, …)` |
| Re-scrape a web source | `refresh_web_knowledge(project_id, ref, url, name, …)` |
| Rename / re-scope (no re-ingest) | `edit_knowledge(project_id, ref, …)` |
| Delete | `delete_knowledge(…, confirm: true)` |
| Upload a file | **UI only — no plugin tool** |
| Judge quality | **Claude-native — `get_knowledge` + reason** |
| Make it usable by an agent | `edit_agent` + `@knowledge:<ref>;` |

Note (faithful flag): the harvest reports show no operator-facing explanation of RAG/top-K/similarity in the in-app prompts — those fields exist on the spec but are surfaced to neither the copilot nor the user. This guide describes retrieval at the conceptual ("factual grounding", chunk retrieval) level only, matching the source material; it does not invent tuning guidance.
