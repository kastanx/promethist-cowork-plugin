import { config } from "./config.js";

// Promethist web-app deep links. The Next.js app and REST API share a host on
// preview/prod, so the web base IS config.baseUrl. Studio routes are nested:
//   /dashboard/studio/accounts/{tenantId}/projects/{projectId}/...
const base = () => config.baseUrl.replace(/\/+$/, "");
const studio = (tenantId: string) => `${base()}/dashboard/studio/accounts/${tenantId}`;

export const tenantUrl = (tenantId: string) => studio(tenantId);
export const projectUrl = (tenantId: string, projectId: string) => `${studio(tenantId)}/projects/${projectId}`;
export const agentUrl = (tenantId: string, projectId: string, agentId: string) =>
  `${projectUrl(tenantId, projectId)}/agents/${agentId}`;
