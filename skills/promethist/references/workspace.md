# Promethist — accounts, projects & members (operator guide)

How the platform's workspace hierarchy, roles, and membership work, and which plugin tools drive each. New tools: `get_tenant`, `get_tenant_context`, `create_tenant`, `edit_tenant`, `list_projects`, `get_project_context`, `list_project_users`, `create_project`, `edit_project`, `list_tenant_members`, `set_tenant_member_role`, `remove_tenant_member`, `list_project_members`, `set_project_member_role`, `remove_project_member`, `list_tenant_invitations`, `list_project_invitations`, `invite_members_to_tenant`, `invite_members_to_project`, `revoke_tenant_invitation`, `revoke_project_invitation`. Existing tools you already have: `list_tenants` (all accounts + their projects — call first for IDs), `get_project` (full project by id).

## The hierarchy and the billing boundary

**Platform → Account (tenant) → Project → agents + assets.**
- **Account** (called *tenant* in the API, *account* in the UI — same thing) is an organisational container governing **projects, billing, and members**. Accounts define ownership and access boundaries. **All usage is billed at the account level**: the billing unit is the *Conversational Minute* (minutes agents interact with users), aggregated across every project and agent under the account. There is one bill per account.
- **Project** is a workspace *within* an account. It holds the account's defined relational agents and shared assets: knowledge bases, MCP integrations, interactive (multimodal) content, evaluations. Project settings are: `name`, `description`, `logo`, `primaryColor`, `secondaryColor`, `featuredAgentRef`.
- Treat accounts and projects as **background containers** in conversation — only surface them when the user must choose between multiple. They are the *where*, not the *what*.
- **Account auto-seeding:** creating an account via this plugin (`create_tenant` → `POST /tenants`) seeds a **default project** automatically (the REST flag is on). Mention the new account already has a project to work in.

## The ROLE model (this is the entire permission system)

Three roles at **both** scopes — `Owner`, `Editor`, `Viewer`. **Wire form is capitalized** (`"Owner"|"Editor"|"Viewer"`, = `Role.name`); always send exactly these strings in `set_*_member_role` and `invite_*`.

Internally roles are ordinals where **lower = more power** (`Owner=0, Editor=1, Viewer=2`); a `@role.X` gate means "caller ordinal ≤ X". So:
- gate **owner** ⇒ Owner only.
- gate **editor** ⇒ Editor or Owner.
- gate **viewer** ⇒ anyone (Viewer/Editor/Owner).

### Account roles (what each can do)
- **Owner** — full control of the account: manage billing, projects, members, and identity providers (SSO).
- **Editor** — create and edit projects, agents, knowledge bases; **cannot** access billing or manage account settings.
- **Viewer** — read-only; view but not modify.

### Project roles
- **Owner** — full control, including inviting members and assigning roles.
- **Editor** — view and edit all core resources (agents, knowledge, analytics, interactive content); can create/delete projects.
- **Viewer** — read-only access to project content and analytics.

### Two scopes, with inheritance (critical)
- A **tenant ACL** row (`projectId == null`) applies account-wide. A **project ACL** row (`projectId == <project>`) applies to one project.
- **Authorization falls through:** a permission check on a project first checks the project ACL, then **falls back to the parent tenant ACL** — so a **tenant Owner is implicitly owner of every project** under it. `list_project_members` therefore returns tenant members too, flagged **`inherited:true`** (vs `inherited:false` for direct project members).
- **Cross-scope downgrade is rejected:** `set_project_member_role` to a role *weaker than the user's tenant role* returns **400** (`"Cannot change the role on project to lower role than on tenant…"`) because the tenant role would win anyway. Surface that message; to truly lower someone, change their tenant role.

### Always check role before acting
Read the caller's role with **`get_tenant_context`** (`{ id, name, userRole }`) or **`get_project_context`** (`{ id, name, tenantId, userRole, tenant:{ userRole } }`) before offering a gated action. If an action isn't permitted, explain and refuse rather than firing a call that 403s. **You can NEVER delete an account or a project** — no such endpoint exists.

## Reading the workspace

| Want | Tool | Role | Notes |
|---|---|---|---|
| All accounts + their projects | `list_tenants` | — | Call first to discover IDs. |
| One account (full) | `get_tenant(tenant_id)` | viewer | |
| Caller's role on an account | `get_tenant_context(tenant_id)` | viewer-or-any-project | `{ id, name, userRole }` |
| Projects in an account | `list_projects(tenant_id)` | authenticated | ACL-filtered to what you can see. |
| One project (full) | `get_project(projectId)` | viewer | (existing tool) |
| Caller's role on a project (+ parent) | `get_project_context(project_id)` | viewer | also gives `tenant.userRole`. |
| Users with sessions in a project | `list_project_users(project_id)` | viewer | session participants, **NOT** the team roster — use `list_project_members` for membership. |

## Creating & editing accounts

- **`create_tenant(name)`** → `POST /tenants`. Any authenticated user. Returns `TenantWithProjects { id, name, logo, projects[] }` — **a default project is seeded automatically.**
- **`edit_tenant(tenant_id, name?, logo?)`** → the PATCH is **full-replace, not a merge** server-side. The tool does **read-modify-write for you** (GETs the tenant, resends current `name`+`logo` for whatever you didn't change), so partial edits are safe through the tool. `name` is required-non-blank on the wire (the tool falls back to the current name). `logo` is a **URL string** — uploading image bytes (`POST /tenant/logo`) is not supported here.

## Creating & editing projects

- **`create_project(tenant_id, name, description?, logo?, primary_color?, secondary_color?, featured_agent_ref?)`** → `POST /tenant/{tenant_id}/projects`. **Requires editor (or owner) role on the ACCOUNT.** A user who only has a role on an *individual* project — their account role shows as `viewer` — **cannot create projects**; work with the projects they already have instead. Only offer creation when `get_tenant_context.userRole` (or `get_project_context.tenant.userRole`) is `Editor`/`Owner`.
  - GOTCHA: there is **no `packageType`** in the REST body — the project gets the **default package**. (The in-app tool could set Engage/Empower packages; this API cannot.) If the user wanted a specific package, tell them it must be set in-app.
- **`edit_project(project_id, name?, description?, logo?, primary_color?, secondary_color?, featured_agent_ref?)`** → PATCH is **full-replace**; the tool read-modify-writes for you (GETs the project, merges your changes, resends the full body), so omitted fields are preserved.
  - WARNING worth surfacing to the user: **renaming a project changes its `ref`** — the REST handler re-derives the ref from the new name on every edit. Existing references/links keyed on the old ref can break. Rename deliberately.
  - `logo` is a URL string (no multipart upload). `packageType` cannot be changed via this API.

## Members & invitations

A project's **team** has two lists that live together: current **members** (people with an ACL row) and pending **invitations** (people emailed but not yet accepted). The same split exists at the account level.

### Listing
- **`list_tenant_members(tenant_id)`** / **`list_project_members(project_id)`** → `MemberDto[]`: `{ user:{id,username,name,surname}|null, role, inherited, created, lastModified, lastModifiedBy }`. **Owner-gated.** In project members, tenant members appear with `inherited:true`.
- **`list_tenant_invitations(tenant_id)`** / **`list_project_invitations(project_id)`** → `InvitationDto[]`: `{ id, email, role, state, created, invitedBy, tenant, project }`. **Editor-gated** (lower bar than membership ops — editors can see who's invited). `state` ∈ `Pending | Accepted | Declined | Failed`; only `Pending` means an outstanding invite.

### Inviting (owner only)
- **`invite_members_to_tenant(tenant_id, emails[], role)`** / **`invite_members_to_project(project_id, emails[], role)`**.
  - `emails` is **always an array**, even for one person.
  - `role` is the capitalized enum (`Owner|Editor|Viewer`). You may help the user pick an appropriate role; don't interrogate them for identity/contact details beyond the email(s).
  - Server lowercases/trims emails; **a duplicate is rejected (400)** — `"already member of"` if they're already in, `"already invited to"` if a pending invite exists. Surface that message rather than retrying.
  - Each new invite is created `Pending` and the platform emails an accept link. Returns the created `InvitationDto[]`.

### Changing roles (owner only)
- **`set_tenant_member_role(tenant_id, user_id, role)`** / **`set_project_member_role(project_id, user_id, role)`** → `MemberDto`.
  - Project role-set **may 400** on a cross-scope downgrade (role weaker than the user's tenant role) — see the role model above. It creates a project ACL row if the user only had a tenant role.

### Removing members & revoking invites (owner only, **DANGEROUS — `confirm: true`**)
All four hard-delete and are irreversible; each is guarded — surface what will happen, then re-run with `confirm: true`.
- **`remove_tenant_member(tenant_id, user_id, confirm: true)`** — deletes the account ACL **and** revokes that user's pending account invite.
- **`remove_project_member(project_id, user_id, confirm: true)`** — deletes the project ACL **and** revokes that user's pending project invite.
- **`revoke_tenant_invitation(tenant_id, invitation_id, confirm: true)`** / **`revoke_project_invitation(project_id, invitation_id, confirm: true)`** — hard-delete the invitation row.

## What you CANNOT do here (GAPs / cautions)
- **No delete-account / delete-project** — no backend endpoint exists. Never offer it.
- **No logo file upload** — `logo` is a URL string in create/edit bodies; multipart upload is out of scope.
- **No `packageType`** via create/edit project (defaults; set in-app if needed).
- **Accept/decline invitation** endpoints exist but are **self-only** (act on the bearer user, and only if their username == the invite email) — they're not admin operations and are not exposed as tools. Use them only if *you* are the invitee.

## Tool quick-reference

| Task | Tool | Gate |
|---|---|---|
| Discover accounts/projects + IDs | `list_tenants` | — |
| Account details / caller role | `get_tenant` / `get_tenant_context` | viewer |
| Create / edit account | `create_tenant(name)` / `edit_tenant(tenant_id, …)` | any / editor |
| Projects in account | `list_projects(tenant_id)` | authenticated |
| Project caller role (+ parent) | `get_project_context(project_id)` | viewer |
| Session users in a project | `list_project_users(project_id)` | viewer |
| Create project | `create_project(tenant_id, name, …)` | **editor on account** |
| Edit project (renames change ref) | `edit_project(project_id, …)` | editor on project |
| List members | `list_tenant_members` / `list_project_members` | owner |
| List invitations | `list_tenant_invitations` / `list_project_invitations` | editor |
| Invite people | `invite_members_to_tenant` / `invite_members_to_project` (emails[], role) | owner |
| Change a member's role | `set_tenant_member_role` / `set_project_member_role` | owner |
| Remove member (DANGEROUS) | `remove_tenant_member` / `remove_project_member` (`confirm:true`) | owner |
| Revoke invite (DANGEROUS) | `revoke_tenant_invitation` / `revoke_project_invitation` (`confirm:true`) | owner |

---

Implementation notes for the plugin author (not part of the guide file):
- New module: `/Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin/mcp-server/src/workspace-tools.ts` exporting `registerWorkspaceTools`; register it in `src/index.ts` next to `registerIntegrationTools(server);`.
- Guide file path: `/Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin/mcp-server/guides/workspace.md`; add `"workspace"` to `GUIDE_TOPICS` in `src/guides.ts`, and extend the `get_guide` description in `src/agent-tools.ts` + `PROMETHIST_INSTRUCTIONS` in `src/instructions.ts` to mention it.
- Conformed to live files: `src/{client.ts, tool-result.ts, integration-tools.ts, index.ts, guides.ts, agent-tools.ts}` and `guides/integration.md`. Role enum capitalized to match `Role.name`. All `edit_*` tools use the `edit_integration` read-modify-write pattern; all DELETEs use `confirmGuard` + `textTool` on the empty-204 success path.
