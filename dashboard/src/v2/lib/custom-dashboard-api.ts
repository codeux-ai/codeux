import { fetchJson } from "../../lib/api/fetch-json.js";
import type {
  AutomationCredentialCompatibilityIssue,
  AutomationCredentialMetadata,
  CredentialBackendHealth,
} from "../../../../src/contracts/automation-credential-types.js";
import type {
  CustomDashboardCredentialBinding,
  CustomDashboardCredentialSlotDeclaration,
  CustomDashboardValidationIssue,
} from "../../../../src/contracts/custom-dashboard-types.js";
import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
  UpdateCustomDashboardDraftInput,
} from "../types.js";

export interface CustomDashboardListResponse {
  dashboards: CustomDashboardRecord[];
}

export interface CustomDashboardDetailResponse {
  dashboard: CustomDashboardRecord;
  revisions: CustomDashboardRevisionRecord[];
}

export interface CustomDashboardCatalogSource {
  id: string;
  type: string;
  title: string;
  dashboardId: string;
  dashboardTitle: string;
  config?: Record<string, unknown>;
}

export interface CustomDashboardDataCatalogResponse {
  projectId: string;
  dashboards: Array<{
    id: string;
    title: string;
    status: CustomDashboardRecord["status"];
    publishedRevisionId: string | null;
    sourceNodeGraph: CustomDashboardDataSourceNodeGraph;
  }>;
  sources: CustomDashboardCatalogSource[];
}

export interface CustomDashboardValidationLogsResponse {
  logs: string;
}

export interface CustomDashboardCredentialCandidate {
  credentialId: string;
  metadata: AutomationCredentialMetadata | null;
  compatible: boolean;
  issues: AutomationCredentialCompatibilityIssue[];
  missingCapabilities: string[];
}

export interface CustomDashboardCredentialSlotReview {
  slot: CustomDashboardCredentialSlotDeclaration;
  binding: CustomDashboardCredentialBinding | null;
  metadata: AutomationCredentialMetadata | null;
  compatible: boolean;
  issues: CustomDashboardValidationIssue[];
  candidates?: CustomDashboardCredentialCandidate[];
}

export interface CustomDashboardCredentialBindingReview {
  projectId: string;
  dashboardId: string;
  revisionId: string | null;
  credentialBindingRevision: number | null;
  backend: CredentialBackendHealth;
  valid: boolean;
  issues: CustomDashboardValidationIssue[];
  slots: CustomDashboardCredentialSlotReview[];
  credentialCandidateCount: number;
  credentialCandidatesTruncated: boolean;
}

export class CustomDashboardCredentialBindingApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: CustomDashboardValidationIssue[] = [],
  ) {
    super(message);
    this.name = "CustomDashboardCredentialBindingApiError";
  }
}

const jsonHeaders = { "Content-Type": "application/json" };

const credentialBindingsPath = (projectId: string, dashboardId: string): string => (
  `/api/projects/${encodeURIComponent(projectId)}/custom-dashboards/${encodeURIComponent(dashboardId)}/credential-bindings`
);

const mutateCredentialBindings = async (
  path: string,
  init: RequestInit,
): Promise<CustomDashboardCredentialBindingReview> => {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Partial<CustomDashboardCredentialBindingReview> & {
    error?: unknown;
    issues?: unknown;
  };
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `Credential binding request failed: ${path}`;
    const issues = Array.isArray(body.issues) ? body.issues as CustomDashboardValidationIssue[] : [];
    throw new CustomDashboardCredentialBindingApiError(response.status, message, issues);
  }
  return body as CustomDashboardCredentialBindingReview;
};

export const fetchCustomDashboards = (
  projectId: string,
  signal?: AbortSignal,
): Promise<CustomDashboardListResponse> => (
  fetchJson<CustomDashboardListResponse>(`/api/projects/${encodeURIComponent(projectId)}/custom-dashboards`, { signal })
);

export const fetchCustomDashboard = (
  dashboardId: string,
  signal?: AbortSignal,
): Promise<CustomDashboardDetailResponse> => (
  fetchJson<CustomDashboardDetailResponse>(`/api/custom-dashboards/${encodeURIComponent(dashboardId)}`, { signal })
);

export const fetchCustomDashboardCredentialBindings = (
  projectId: string,
  dashboardId: string,
  signal?: AbortSignal,
): Promise<CustomDashboardCredentialBindingReview> => (
  fetchJson<CustomDashboardCredentialBindingReview>(credentialBindingsPath(projectId, dashboardId), { signal })
);

export const bindCustomDashboardCredential = (
  projectId: string,
  dashboardId: string,
  input: { slotId: string; credentialId: string; expectedBindingRevision: number },
  signal?: AbortSignal,
): Promise<CustomDashboardCredentialBindingReview> => (
  mutateCredentialBindings(credentialBindingsPath(projectId, dashboardId), {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(input),
    signal,
  })
);

export const unbindCustomDashboardCredential = (
  projectId: string,
  dashboardId: string,
  slotId: string,
  expectedBindingRevision: number,
  signal?: AbortSignal,
): Promise<CustomDashboardCredentialBindingReview> => (
  mutateCredentialBindings(`${credentialBindingsPath(projectId, dashboardId)}/${encodeURIComponent(slotId)}`, {
    method: "DELETE",
    headers: jsonHeaders,
    body: JSON.stringify({ expectedBindingRevision }),
    signal,
  })
);

export const createCustomDashboard = (
  projectId: string,
  input: CreateCustomDashboardDraftInput,
): Promise<CustomDashboardRecord> => (
  fetchJson<CustomDashboardRecord>(`/api/projects/${encodeURIComponent(projectId)}/custom-dashboards`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
);

export const updateCustomDashboardDraft = (
  dashboardId: string,
  input: UpdateCustomDashboardDraftInput,
): Promise<CustomDashboardRecord> => (
  fetchJson<CustomDashboardRecord>(`/api/custom-dashboards/${encodeURIComponent(dashboardId)}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
);

export const createCustomDashboardRevision = (
  dashboardId: string,
  input: CreateCustomDashboardRevisionInput = {},
): Promise<CustomDashboardRevisionRecord> => (
  fetchJson<CustomDashboardRevisionRecord>(`/api/custom-dashboards/${encodeURIComponent(dashboardId)}/revisions`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
);

export const startCustomDashboardValidation = (
  dashboardId: string,
  revisionId: string,
  projectId: string,
): Promise<CustomDashboardValidationSessionRecord> => (
  fetchJson<CustomDashboardValidationSessionRecord>(
    `/api/custom-dashboards/${encodeURIComponent(dashboardId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ projectId }),
    },
  )
);

export const fetchCustomDashboardValidationSession = (
  sessionId: string,
  signal?: AbortSignal,
): Promise<CustomDashboardValidationSessionRecord> => (
  fetchJson<CustomDashboardValidationSessionRecord>(`/api/custom-dashboard-validations/${encodeURIComponent(sessionId)}`, { signal })
);

export const fetchCustomDashboardValidationLogs = (
  sessionId: string,
  tail = 200,
  signal?: AbortSignal,
): Promise<CustomDashboardValidationLogsResponse> => {
  const url = new URL(`/api/custom-dashboard-validations/${encodeURIComponent(sessionId)}/logs`, window.location.origin);
  url.searchParams.set("tail", String(tail));
  return fetchJson<CustomDashboardValidationLogsResponse>(`${url.pathname}${url.search}`, { signal });
};

export const stopCustomDashboardValidation = (
  sessionId: string,
): Promise<CustomDashboardValidationSessionRecord> => (
  fetchJson<CustomDashboardValidationSessionRecord>(`/api/custom-dashboard-validations/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  })
);

export const removeCustomDashboardValidation = async (sessionId: string): Promise<void> => {
  await fetchJson<Record<string, never>>(`/api/custom-dashboard-validations/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
};

export const publishCustomDashboardRevision = (
  dashboardId: string,
  revisionId: string,
  validationSessionId?: string,
): Promise<CustomDashboardRecord> => (
  fetchJson<CustomDashboardRecord>(
    `/api/custom-dashboards/${encodeURIComponent(dashboardId)}/revisions/${encodeURIComponent(revisionId)}/publish`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ revisionId, ...(validationSessionId ? { validationSessionId } : {}) }),
    },
  )
);

export const archiveCustomDashboard = (dashboardId: string): Promise<CustomDashboardRecord> => (
  fetchJson<CustomDashboardRecord>(`/api/custom-dashboards/${encodeURIComponent(dashboardId)}`, {
    method: "DELETE",
  })
);

export const fetchCustomDashboardDataCatalog = (
  projectId: string,
  signal?: AbortSignal,
): Promise<CustomDashboardDataCatalogResponse> => (
  fetchJson<CustomDashboardDataCatalogResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/custom-dashboards/data-catalog`,
    { signal },
  )
);
