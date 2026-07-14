import type {
  CreateCustomDashboardDraftInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationReport,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
} from "../types.js";
import { customDashboardMessages } from "../i18n/messages/custom-dashboards.js";
import { translateDashboardMessage, type DashboardLocale } from "../i18n/locales.js";

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

export function parseJsonDraft<T>(input: string, label: string, locale: DashboardLocale = "en"): JsonDraftResult<T> {
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    return {
      ok: false,
      message: translateDashboardMessage(customDashboardMessages, locale, "invalidJson", { label, detail }),
    };
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
    styleguide: DEFAULT_CUSTOM_DASHBOARD_STYLEGUIDE,
    runtimeMetadata: {},
  };
}

export function getDashboardStatusView(
  status: CustomDashboardRecord["status"],
  locale: DashboardLocale = "en",
): DashboardStatusView {
  switch (status) {
    case "published":
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusPublished"), className: "bg-status-green/10 text-status-green ring-status-green/25" };
    case "validated":
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusValidated"), className: "bg-signal-500/10 text-signal-600 dark:text-signal-300 ring-signal-500/25" };
    case "validating":
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusValidating"), className: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-sky-500/25" };
    case "rejected":
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusFailed"), className: "bg-status-red/10 text-status-red ring-status-red/25" };
    case "archived":
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusArchived"), className: "bg-slate-500/10 text-slate-500 ring-slate-500/25" };
    case "draft":
    default:
      return { label: translateDashboardMessage(customDashboardMessages, locale, "dashboardStatusDraft"), className: "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20" };
  }
}

export function getRevisionValidationLabel(
  status: CustomDashboardValidationStatus | null,
  locale: DashboardLocale = "en",
): string {
  switch (status) {
    case "queued":
      return translateDashboardMessage(customDashboardMessages, locale, "validationQueued");
    case "building":
      return translateDashboardMessage(customDashboardMessages, locale, "validationBuilding");
    case "running":
      return translateDashboardMessage(customDashboardMessages, locale, "validationRunning");
    case "passed":
      return translateDashboardMessage(customDashboardMessages, locale, "validationValidated");
    case "failed":
      return translateDashboardMessage(customDashboardMessages, locale, "validationFailed");
    case "cancelled":
      return translateDashboardMessage(customDashboardMessages, locale, "validationCancelled");
    default:
      return translateDashboardMessage(customDashboardMessages, locale, "validationUnvalidated");
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
  locale: DashboardLocale = "en",
): ValidationStageView[] {
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  return [
    {
      id: "build",
      label: translateDashboardMessage(customDashboardMessages, locale, "stageBuild"),
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
      label: translateDashboardMessage(customDashboardMessages, locale, "stageStart"),
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
      label: translateDashboardMessage(customDashboardMessages, locale, "stageHealth"),
      state: status === "passed"
        ? "passed"
        : failed || cancelled
          ? status
          : "pending",
    },
  ];
}

export function getValidationStageStateLabel(
  state: ValidationStageView["state"],
  locale: DashboardLocale = "en",
): string {
  switch (state) {
    case "active":
      return translateDashboardMessage(customDashboardMessages, locale, "stageActive");
    case "passed":
      return translateDashboardMessage(customDashboardMessages, locale, "stagePassed");
    case "failed":
      return translateDashboardMessage(customDashboardMessages, locale, "stageFailed");
    case "cancelled":
      return translateDashboardMessage(customDashboardMessages, locale, "stageCancelled");
    case "pending":
    default:
      return translateDashboardMessage(customDashboardMessages, locale, "stagePending");
  }
}

export function getValidationIssueExplanation(
  issue: CustomDashboardValidationReport["issues"][number],
  locale: DashboardLocale = "en",
): string {
  switch (issue.code) {
    case "validation_cancelled":
      return translateDashboardMessage(customDashboardMessages, locale, "issueValidationCancelled");
    case "container_missing":
      return translateDashboardMessage(customDashboardMessages, locale, "issueContainerMissing");
    default:
      return issue.message;
  }
}

export function getValidationReportSummary(
  report: CustomDashboardValidationReport,
  locale: DashboardLocale = "en",
): string {
  const matchingIssue = report.issues.find((issue) => issue.message === report.summary);
  if (matchingIssue?.code === "validation_cancelled" || matchingIssue?.code === "container_missing") {
    return getValidationIssueExplanation(matchingIssue, locale);
  }
  if (report.summary) {
    return report.summary;
  }
  return translateDashboardMessage(
    customDashboardMessages,
    locale,
    report.valid ? "validationPassedSummary" : "validationFailedSummary",
  );
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
    || stableJsonStringify(dashboard.styleguide) !== draft.styleguideText.trim();
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
