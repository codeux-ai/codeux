import type {
  AutomationCredentialBinding,
  AutomationCredentialCompatibilityAssessment,
  AutomationCredentialMetadata,
  BindAutomationCredentialInput,
  CreateAutomationCredentialInput,
  CredentialBackendHealth,
  PromoteAutomationCredentialInput,
  ReplaceAutomationCredentialSecretInput,
  RestrictAutomationCredentialInput,
  RevokeAutomationCredentialInput,
  TestAutomationCredentialInput,
  UpdateAutomationCredentialMetadataInput,
} from "../../../../src/contracts/automation-credential-types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export type AutomationCredentialApiErrorCode =
  | "validation"
  | "stale_version"
  | "forbidden"
  | "backend_unavailable"
  | "invalid_state"
  | "request_failed";

const ERROR_MESSAGES: Record<AutomationCredentialApiErrorCode, string> = {
  validation: "Check the required fields and credential policy, then try again.",
  stale_version: "This credential changed in another session. Its metadata has been refreshed; review it and try again.",
  forbidden: "The selected project can use this credential but does not have authority to manage it.",
  backend_unavailable: "Secure credential storage is unavailable. Follow the setup guidance and try again after custody is restored.",
  invalid_state: "The encrypted credential state cannot be read. Replace its secret value before retrying.",
  request_failed: "The credential request could not be completed. Refresh the metadata and try again.",
};

export class AutomationCredentialApiError extends Error {
  constructor(public readonly code: AutomationCredentialApiErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AutomationCredentialApiError";
  }
}

const classifyCredentialError = (error: unknown): AutomationCredentialApiErrorCode => {
  const message = error instanceof Error ? error.message : "";
  if (/changed|current version|expectedVersion|concurrent/i.test(message)) return "stale_version";
  if (/forbidden|access denied|outside the project|only the managing|lacks management/i.test(message)) return "forbidden";
  if (/encrypted state/i.test(message)) return "invalid_state";
  if (/key custody|secure storage|credential broker|backend.*unavailable|storage.*unavailable/i.test(message)) return "backend_unavailable";
  if (/required|must |cannot |explicit|at most|unsupported fields|may contain/i.test(message)) return "validation";
  return "request_failed";
};

export const toAutomationCredentialApiError = (error: unknown): AutomationCredentialApiError => (
  error instanceof AutomationCredentialApiError
    ? error
    : new AutomationCredentialApiError(classifyCredentialError(error))
);

const request = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw toAutomationCredentialApiError(error);
  }
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/credentials`;
const credential = (projectId: string, id: string) => `${base(projectId)}/${encodeURIComponent(id)}`;

export const fetchCredentialHealth = (signal?: AbortSignal): Promise<CredentialBackendHealth> => request(() => fetchJson("/api/credentials/health", { signal }));
export const fetchAutomationCredentials = (projectId: string, signal?: AbortSignal): Promise<AutomationCredentialMetadata[]> => request(() => fetchJson(base(projectId), { signal }));
export const createAutomationCredential = (projectId: string, input: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(base(projectId), json("POST", input)));
export const updateAutomationCredential = (projectId: string, id: string, input: UpdateAutomationCredentialMetadataInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(credential(projectId, id), json("PATCH", input)));
export const bindAutomationCredential = (projectId: string, id: string, input: BindAutomationCredentialInput): Promise<AutomationCredentialBinding> => request(() => fetchJson(`${credential(projectId, id)}/bind`, json("POST", input)));
export const assessAutomationCredentialCompatibility = (projectId: string, id: string, input: { allowedKinds: string[]; requiredCapabilities: string[] }): Promise<AutomationCredentialCompatibilityAssessment> => request(() => fetchJson(`${credential(projectId, id)}/compatibility`, json("POST", input)));
export const testAutomationCredential = (projectId: string, id: string, input: TestAutomationCredentialInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/test`, json("POST", input)));
export const rotateAutomationCredential = (projectId: string, id: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/rotate`, json("POST", input)));
export const replaceAutomationCredential = (projectId: string, id: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/replace`, json("POST", input)));
export const revokeAutomationCredential = (projectId: string, id: string, input: RevokeAutomationCredentialInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/revoke`, json("POST", input)));
export const promoteAutomationCredential = (projectId: string, id: string, input: PromoteAutomationCredentialInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/promote`, json("POST", input)));
export const restrictAutomationCredential = (projectId: string, id: string, input: RestrictAutomationCredentialInput): Promise<AutomationCredentialMetadata> => request(() => fetchJson(`${credential(projectId, id)}/restrict`, json("POST", input)));
