import type {
  CreateCustomDashboardDraftInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
} from "../types.js";
import type { AutomationCredentialMetadata } from "../../../../src/contracts/automation-credential-types.js";

export type JsonDraftResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export interface ValidationStageView {
  id: "build" | "start" | "health";
  label: string;
  state: "pending" | "active" | "passed" | "failed" | "cancelled";
}

export interface DashboardStatusView {
  label: string;
  className: string;
}

export const DEFAULT_CUSTOM_DASHBOARD_MANIFEST: CustomDashboardManifest = {
  schemaVersion: 1,
  title: "Untitled Dashboard",
  description: "Project-scoped custom dashboard draft.",
  entryFile: "src/dashboard.tsx",
  filePaths: ["src/dashboard.tsx"],
};

export const DEFAULT_CUSTOM_DASHBOARD_FILE_BUNDLE: CustomDashboardFileBundle = {
  files: [
    {
      path: "src/dashboard.tsx",
      contentType: "text/typescript-jsx",
      content: [
        "import { h } from 'preact';",
        "",
        "export default function Dashboard() {",
        "  return <main>Custom dashboard revision</main>;",
        "}",
      ].join("\n"),
    },
  ],
};

export const DEFAULT_CUSTOM_DASHBOARD_SOURCE_GRAPH: CustomDashboardDataSourceNodeGraph = {
  nodes: [],
  edges: [],
};

export const DEFAULT_CUSTOM_DASHBOARD_STYLEGUIDE: CustomDashboardJsonObject = {
  tone: "operational",
  density: "compact",
  notes: "Use existing Code UX dashboard data and keep controls accessible.",
};

export function stableJsonStringify(value: CustomDashboardJsonValue | unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

export function parseJsonDraft<T>(input: string, label: string): JsonDraftResult<T> {
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    return { ok: false, message: `${label} contains invalid JSON: ${detail}` };
  }
}

export function createDefaultCustomDashboardDraft(title = "Untitled Dashboard"): CreateCustomDashboardDraftInput {
  const manifest = { ...DEFAULT_CUSTOM_DASHBOARD_MANIFEST, title };
  return {
    title,
    description: "",
    manifest,
    fileBundle: DEFAULT_CUSTOM_DASHBOARD_FILE_BUNDLE,
    sourceNodeGraph: DEFAULT_CUSTOM_DASHBOARD_SOURCE_GRAPH,
    routes: [{ path: "/", label: "Overview", entryFile: manifest.entryFile }],
    styleguide: DEFAULT_CUSTOM_DASHBOARD_STYLEGUIDE,
    runtimeMetadata: {},
  };
}

export function getDashboardStatusView(status: CustomDashboardRecord["status"]): DashboardStatusView {
  switch (status) {
    case "published":
      return { label: "Published", className: "bg-status-green/10 text-status-green ring-status-green/25" };
    case "validated":
      return { label: "Validated", className: "bg-signal-500/10 text-signal-600 dark:text-signal-300 ring-signal-500/25" };
    case "validating":
      return { label: "Validating", className: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-sky-500/25" };
    case "rejected":
      return { label: "Failed", className: "bg-status-red/10 text-status-red ring-status-red/25" };
    case "archived":
      return { label: "Archived", className: "bg-slate-500/10 text-slate-500 ring-slate-500/25" };
    case "draft":
    default:
      return { label: "Draft", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20" };
  }
}

export function getRevisionValidationLabel(status: CustomDashboardValidationStatus | null): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "building":
      return "Building";
    case "running":
      return "Running";
    case "passed":
      return "Validated";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unvalidated";
  }
}

export function canPublishRevision(
  revision: CustomDashboardRevisionRecord | null,
  session?: CustomDashboardValidationSessionRecord | null,
): boolean {
  if (!revision) {
    return false;
  }
  if (revision.validationStatus === "passed" && revision.validationReport?.valid === true) {
    return true;
  }
  return Boolean(
    session
      && session.revisionId === revision.id
      && session.status === "passed"
      && session.validationReport?.valid === true,
  );
}

export function getValidationStages(
  status: CustomDashboardValidationStatus | null | undefined,
): ValidationStageView[] {
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  return [
    {
      id: "build",
      label: "Build",
      state: status === "building" || status === "queued"
        ? "active"
        : failed || cancelled
          ? status
          : status === "running" || status === "passed"
            ? "passed"
            : "pending",
    },
    {
      id: "start",
      label: "Start",
      state: status === "running"
        ? "active"
        : status === "passed"
          ? "passed"
          : failed || cancelled
            ? status
            : "pending",
    },
    {
      id: "health",
      label: "Health",
      state: status === "passed"
        ? "passed"
        : failed || cancelled
          ? status
          : "pending",
    },
  ];
}

export function buildValidationPreviewPath(sessionId: string | null | undefined): string | null {
  return sessionId ? `/api/custom-dashboard-validations/${encodeURIComponent(sessionId)}/proxy/` : null;
}

export function selectLatestRevision(revisions: CustomDashboardRevisionRecord[]): CustomDashboardRevisionRecord | null {
  return [...revisions].sort((left, right) => right.revisionNumber - left.revisionNumber)[0] ?? null;
}

export function hasDraftChanged(
  dashboard: CustomDashboardRecord | null,
  draft: {
    title: string;
    description: string;
    manifestText: string;
    fileBundleText: string;
    sourceGraphText: string;
    routesText: string;
    credentialBindingsText: string;
    styleguideText: string;
  },
): boolean {
  if (!dashboard) {
    return false;
  }
  return dashboard.title !== draft.title
    || dashboard.description !== draft.description
    || stableJsonStringify(dashboard.manifest) !== draft.manifestText.trim()
    || stableJsonStringify(dashboard.fileBundle) !== draft.fileBundleText.trim()
    || stableJsonStringify(dashboard.sourceNodeGraph) !== draft.sourceGraphText.trim()
    || stableJsonStringify(dashboard.routes) !== draft.routesText.trim()
    || stableJsonStringify(dashboard.credentialBindings.map(({ slot, credentialId }) => ({ slot, credentialId }))) !== draft.credentialBindingsText.trim()
    || stableJsonStringify(dashboard.styleguide) !== draft.styleguideText.trim();
}

/** Retains the explicit metadata contract even if a compromised endpoint adds secret-shaped fields. */
export function redactAutomationCredentialMetadata(value: AutomationCredentialMetadata): AutomationCredentialMetadata {
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    scope: value.scope,
    projectId: value.projectId,
    managementProjectId: value.managementProjectId,
    allowedProjectIds: [...value.allowedProjectIds],
    capabilities: [...value.capabilities],
    status: value.status,
    configured: value.configured,
    keyId: value.keyId,
    keyVersion: value.keyVersion,
    version: value.version,
    lastValidatedAt: value.lastValidatedAt,
    validationStatus: value.validationStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJsonValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}
