import { fetchJson } from "../../lib/api/fetch-json.js";
import type {
  CustomDashboardJsonValue,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationReport,
} from "../types.js";

type CustomDashboardDataSourceNode = CustomDashboardRevisionRecord["sourceNodeGraph"]["nodes"][number];

export type CustomDashboardRuntimeSourceKind =
  | "project_dashboard_data"
  | "stats"
  | "telemetry"
  | "integrations_metadata"
  | "external_api";

export interface CustomDashboardRuntimeSourceResult {
  sourceId: string;
  type: string;
  title: string;
  data: CustomDashboardJsonValue;
}

export interface CustomDashboardPublishedRuntime {
  dashboard: CustomDashboardRecord;
  revision: CustomDashboardRevisionRecord;
  document: string;
}

export type CustomDashboardRuntimeResolution =
  | { status: "ready"; runtime: CustomDashboardPublishedRuntime }
  | {
    status: "blocked";
    reason: string;
    validationReport: CustomDashboardValidationReport | null;
    publishedRevision: CustomDashboardRevisionRecord | null;
  };

export interface CustomDashboardRuntimeMessage {
  type: "codeux-custom-dashboard:source-request" | "codeux-custom-dashboard:runtime-error";
  requestId?: string;
  sourceId?: string;
  message?: string;
}

interface CustomDashboardViewerArtifactFile {
  path: string;
  content: string;
  contentType: string;
}

interface CustomDashboardViewerArtifact {
  kind: "vite-dist";
  entryFile: string;
  files: CustomDashboardViewerArtifactFile[];
}

export const CUSTOM_DASHBOARD_SOURCE_RESPONSE_TYPE = "codeux-custom-dashboard:source-response";

const supportedSourceTypes = new Set<string>([
  "project_dashboard_data",
  "project_dashboard",
  "dashboard_data",
  "stats",
  "project_stats",
  "telemetry",
  "overview_telemetry",
  "integrations_metadata",
  "integrations",
  "external_api",
]);
const CREDENTIAL_BINDING_ID_REDACTION = "[REDACTED_CREDENTIAL_BINDING_ID]";
const CREDENTIAL_BINDING_PROPERTY_NAMES = new Set(["credentialbindings", "credentialid"]);

export function resolvePublishedCustomDashboardRuntime(
  dashboard: CustomDashboardRecord,
  revisions: CustomDashboardRevisionRecord[],
): CustomDashboardRuntimeResolution {
  const credentialIds = collectCredentialBindingIds(dashboard, revisions);
  const safeDashboard = sanitizeViewerValue(dashboard, credentialIds);
  const safeRevisions = sanitizeViewerValue(revisions, credentialIds);
  const publishedRevision = dashboard.publishedRevisionId
    ? revisions.find((revision) => revision.id === dashboard.publishedRevisionId) ?? null
    : null;
  const safePublishedRevision = publishedRevision ? sanitizeViewerValue(publishedRevision, credentialIds) : null;
  const validationReport = getLastValidationReport(safeRevisions);

  if (safeDashboard.status === "archived") {
    return { status: "blocked", reason: "Archived custom dashboards cannot be opened.", validationReport, publishedRevision: safePublishedRevision };
  }
  if (safeDashboard.status !== "published") {
    return {
      status: "blocked",
      reason: "Only published custom dashboards can be opened. Validate and publish a revision first.",
      validationReport,
      publishedRevision: safePublishedRevision,
    };
  }
  if (!safeDashboard.publishedRevisionId || !publishedRevision) {
    return {
      status: "blocked",
      reason: "This custom dashboard has no published revision.",
      validationReport,
      publishedRevision: safePublishedRevision,
    };
  }
  if (publishedRevision.validationStatus !== "passed" || publishedRevision.validationReport?.valid !== true) {
    return {
      status: "blocked",
      reason: "The published revision no longer has a passed validation report.",
      validationReport: safePublishedRevision?.validationReport ?? validationReport,
      publishedRevision: safePublishedRevision,
    };
  }

  const readyRevision = sanitizeViewerValue(publishedRevision, credentialIds);

  return {
    status: "ready",
    runtime: {
      dashboard: safeDashboard,
      revision: readyRevision,
      document: buildCustomDashboardFrameDocument(safeDashboard, readyRevision),
    },
  };
}

export function buildCustomDashboardFrameDocument(
  dashboard: CustomDashboardRecord,
  revision: CustomDashboardRevisionRecord,
): string {
  const credentialIds = collectCredentialBindingIds(dashboard, [revision]);
  return buildSanitizedCustomDashboardFrameDocument(
    sanitizeViewerValue(dashboard, credentialIds),
    sanitizeViewerValue(revision, credentialIds),
  );
}

function buildSanitizedCustomDashboardFrameDocument(
  dashboard: CustomDashboardRecord,
  revision: CustomDashboardRevisionRecord,
): string {
  const entryFile = revision.fileBundle.files.find((file) => file.path === revision.manifest.entryFile) ?? null;
  const bridgeConfig = {
    projectId: revision.projectId,
    dashboardId: dashboard.id,
    revisionId: revision.id,
    manifest: revision.manifest,
    sourceNodeGraph: revision.sourceNodeGraph,
    styleguide: revision.styleguide,
    runtimeMetadata: revision.runtimeMetadata,
  };
  const bootstrap = buildBridgeBootstrapScript(bridgeConfig);
  const title = escapeHtml(revision.manifest.title || dashboard.title);
  const viewerArtifact = getViewerArtifact(revision.runtimeMetadata);

  if (viewerArtifact) {
    return buildViewerArtifactDocument(viewerArtifact, bootstrap, title);
  }

  if (entryFile && isHtmlEntry(entryFile.path, entryFile.contentType)) {
    return injectBootstrapIntoHtml(entryFile.content, bootstrap, title);
  }

  if (entryFile && isJavaScriptEntry(entryFile.path, entryFile.contentType)) {
    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      `<title>${title}</title>`,
      baseFrameStyle(),
      "</head>",
      "<body>",
      "<main id=\"codeux-custom-dashboard-root\" aria-label=\"Published custom dashboard\"></main>",
      `<script>${bootstrap}</script>`,
      `<script type=\"module\">${escapeScript(entryFile.content)}</script>`,
      "</body>",
      "</html>",
    ].join("\n");
  }

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<title>${title}</title>`,
    baseFrameStyle(),
    "</head>",
    "<body>",
    "<main class=\"runtime-empty\" role=\"status\">",
    `<h1>${title}</h1>`,
    "<p>The published revision is validated, but its entry file is not directly executable in the isolated browser viewer.</p>",
    "<p>Use an HTML or browser-ready JavaScript entry file for in-app rendering, or open the validation preview while its runtime is still available.</p>",
    "</main>",
    `<script>${bootstrap}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export async function resolveCustomDashboardRuntimeSource(
  projectId: string,
  source: CustomDashboardDataSourceNode,
  signal?: AbortSignal,
): Promise<CustomDashboardRuntimeSourceResult> {
  if (!supportedSourceTypes.has(source.type)) {
    throw new Error(`Data source "${source.title || source.id}" is unavailable: unsupported source type "${source.type}".`);
  }

  const normalizedType = normalizeSourceType(source.type);
  if (normalizedType === "external_api") {
    throw new Error(`External API source "${source.title || source.id}" is a placeholder and is not available in the in-app viewer.`);
  }
  if (normalizedType === "integrations_metadata") {
    return {
      sourceId: source.id,
      type: source.type,
      title: source.title,
      data: {
        available: true,
        source: {
          id: source.id,
          title: source.title,
          type: source.type,
          config: source.config ?? {},
        },
        note: "Integration metadata is limited to non-secret source-node metadata in the in-app viewer.",
      },
    };
  }

  const data = await fetchJson<CustomDashboardJsonValue>(
    buildSourceEndpoint(projectId, normalizedType, source),
    { signal },
  );
  return {
    sourceId: source.id,
    type: source.type,
    title: source.title,
    data,
  };
}

export function createCustomDashboardRuntimeMessageHandler(args: {
  frameWindow: Window | null;
  runtime: CustomDashboardPublishedRuntime;
  onRuntimeError: (message: string) => void;
  signal?: AbortSignal;
}): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    if (!args.frameWindow || event.source !== args.frameWindow || !isRuntimeMessage(event.data)) {
      return;
    }
    const frameWindow = args.frameWindow;
    if (event.data.type === "codeux-custom-dashboard:runtime-error") {
      args.onRuntimeError(event.data.message || "The custom dashboard frame reported an unknown runtime error.");
      return;
    }
    const requestId = event.data.requestId;
    const sourceId = event.data.sourceId;
    if (!requestId || !sourceId) {
      postSourceResponse(args.frameWindow, {
        requestId: requestId || "unknown",
        ok: false,
        error: "Custom dashboard source requests require requestId and sourceId.",
      });
      return;
    }
    const source = args.runtime.revision.sourceNodeGraph.nodes.find((node) => node.id === sourceId);
    if (!source) {
      postSourceResponse(frameWindow, {
        requestId,
        ok: false,
        error: `Custom dashboard source not declared: ${sourceId}.`,
      });
      return;
    }
    void resolveCustomDashboardRuntimeSource(args.runtime.revision.projectId, source, args.signal)
      .then((result) => postSourceResponse(frameWindow, { requestId, ok: true, data: result.data }))
      .catch((error) => postSourceResponse(frameWindow, {
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Custom dashboard source request failed.",
      }));
  };
}

export function buildPublishedCustomDashboardLink(dashboardId: string, origin = window.location.origin): string {
  const url = new URL("/custom-dashboards", origin);
  url.searchParams.set("dashboard", dashboardId);
  url.searchParams.set("mode", "viewer");
  return url.toString();
}

function getLastValidationReport(revisions: CustomDashboardRevisionRecord[]): CustomDashboardValidationReport | null {
  return [...revisions]
    .sort((left, right) => right.revisionNumber - left.revisionNumber)
    .find((revision) => revision.validationReport !== null)
    ?.validationReport ?? null;
}

function normalizeSourceType(type: string): CustomDashboardRuntimeSourceKind {
  switch (type) {
    case "project_dashboard":
    case "dashboard_data":
      return "project_dashboard_data";
    case "project_stats":
      return "stats";
    case "overview_telemetry":
      return "telemetry";
    case "integrations":
      return "integrations_metadata";
    case "external_api":
      return "external_api";
    default:
      return type as CustomDashboardRuntimeSourceKind;
  }
}

function buildSourceEndpoint(
  projectId: string,
  type: Exclude<CustomDashboardRuntimeSourceKind, "external_api" | "integrations_metadata">,
  source: CustomDashboardDataSourceNode,
): string {
  if (type === "project_dashboard_data") {
    return `/api/projects/${encodeURIComponent(projectId)}/execution`;
  }
  if (type === "telemetry") {
    return "/api/telemetry/overview";
  }
  const windowValue = typeof source.config?.window === "string" && source.config.window.trim()
    ? source.config.window.trim()
    : "7d";
  return `/api/projects/${encodeURIComponent(projectId)}/stats?window=${encodeURIComponent(windowValue)}`;
}

function isRuntimeMessage(value: unknown): value is CustomDashboardRuntimeMessage {
  return Boolean(
    value
      && typeof value === "object"
      && "type" in value
      && (
        (value as { type?: unknown }).type === "codeux-custom-dashboard:source-request"
        || (value as { type?: unknown }).type === "codeux-custom-dashboard:runtime-error"
      ),
  );
}

function postSourceResponse(
  frameWindow: Window,
  response: { requestId: string; ok: true; data: CustomDashboardJsonValue } | { requestId: string; ok: false; error: string },
): void {
  frameWindow.postMessage({ type: CUSTOM_DASHBOARD_SOURCE_RESPONSE_TYPE, ...response }, "*");
}

function buildBridgeBootstrapScript(config: Record<string, unknown>): string {
  return [
    "(() => {",
    `  const config = Object.freeze(${escapeScript(JSON.stringify(config))});`,
    "  const pending = new Map();",
    "  let seq = 0;",
    "  const readSource = (sourceId) => new Promise((resolve, reject) => {",
    "    const requestId = `source-${Date.now()}-${++seq}`;",
    "    pending.set(requestId, { resolve, reject });",
    "    window.parent.postMessage({ type: 'codeux-custom-dashboard:source-request', requestId, sourceId }, '*');",
    "  });",
    "  window.addEventListener('message', (event) => {",
    `    if (event.source !== window.parent || !event.data || event.data.type !== '${CUSTOM_DASHBOARD_SOURCE_RESPONSE_TYPE}') return;`,
    "    const entry = pending.get(event.data.requestId);",
    "    if (!entry) return;",
    "    pending.delete(event.data.requestId);",
    "    if (event.data.ok) entry.resolve(event.data.data);",
    "    else entry.reject(new Error(event.data.error || 'Custom dashboard source request failed.'));",
    "  });",
    "  const bridge = Object.freeze({",
    "    ...config,",
    "    listSources: () => config.sourceNodeGraph?.nodes ? [...config.sourceNodeGraph.nodes] : [],",
    "    readSource,",
    "  });",
    "  Object.defineProperty(window, 'codeUxDataBridge', { value: bridge, writable: false, configurable: false });",
    "  Object.defineProperty(window, 'CodeUXCustomDashboard', { value: bridge, writable: false, configurable: false });",
    "  const report = (message) => window.parent.postMessage({ type: 'codeux-custom-dashboard:runtime-error', message }, '*');",
    "  window.addEventListener('error', (event) => report(event.message || 'Custom dashboard runtime error.'));",
    "  window.addEventListener('unhandledrejection', (event) => report(event.reason?.message || String(event.reason || 'Unhandled custom dashboard rejection.')));",
    "})();",
  ].join("\n");
}

function collectCredentialBindingIds(
  dashboard: CustomDashboardRecord,
  revisions: CustomDashboardRevisionRecord[],
): string[] {
  const credentialIds = new Set<string>();
  for (const record of [dashboard, ...revisions]) {
    for (const binding of record.credentialBindings ?? []) {
      if (binding.credentialId) credentialIds.add(binding.credentialId);
    }
  }
  return [...credentialIds].sort((left, right) => right.length - left.length);
}

function sanitizeViewerValue<T>(value: T, credentialIds: readonly string[]): T {
  return sanitizeViewerUnknown(value, credentialIds) as T;
}

function sanitizeViewerUnknown(value: unknown, credentialIds: readonly string[]): unknown {
  if (typeof value === "string") {
    return credentialIds.reduce(
      (safe, credentialId) => safe.split(credentialId).join(CREDENTIAL_BINDING_ID_REDACTION),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeViewerUnknown(entry, credentialIds));
  }
  if (!value || typeof value !== "object") return value;

  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (CREDENTIAL_BINDING_PROPERTY_NAMES.has(normalizedKey)
      || credentialIds.some((credentialId) => key.includes(credentialId))) {
      continue;
    }
    safe[key] = sanitizeViewerUnknown(entry, credentialIds);
  }
  return safe;
}

function injectBootstrapIntoHtml(html: string, bootstrap: string, title: string): string {
  const script = `<script>${bootstrap}</script>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${baseFrameStyle()}\n<title>${title}</title>\n${script}\n</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}\n</body>`);
  }
  return `${script}\n${html}`;
}

function buildViewerArtifactDocument(
  artifact: CustomDashboardViewerArtifact,
  bootstrap: string,
  title: string,
): string {
  const entryFile = artifact.files.find((file) => file.path === artifact.entryFile) ?? null;
  if (entryFile && isHtmlEntry(entryFile.path, entryFile.contentType)) {
    return injectBootstrapIntoHtml(inlineViewerArtifactAssets(entryFile.content, artifact), bootstrap, title);
  }
  if (entryFile && isJavaScriptEntry(entryFile.path, entryFile.contentType)) {
    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      `<title>${title}</title>`,
      baseFrameStyle(),
      "</head>",
      "<body>",
      "<main id=\"codeux-custom-dashboard-root\" aria-label=\"Published custom dashboard\"></main>",
      `<script>${bootstrap}</script>`,
      `<script type=\"module\">${escapeScript(entryFile.content)}</script>`,
      "</body>",
      "</html>",
    ].join("\n");
  }
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<title>${title}</title>`,
    baseFrameStyle(),
    "</head>",
    "<body>",
    "<main class=\"runtime-empty\" role=\"status\">",
    `<h1>${title}</h1>`,
    "<p>The published revision has a viewer artifact, but its artifact entry file is missing or unsupported.</p>",
    "</main>",
    `<script>${bootstrap}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

function inlineViewerArtifactAssets(html: string, artifact: CustomDashboardViewerArtifact): string {
  const withInlineScripts = html.replace(
    /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>\s*<\/script>/gi,
    (tag, _quote: string, assetPath: string) => {
      const asset = findViewerArtifactFile(artifact, assetPath);
      return asset && isJavaScriptEntry(asset.path, asset.contentType)
        ? `<script type="module">${escapeScript(asset.content)}</script>`
        : tag;
    },
  );
  return withInlineScripts.replace(
    /<link\b[^>]*\bhref=(["'])([^"']+)\1[^>]*>/gi,
    (tag, _quote: string, assetPath: string) => {
      if (!/\brel=(["'])stylesheet\1/i.test(tag)) {
        return /\brel=(["'])modulepreload\1/i.test(tag) ? "" : tag;
      }
      const asset = findViewerArtifactFile(artifact, assetPath);
      return asset && asset.contentType.includes("css")
        ? `<style>${escapeStyle(asset.content)}</style>`
        : tag;
    },
  );
}

function findViewerArtifactFile(
  artifact: CustomDashboardViewerArtifact,
  assetPath: string,
): CustomDashboardViewerArtifactFile | null {
  const normalized = normalizeViewerArtifactPath(assetPath);
  return artifact.files.find((file) => file.path === normalized) ?? null;
}

function normalizeViewerArtifactPath(assetPath: string): string {
  const withoutFragment = assetPath.split("#")[0]?.split("?")[0] ?? "";
  const trimmed = withoutFragment.replace(/^\/+/, "").replace(/^\.\//, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function getViewerArtifact(
  runtimeMetadata: CustomDashboardRevisionRecord["runtimeMetadata"],
): CustomDashboardViewerArtifact | null {
  const validation = runtimeMetadata.validation;
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    return null;
  }
  const artifact = (validation as Record<string, unknown>).viewerArtifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }
  const candidate = artifact as Record<string, unknown>;
  if (candidate.kind !== "vite-dist" || typeof candidate.entryFile !== "string" || !Array.isArray(candidate.files)) {
    return null;
  }
  const files = candidate.files.flatMap((file): CustomDashboardViewerArtifactFile[] => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      return [];
    }
    const entry = file as Record<string, unknown>;
    return typeof entry.path === "string" && typeof entry.content === "string"
      ? [{
          path: entry.path,
          content: entry.content,
          contentType: typeof entry.contentType === "string" ? entry.contentType : "text/plain",
        }]
      : [];
  });
  return files.length > 0 ? { kind: "vite-dist", entryFile: candidate.entryFile, files } : null;
}

function isHtmlEntry(path: string, contentType?: string): boolean {
  return path.endsWith(".html") || contentType?.includes("html") === true;
}

function isJavaScriptEntry(path: string, contentType?: string): boolean {
  return /\.(mjs|js)$/i.test(path) || contentType?.includes("javascript") === true;
}

function baseFrameStyle(): string {
  return [
    "<style>",
    "html,body{min-height:100%;margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,sans-serif;}",
    ".runtime-empty{display:grid;min-height:100vh;place-content:center;padding:2rem;text-align:center;}",
    ".runtime-empty h1{margin:0 0 .75rem;font-size:1.5rem;}",
    ".runtime-empty p{max-width:42rem;margin:.35rem auto;color:#475569;line-height:1.6;}",
    "</style>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

function escapeStyle(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style").replace(/<!--/g, "<\\!--");
}
