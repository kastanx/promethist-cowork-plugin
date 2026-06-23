import { z } from "zod";
import { apiGet, apiRequest } from "./client.js";
import { toTool, textTool, confirmGuard } from "./tool-result.js";
// Ports the in-app tenant/project/member/invitation tools.
// Footgun: the tenant & project PATCH endpoints are FULL-REPLACE (no server-side merge) — every
// edit_* does a client-side read-modify-write. Role wire values are capitalized (Role.name:
// Owner|Editor|Viewer). Member + invite mutations need OWNER on the tenant/project. There is NO
// delete-project / delete-tenant endpoint (platform only hard-deletes agents).
const ROLE = z.enum(["Owner", "Editor", "Viewer"]);
const enc = encodeURIComponent;
const tBase = (id) => `/api/v1/tenant/${enc(id)}`;
const pBase = (id) => `/api/v1/project/${enc(id)}`;
export function registerWorkspaceTools(server) {
    // ---- tenant (account) ------------------------------------------------------
    server.registerTool("get_tenant", {
        title: "Get tenant",
        description: "Get a tenant/account by ID. GET /api/v1/tenant/{id}. Read get_guide('workspace') for the role model.",
        inputSchema: { tenant_id: z.string().describe("Tenant/account ID (from list_tenants).") },
    }, async ({ tenant_id }) => toTool(await apiGet(tBase(tenant_id))));
    server.registerTool("get_tenant_context", {
        title: "Get tenant context",
        description: "Get a tenant plus the CALLER's role on it ({ id, name, userRole }). Use to check if create/edit/member ops " +
            "are permitted. GET /api/v1/tenant/{id}/context.",
        inputSchema: { tenant_id: z.string().describe("Tenant ID.") },
    }, async ({ tenant_id }) => toTool(await apiGet(`${tBase(tenant_id)}/context`)));
    server.registerTool("create_tenant", {
        title: "Create tenant",
        description: "Create a new tenant/account (any authenticated user). Note: it is seeded with a default project. " +
            "POST /api/v1/tenants.",
        inputSchema: { name: z.string().describe("Account name (non-blank).") },
    }, async ({ name }) => toTool(await apiRequest("POST", "/api/v1/tenants", { name })));
    server.registerTool("edit_tenant", {
        title: "Edit tenant",
        description: "Edit a tenant's name/logo. Read-modify-write (the PATCH is full-replace, so it re-sends current values for " +
            "untouched fields). Logo is a URL string (upload is UI-only). Requires editor. PATCH /api/v1/tenant/{id}.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            name: z.string().optional().describe("New account name."),
            logo: z.string().optional().describe("Logo image URL."),
        },
    }, async (a) => {
        const got = await apiGet(tBase(a.tenant_id));
        if (!got.ok)
            return toTool(got);
        const ex = got.data;
        return toTool(await apiRequest("PATCH", tBase(a.tenant_id), { name: a.name ?? ex.name, logo: a.logo ?? ex.logo ?? null }));
    });
    // ---- project ---------------------------------------------------------------
    server.registerTool("list_projects", {
        title: "List projects",
        description: "List the projects in a tenant the caller can access. GET /api/v1/tenant/{tenantId}/projects.",
        inputSchema: { tenant_id: z.string().describe("Tenant ID.") },
    }, async ({ tenant_id }) => toTool(await apiGet(`${tBase(tenant_id)}/projects`)));
    server.registerTool("get_project_context", {
        title: "Get project context",
        description: "Get a project plus the caller's project role AND parent-account role ({ id, name, tenantId, userRole, " +
            "tenant:{ id, name, userRole } }). GET /api/v1/project/{id}/context.",
        inputSchema: { project_id: z.string().describe("Project ID.") },
    }, async ({ project_id }) => toTool(await apiGet(`${pBase(project_id)}/context`)));
    server.registerTool("list_project_users", {
        title: "List project users (by sessions)",
        description: "List users who have conversation SESSIONS in a project (NOT the team roster — use list_project_members for " +
            "that). GET /api/v1/project/{id}/users.",
        inputSchema: { project_id: z.string().describe("Project ID.") },
    }, async ({ project_id }) => toTool(await apiGet(`${pBase(project_id)}/users`)));
    server.registerTool("create_project", {
        title: "Create project",
        description: "Create a project in a tenant. Requires EDITOR on the TENANT (a project-only role can't create projects). " +
            "Logo is a URL string. POST /api/v1/tenant/{tenantId}/projects.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            name: z.string().describe("Project name (non-blank)."),
            description: z.string().optional(),
            logo: z.string().optional().describe("Logo image URL."),
            primary_color: z.string().optional(),
            secondary_color: z.string().optional(),
            featured_agent_ref: z.string().optional().describe("Ref of the project's featured agent."),
        },
    }, async (a) => {
        const body = { name: a.name };
        if (a.description !== undefined)
            body.description = a.description;
        if (a.logo !== undefined)
            body.logo = a.logo;
        if (a.primary_color !== undefined)
            body.primaryColor = a.primary_color;
        if (a.secondary_color !== undefined)
            body.secondaryColor = a.secondary_color;
        if (a.featured_agent_ref !== undefined)
            body.featuredAgentRef = a.featured_agent_ref;
        return toTool(await apiRequest("POST", `${tBase(a.tenant_id)}/projects`, body));
    });
    server.registerTool("edit_project", {
        title: "Edit project",
        description: "Edit a project's metadata. Read-modify-write (PATCH is full-replace). WARNING: renaming re-derives the " +
            "project ref — existing @…:ref; references and URLs may break (edit description/logo freely; rename " +
            "deliberately). Requires editor. PATCH /api/v1/project/{id}.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            name: z.string().optional().describe("New name (CHANGES the project ref)."),
            description: z.string().optional(),
            logo: z.string().optional().describe("Logo image URL."),
            primary_color: z.string().optional(),
            secondary_color: z.string().optional(),
            featured_agent_ref: z.string().optional(),
        },
    }, async (a) => {
        const got = await apiGet(pBase(a.project_id));
        if (!got.ok)
            return toTool(got);
        const ex = got.data;
        const body = {
            name: a.name ?? ex.name,
            description: a.description ?? ex.description ?? "",
            logo: a.logo ?? ex.logo ?? null,
            primaryColor: a.primary_color ?? ex.primaryColor ?? null,
            secondaryColor: a.secondary_color ?? ex.secondaryColor ?? null,
            featuredAgentRef: a.featured_agent_ref ?? ex.featuredAgentRef ?? null,
        };
        const r = await apiRequest("PATCH", pBase(a.project_id), body);
        if (!r.ok)
            return toTool(r);
        const out = toTool(r);
        if (a.name !== undefined && a.name !== ex.name) {
            out.content.push({
                type: "text",
                text: "\nNote: renaming a project re-derives its ref — existing @…:ref; references and URLs may break.",
            });
        }
        return out;
    });
    // ---- members (ACL; owner-gated) --------------------------------------------
    server.registerTool("list_tenant_members", {
        title: "List tenant members",
        description: "List a tenant's team members + roles. Requires owner. GET /api/v1/tenant/{id}/members.",
        inputSchema: { tenant_id: z.string().describe("Tenant ID.") },
    }, async ({ tenant_id }) => toTool(await apiGet(`${tBase(tenant_id)}/members`)));
    server.registerTool("set_tenant_member_role", {
        title: "Set tenant member role",
        description: "Set a member's account role. Requires owner. PUT /api/v1/tenant/{id}/members/{userId}/role.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            user_id: z.string().describe("Member user ID (from list_tenant_members)."),
            role: ROLE.describe("Owner | Editor | Viewer."),
        },
    }, async (a) => toTool(await apiRequest("PUT", `${tBase(a.tenant_id)}/members/${enc(a.user_id)}/role`, { role: a.role })));
    server.registerTool("remove_tenant_member", {
        title: "Remove tenant member",
        description: "Remove a member from the account (revokes their ACL + any pending account invite). Requires owner. " +
            "Irreversible — requires confirm:true. DELETE /api/v1/tenant/{id}/members/{userId}.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            user_id: z.string().describe("Member user ID."),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async (a) => {
        const g = confirmGuard(a.confirm, `Will remove member "${a.user_id}" from the account.`);
        if (g)
            return g;
        const r = await apiRequest("DELETE", `${tBase(a.tenant_id)}/members/${enc(a.user_id)}`);
        return r.ok ? textTool(`Removed member "${a.user_id}" from the account.`) : toTool(r);
    });
    server.registerTool("list_project_members", {
        title: "List project members",
        description: "List a project's members + roles (tenant members appear inherited). Requires owner. " +
            "GET /api/v1/project/{id}/members.",
        inputSchema: { project_id: z.string().describe("Project ID.") },
    }, async ({ project_id }) => toTool(await apiGet(`${pBase(project_id)}/members`)));
    server.registerTool("set_project_member_role", {
        title: "Set project member role",
        description: "Set a member's project role. Requires owner. Note: setting a project role LOWER than the user's tenant role " +
            "is rejected (the tenant role wins). PUT /api/v1/project/{id}/members/{userId}/role.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            user_id: z.string().describe("Member user ID."),
            role: ROLE.describe("Owner | Editor | Viewer."),
        },
    }, async (a) => toTool(await apiRequest("PUT", `${pBase(a.project_id)}/members/${enc(a.user_id)}/role`, { role: a.role })));
    server.registerTool("remove_project_member", {
        title: "Remove project member",
        description: "Remove a member from the project (revokes their project ACL + any pending project invite). Requires owner. " +
            "Irreversible — requires confirm:true. DELETE /api/v1/project/{id}/members/{userId}.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            user_id: z.string().describe("Member user ID."),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async (a) => {
        const g = confirmGuard(a.confirm, `Will remove member "${a.user_id}" from the project.`);
        if (g)
            return g;
        const r = await apiRequest("DELETE", `${pBase(a.project_id)}/members/${enc(a.user_id)}`);
        return r.ok ? textTool(`Removed member "${a.user_id}" from the project.`) : toTool(r);
    });
    // ---- invitations -----------------------------------------------------------
    server.registerTool("list_tenant_invitations", {
        title: "List tenant invitations",
        description: "List pending/accepted account invitations. Requires editor. GET /api/v1/tenant/{id}/invitations.",
        inputSchema: { tenant_id: z.string().describe("Tenant ID.") },
    }, async ({ tenant_id }) => toTool(await apiGet(`${tBase(tenant_id)}/invitations`)));
    server.registerTool("list_project_invitations", {
        title: "List project invitations",
        description: "List a project's invitations. Requires editor. GET /api/v1/project/{id}/invitations.",
        inputSchema: { project_id: z.string().describe("Project ID.") },
    }, async ({ project_id }) => toTool(await apiGet(`${pBase(project_id)}/invitations`)));
    server.registerTool("invite_members_to_tenant", {
        title: "Invite members to tenant",
        description: "Invite one or more people to the account by email (each gets a Pending invite + accept link). Requires owner. " +
            "POST /api/v1/tenant/{id}/invitations.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            emails: z.array(z.string()).describe("Invitee emails (always an array, even for one)."),
            role: ROLE.describe("Role to grant: Owner | Editor | Viewer."),
        },
    }, async (a) => toTool(await apiRequest("POST", `${tBase(a.tenant_id)}/invitations`, { emails: a.emails, role: a.role })));
    server.registerTool("invite_members_to_project", {
        title: "Invite members to project",
        description: "Invite one or more people to a project by email. Requires owner. POST /api/v1/project/{id}/invitations.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            emails: z.array(z.string()).describe("Invitee emails (array)."),
            role: ROLE.describe("Role to grant: Owner | Editor | Viewer."),
        },
    }, async (a) => toTool(await apiRequest("POST", `${pBase(a.project_id)}/invitations`, { emails: a.emails, role: a.role })));
    server.registerTool("revoke_tenant_invitation", {
        title: "Revoke tenant invitation",
        description: "Permanently revoke an account invitation. Requires owner. Irreversible — requires confirm:true. " +
            "DELETE /api/v1/tenant/{id}/invitations/{invitationId}.",
        inputSchema: {
            tenant_id: z.string().describe("Tenant ID."),
            invitation_id: z.string().describe("Invitation ID (from list_tenant_invitations)."),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async (a) => {
        const g = confirmGuard(a.confirm, `Will permanently revoke account invitation "${a.invitation_id}".`);
        if (g)
            return g;
        const r = await apiRequest("DELETE", `${tBase(a.tenant_id)}/invitations/${enc(a.invitation_id)}`);
        return r.ok ? textTool(`Revoked account invitation "${a.invitation_id}".`) : toTool(r);
    });
    server.registerTool("revoke_project_invitation", {
        title: "Revoke project invitation",
        description: "Permanently revoke a project invitation. Requires owner. Irreversible — requires confirm:true. " +
            "DELETE /api/v1/project/{id}/invitations/{invitationId}.",
        inputSchema: {
            project_id: z.string().describe("Project ID."),
            invitation_id: z.string().describe("Invitation ID (from list_project_invitations)."),
            confirm: z.boolean().optional().describe("Must be true to execute."),
        },
    }, async (a) => {
        const g = confirmGuard(a.confirm, `Will permanently revoke project invitation "${a.invitation_id}".`);
        if (g)
            return g;
        const r = await apiRequest("DELETE", `${pBase(a.project_id)}/invitations/${enc(a.invitation_id)}`);
        return r.ok ? textTool(`Revoked project invitation "${a.invitation_id}".`) : toTool(r);
    });
}
