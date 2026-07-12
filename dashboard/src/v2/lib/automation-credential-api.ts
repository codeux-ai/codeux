import type {
  AutomationCredentialBinding,
  AutomationCredentialCapability,
  AutomationCredentialMetadata,
  CreateAutomationCredentialInput,
  CredentialBackendHealth,
} from "../../../../src/contracts/automation-credential-types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/credentials`;
export const fetchCredentialHealth = (): Promise<CredentialBackendHealth> => fetchJson("/api/credentials/health");
export const fetchAutomationCredentials = (projectId: string): Promise<AutomationCredentialMetadata[]> => fetchJson(base(projectId));
export const createAutomationCredential = (projectId: string, input: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(base(projectId), json("POST", input));
export const bindAutomationCredential = (projectId: string, id: string, input: { bindingKey: string; capabilities: AutomationCredentialCapability[] }): Promise<AutomationCredentialBinding> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/bind`, json("POST", input));
export const testAutomationCredential = (projectId: string, id: string): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/test`, json("POST"));
export const rotateAutomationCredential = (projectId: string, id: string, value: string): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/rotate`, json("POST", { value }));
export const replaceAutomationCredential = (projectId: string, id: string, value: string): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/replace`, json("POST", { value }));
export const revokeAutomationCredential = (projectId: string, id: string): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/revoke`, json("POST"));
export const promoteAutomationCredential = (projectId: string, id: string, allowedProjectIds: string[]): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/promote`, json("POST", { allowedProjectIds }));
export const restrictAutomationCredential = (projectId: string, id: string, input: { allowedProjectIds: string[]; capabilities: AutomationCredentialCapability[] }): Promise<AutomationCredentialMetadata> => fetchJson(`${base(projectId)}/${encodeURIComponent(id)}/restrict`, json("POST", input));
