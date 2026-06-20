# Promethist plugin — capability benchmark

Verifies the MCP plugin matches the in-app Promethist copilot. The in-app agent exposes
**79 `@Tool` methods** across 14 component classes. This benchmark maps each to the plugin and
gives you two ways to test: a **capability matrix** (paper parity) and an **automated harness**
(`benchmark/run.mjs`, real end-to-end calls against a test project).

Legend: **✅ ported** (a plugin tool does it) · **🧠 Claude-native** (no tool needed — Claude does
the reasoning over data tools) · **⚠️ GAP** (not available via REST / not portable to a remote server).

## Score

- **Action/data capabilities ported:** ~60 of 79 in-app tools → covered by the plugin's tools.
- **Claude-native (collapse into the model):** ~14 (the in-app LLM-wrapper / UI-render tools).
- **Genuine GAPs:** 7 — delete/archive agent, analytics (×2), billing (×2), identity-providers, file-knowledge upload (+ multimodal image/video *binary* upload; URL works).

The plugin also adds tools the copilot lacked: `list_integrations`, `list_connectors`, `load_mcp_tools`, `remove_insight`, `get_guide`, `login`/`logout`, and all the member/invitation/role tools.

## Capability matrix

### Agents — AgentDetailTools + CoreManagementTools + ProjectCreationTool/TenantCreationTool
| In-app @Tool | Plugin | Status |
|---|---|---|
| `createAgent` | `create_agent` | ✅ |
| `editAgent` / `callLLMForAgentEdit` | `edit_agent` (Claude writes the diff) | ✅ / 🧠 |
| `checkAgentQuality` | (review via `get_agent` + `get_guide('quality')`) | 🧠 |
| `getAgentCreationPrompt` | (Claude composes via `get_guide('authoring')`) | 🧠 |
| `getVisuals` / `getVoices` | `get_visuals` / `get_voices` | ✅ |
| `getAgentRevisions` | `get_agent_revisions` | ✅ |
| `revertAgent` | `revert_agent` 🔒 | ✅ |
| `promoteAgentToPreview` / `promoteAgentToPublished` | `promote_agent_to_preview` / `_published` 🔒 | ✅ |
| `deleteAgent` | — | ⚠️ GAP (no archive/delete-agent tool) |
| `getAgentDetail` / `getAgentContent` / `agentDetails` | `get_agent` | ✅ |
| `getAgentCreationPrompt`, `collectHistory` | (internal/native) | 🧠 |

### Evaluations — EvaluationTools (14)
| In-app | Plugin | Status |
|---|---|---|
| `createEvaluation` / `editEvaluation` | `create_evaluation` / `edit_evaluation` | ✅ |
| `getEvaluations` / `getEvaluation` | `list_evaluations` / `get_evaluation` | ✅ |
| `addInsightBool/Number/Text/TextList` | `add_insight` (one tool, `type` param) | ✅ |
| `editInsightBool/Number/Text/TextList` | `edit_insight` | ✅ |
| `deleteEvaluation` | `delete_evaluation` 🔒 | ✅ |
| (—) | `remove_insight` 🔒 *(plugin extra)* | ✅ |

### Knowledge — KnowledgeTools (5)
| In-app | Plugin | Status |
|---|---|---|
| `addWebKnowledge` | `add_web_knowledge` | ✅ |
| `editKnowledge` / `deleteKnowledge` | `edit_knowledge` / `delete_knowledge` 🔒 | ✅ |
| `analyseKnowledge` | (read `get_knowledge` chunks, judge) | 🧠 |
| `addFileKnowledge` | — | ⚠️ GAP (multipart/UI-only) |

### Multimodal — MultimodalTools (14)
| In-app | Plugin | Status |
|---|---|---|
| `addMultimodalInput/Webpage/Image/Video/Choice/Handover` | `create_multimodal_interaction` (`type` param) | ✅ |
| `editMultimodal*` (6) | `edit_multimodal_interaction` | ✅ |
| `deleteMultimodal` | `delete_multimodal_interaction` 🔒 | ✅ |
| `resolvePublishedAgentKey` | (Claude via `get_agent_revisions`) | 🧠 |
| image/video **binary** upload | — | ⚠️ GAP (URL works) |

### Integrations — IntegrationTools (3) + connector endpoints
| In-app | Plugin | Status |
|---|---|---|
| `addIntegration` | `create_pre/post/mcp_integration`, `enable_connector` | ✅ |
| `editIntegration` | `edit_integration`, `update_connector` | ✅ |
| `deleteIntegration` | `delete_integration` 🔒, `delete_connector` 🔒 | ✅ |
| (—) | `list_integrations`, `list_connectors`, `load_mcp_tools` *(extra)* | ✅ |

### Workspace — Tenant/Project/Members/Navigation
| In-app | Plugin | Status |
|---|---|---|
| `getAccounts` / `accountList` | `list_tenants` | ✅ |
| `getAccountDetails` | `get_tenant` / `get_tenant_context` | ✅ |
| `createAccount` / `editAccount` | `create_tenant` / `edit_tenant` | ✅ |
| `getProjectDetails` | `get_project` / `get_project_context` | ✅ |
| `createProject` / `editProject` | `create_project` / `edit_project` | ✅ |
| `projectList` / `agentList` | `list_projects` / `list_agents` | ✅ |
| `getTemplates` | `list_templates` | ✅ |
| `getAccountMembers` | `list_tenant_members` (+ project members) | ✅ |
| `inviteUserToAccount` / `inviteUserToProject` | `invite_members_to_tenant` / `_project` | ✅ |
| (—) | role + remove + invitation list/revoke tools *(extra)* | ✅ |
| `getAnalytics` / `fetchAnalyticsSummary` | — | ⚠️ GAP |
| `getBilling` / `getBillingContent` | — | ⚠️ GAP |
| `getIdentityProviders` | — | ⚠️ GAP (minor) |

### AdditionalTools (7) — mostly Claude-native
| In-app | Plugin | Status |
|---|---|---|
| `getTemplates` | `list_templates` | ✅ |
| `findAssetsByName` | (compose via the `list_*` tools) | 🧠 |
| `checkProjectQuality` / `reactiveProjectCheck` | (review via the read tools + guides) | 🧠 |
| `search` / `documentation` / `promethistWebsite` | (Claude/host web + general knowledge) | 🧠 / ⚠️ minor |

## Genuine gaps (decide whether to close)
1. **Archive/delete an agent** — `deleteAgent` has no plugin tool. Easy to add (`POST /agents/{id}/archive[-all]`).
2. **Analytics** — `getAnalytics` / `fetchAnalyticsSummary`. The platform has analytics REST endpoints; easy reads to port.
3. **Billing** — `getBilling` / `getBillingContent`. Read endpoints exist; portable.
4. **Identity providers** — `getIdentityProviders` (minor read).
5. **File-knowledge upload** & **multimodal image/video binary upload** — multipart, no local FS on a remote server. URL paths cover the common case.

## Manual test (type these into Claude Desktop)
Run each; the plugin should accomplish it end-to-end. Use a throwaway project.

- **Agents:** "Create a relational agent called *Bench Coach* in <project>, purpose: practice negotiation. Give it the Crea avatar with the living room environment and a voice. Then show me its revisions and review it for completeness."
- **Evaluations:** "In <project>, create an evaluation *Call quality* with a yes/no insight 'Was it resolved?' and a 0–10 'Helpfulness' score. Then change the helpfulness prompt, remove the resolved insight, and finally delete the evaluation."
- **Knowledge:** "Add the web page https://example.com as knowledge named *Bench KB* in <project>, show its chunks, rename it, then delete it."
- **Multimodal:** "Create a webpage interactive-content element named *Bench Page* pointing at https://example.com in <project>, then delete it."
- **Integrations:** "List the integrations and MCP connectors in <project>. Add a post-session webhook to https://example.com, then remove it."
- **Workspace:** "What's my role on <tenant>? List its projects and members. Invite bench-delete-me@example.com as a Viewer, list invitations, then revoke it."

Each destructive step should ask you to confirm (the plugin requires `confirm: true`).

## Automated harness
```bash
cd mcp-server && npm install
export PROMETHIST_COOKIE='authjs.session-token=...'   # a fresh logged-in cookie
export BENCH_PROJECT_ID='<a throwaway project id>'    # e.g. your personal "test" project
export BENCH_TENANT_ID='<its tenant id>'              # the project's tenant (for member/invite checks)
npm run bench                                          # = build + node benchmark/run.mjs
```
The harness lives at `mcp-server/benchmark/run.mjs`.
It drives the built MCP server through create → read → edit → verify → cleanup for each area and
prints a PASS/FAIL scorecard. It cleans up everything it creates (agents are archived via REST since
there's no archive tool yet). It does **not** create tenants/projects (those can't be deleted).
