import { requestCustomDashboardRuntimeSource } from "./custom-dashboard-api.js";
import type {
  CustomDashboardJsonValue,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationReport,
} from "../types.js";
import {
  buildCustomDashboardLocation,
  getCustomDashboardRoutes,
  isCustomDashboardRouteDeclared,
  selectCustomDashboardRoute,
} from "./custom-dashboard-router.js";

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
  bridgeSessionId: string;
  routePath: string;
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
  type: "codeux-custom-dashboard:source-request" | "codeux-custom-dashboard:source-cancel" | "codeux-custom-dashboard:runtime-error" | "codeux-custom-dashboard:runtime-ready" | "codeux-custom-dashboard:route-change";
  requestId?: string;
  sourceId?: string;
  bridgeSessionId?: string;
  route?: string;
  method?: string;
  credentialSlot?: string;
  capability?: string;
  headers?: Record<string, string>;
  body?: CustomDashboardJsonValue;
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

export function resolvePublishedCustomDashboardRuntime(
  dashboard: CustomDashboardRecord,
  revisions: CustomDashboardRevisionRecord[],
  routePath = "/",
): CustomDashboardRuntimeResolution {
  const publishedRevision = dashboard.publishedRevisionId
    ? revisions.find((revision) => revision.id === dashboard.publishedRevisionId) ?? null
    : null;
  const validationReport = getLastValidationReport(revisions);

  if (dashboard.status === "archived") {
    return { status: "blocked", reason: "Archived custom dashboards cannot be opened.", validationReport, publishedRevision };
  }
  if (dashboard.runtimeState.status === "halted") {
    return {
      status: "blocked",
      reason: dashboard.runtimeState.haltedReason
        ? `This custom dashboard runtime is halted: ${dashboard.runtimeState.haltedReason}`
        : "This custom dashboard runtime is halted and requires an explicit validated resume or rollback.",
      validationReport,
      publishedRevision,
    };
  }
  if (dashboard.status !== "published") {
    return {
      status: "blocked",
      reason: "Only published custom dashboards can be opened. Validate and publish a revision first.",
      validationReport,
      publishedRevision,
    };
  }
  if (!dashboard.publishedRevisionId || !publishedRevision) {
    return {
      status: "blocked",
      reason: "This custom dashboard has no published revision.",
      validationReport,
      publishedRevision,
    };
  }
  if (publishedRevision.validationStatus !== "passed" || publishedRevision.validationReport?.valid !== true) {
    return {
      status: "blocked",
      reason: "The published revision no longer has a passed validation report.",
      validationReport: publishedRevision.validationReport ?? validationReport,
      publishedRevision,
    };
  }

  const bridgeSessionId = createBridgeSessionId();
  const selectedRoute = selectCustomDashboardRoute(
    publishedRevision.routes,
    routePath,
    publishedRevision.manifest.entryFile,
  );
  const selectedRoutePath = selectedRoute?.path ?? "/";
  return {
    status: "ready",
    runtime: {
      dashboard,
      revision: publishedRevision,
      document: buildCustomDashboardFrameDocument(dashboard, publishedRevision, bridgeSessionId, selectedRoutePath),
      bridgeSessionId,
      routePath: selectedRoutePath,
    },
  };
}

export function buildCustomDashboardFrameDocument(
  dashboard: CustomDashboardRecord,
  revision: CustomDashboardRevisionRecord,
  bridgeSessionId = createBridgeSessionId(),
  routePath = "/",
): string {
  const selectedRoute = selectCustomDashboardRoute(revision.routes, routePath, revision.manifest.entryFile);
  const selectedEntryFile = selectedRoute?.entryFile ?? revision.manifest.entryFile;
  const entryFile = revision.fileBundle.files.find((file) => file.path === selectedEntryFile) ?? null;
  const bridgeConfig = {
    projectId: revision.projectId,
    dashboardId: dashboard.id,
    revisionId: revision.id,
    manifest: revision.manifest,
    sourceNodeGraph: revision.sourceNodeGraph,
    styleguide: revision.styleguide,
    runtimeMetadata: revision.runtimeMetadata,
    routes: getCustomDashboardRoutes(revision.routes, revision.manifest.entryFile),
    routePath: selectedRoute?.path ?? "/",
    bridgeSessionId,
  };
  const bootstrap = buildBridgeBootstrapScript(bridgeConfig);
  const title = escapeHtml(revision.manifest.title || dashboard.title);
  const viewerArtifact = getViewerArtifact(revision.runtimeMetadata);

  if (viewerArtifact) {
    return buildViewerArtifactDocument(viewerArtifact, bootstrap, title);
  }

  if (entryFile && isHtmlEntry(entryFile.path, entryFile.contentType)) {
    return injectBootstrapIntoHtml(entryFile.content, bootstrap, title, true);
  }

  if (entryFile && isJavaScriptEntry(entryFile.path, entryFile.contentType)) {
    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      legacyFrameSecurityPolicy(),
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
  runtime: CustomDashboardPublishedRuntime,
  source: CustomDashboardDataSourceNode,
  requestId: string,
  options: Pick<CustomDashboardRuntimeMessage, "route" | "method" | "credentialSlot" | "capability" | "headers" | "body"> = {},
  signal?: AbortSignal,
): Promise<CustomDashboardRuntimeSourceResult> {
  const response = await requestCustomDashboardRuntimeSource({
    requestId,
    projectId: runtime.revision.projectId,
    dashboardId: runtime.dashboard.id,
    revisionId: runtime.revision.id,
    access: { kind: "published" },
    sourceId: source.id,
    ...options,
  }, signal);
  return {
    sourceId: source.id,
    type: source.type,
    title: source.title,
    data: response.data,
  };
}

export function createCustomDashboardRuntimeMessageHandler(args: {
  frameWindow: Window | null;
  runtime: CustomDashboardPublishedRuntime;
  onRuntimeError: (message: string) => void;
  onRuntimeReady?: () => void;
  onRouteChange?: (path: string) => void;
  readinessTimeoutMs?: number;
  signal?: AbortSignal;
}): (event: MessageEvent) => void {
  const requests = new Map<string, AbortController>();
  let ready = false;
  let failureReported = false;
  const reportFailure = (reason: string): void => {
    if (failureReported || args.signal?.aborted) return;
    failureReported = true;
    const bounded = boundedRuntimeReason(reason);
    args.onRuntimeError(bounded);
    void persistCustomDashboardRuntimeHalt(args.runtime, bounded).catch(() => undefined);
  };
  const readinessTimer = globalThis.setTimeout(
    () => { if (!ready) reportFailure("Custom dashboard runtime failed to report readiness."); },
    args.readinessTimeoutMs ?? 10_000,
  );
  args.signal?.addEventListener("abort", () => {
    globalThis.clearTimeout(readinessTimer);
    for (const controller of requests.values()) controller.abort(args.signal?.reason);
    requests.clear();
  }, { once: true });
  return (event: MessageEvent) => {
    if (!args.frameWindow || event.source !== args.frameWindow || event.origin !== "null" || !isRuntimeMessage(event.data)
      || event.data.bridgeSessionId !== args.runtime.bridgeSessionId) {
      return;
    }
    const frameWindow = args.frameWindow;
    if (event.data.type === "codeux-custom-dashboard:runtime-ready") {
      ready = true;
      globalThis.clearTimeout(readinessTimer);
      args.onRuntimeReady?.();
      return;
    }
    if (event.data.type === "codeux-custom-dashboard:route-change") {
      if (typeof event.data.route === "string" && isCustomDashboardRouteDeclared(
        args.runtime.revision.routes,
        event.data.route,
        args.runtime.revision.manifest.entryFile,
      )) {
        args.onRouteChange?.(selectCustomDashboardRoute(
          args.runtime.revision.routes,
          event.data.route,
          args.runtime.revision.manifest.entryFile,
        )?.path ?? "/");
      }
      return;
    }
    if (event.data.type === "codeux-custom-dashboard:runtime-error") {
      reportFailure(event.data.message || "The custom dashboard frame reported an unknown runtime error.");
      return;
    }
    if (event.data.type === "codeux-custom-dashboard:source-cancel") {
      if (event.data.requestId) {
        requests.get(event.data.requestId)?.abort(new Error("Custom dashboard source request was cancelled."));
        requests.delete(event.data.requestId);
      }
      return;
    }
    const requestId = event.data.requestId;
    const sourceId = event.data.sourceId;
    if (!requestId || !sourceId) {
      postSourceResponse(args.frameWindow, args.runtime.bridgeSessionId, {
        requestId: requestId || "unknown",
        ok: false,
        error: "Custom dashboard source requests require requestId and sourceId.",
      });
      return;
    }
    const source = args.runtime.revision.sourceNodeGraph.nodes.find((node) => node.id === sourceId);
    if (!source) {
      postSourceResponse(frameWindow, args.runtime.bridgeSessionId, {
        requestId,
        ok: false,
        error: `Custom dashboard source not declared: ${sourceId}.`,
      });
      return;
    }
    if (requests.has(requestId) || requests.size >= 64) {
      postSourceResponse(frameWindow, args.runtime.bridgeSessionId, {
        requestId,
        ok: false,
        error: "Custom dashboard source request capacity was exceeded.",
      });
      return;
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", abort, { once: true });
    requests.set(requestId, controller);
    void resolveCustomDashboardRuntimeSource(args.runtime, source, requestId, event.data, controller.signal)
      .then((result) => postSourceResponse(frameWindow, args.runtime.bridgeSessionId, { requestId, ok: true, data: result.data }))
      .catch((error) => postSourceResponse(frameWindow, args.runtime.bridgeSessionId, {
        requestId,
        ok: false,
        error: boundedRuntimeError(error),
      }))
      .finally(() => {
        requests.delete(requestId);
        args.signal?.removeEventListener("abort", abort);
      });
  };
}

export async function persistCustomDashboardRuntimeHalt(
  runtime: CustomDashboardPublishedRuntime,
  reason: string,
): Promise<void> {
  const response = await fetch(`/api/custom-dashboards/${encodeURIComponent(runtime.dashboard.id)}/runtime/halt`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revisionId: runtime.revision.id,
      reason: boundedRuntimeReason(reason),
      recoveryMetadata: { source: "published_iframe", bridgeSessionId: runtime.bridgeSessionId },
    }),
  });
  if (!response.ok && response.status !== 409 && response.status !== 423) {
    throw new Error("Failed to persist the custom dashboard runtime halt.");
  }
}

export function buildPublishedCustomDashboardLink(dashboardId: string, origin = window.location.origin, routePath = "/"): string {
  return buildCustomDashboardLocation({ dashboardId, mode: "viewer", routePath }, origin).toString();
}

function getLastValidationReport(revisions: CustomDashboardRevisionRecord[]): CustomDashboardValidationReport | null {
  return [...revisions]
    .sort((left, right) => right.revisionNumber - left.revisionNumber)
    .find((revision) => revision.validationReport !== null)
    ?.validationReport ?? null;
}

function isRuntimeMessage(value: unknown): value is CustomDashboardRuntimeMessage {
  return Boolean(
    value
      && typeof value === "object"
      && "type" in value
      && (
        (value as { type?: unknown }).type === "codeux-custom-dashboard:source-request"
        || (value as { type?: unknown }).type === "codeux-custom-dashboard:source-cancel"
        || (value as { type?: unknown }).type === "codeux-custom-dashboard:runtime-error"
        || (value as { type?: unknown }).type === "codeux-custom-dashboard:runtime-ready"
        || (value as { type?: unknown }).type === "codeux-custom-dashboard:route-change"
      ),
  );
}

function postSourceResponse(
  frameWindow: Window,
  bridgeSessionId: string,
  response: { requestId: string; ok: true; data: CustomDashboardJsonValue } | { requestId: string; ok: false; error: string },
): void {
  frameWindow.postMessage({ type: CUSTOM_DASHBOARD_SOURCE_RESPONSE_TYPE, bridgeSessionId, ...response }, "*");
}

function buildBridgeBootstrapScript(config: Record<string, unknown>): string {
  return [
    "(() => {",
    `  const config = Object.freeze(${escapeScript(JSON.stringify(config))});`,
    "  const pending = new Map();",
    "  let seq = 0;",
    "  const parentOrigin = (() => { try { return new URL(document.referrer).origin; } catch { return '*'; } })();",
    "  const readSource = (sourceId, options = {}) => new Promise((resolve, reject) => {",
    "    if (pending.size >= 64) { reject(new Error('Custom dashboard source request capacity was exceeded.')); return; }",
    "    const requestId = `source-${Date.now()}-${++seq}`;",
    "    const cancel = () => { pending.delete(requestId); window.parent.postMessage({ type: 'codeux-custom-dashboard:source-cancel', bridgeSessionId: config.bridgeSessionId, requestId }, parentOrigin); reject(new DOMException('The source request was cancelled.', 'AbortError')); };",
    "    if (options.signal?.aborted) { cancel(); return; }",
    "    options.signal?.addEventListener('abort', cancel, { once: true });",
    "    pending.set(requestId, { resolve, reject, signal: options.signal, cancel });",
    "    window.parent.postMessage({ type: 'codeux-custom-dashboard:source-request', bridgeSessionId: config.bridgeSessionId, requestId, sourceId, route: options.route, method: options.method, credentialSlot: options.credentialSlot, capability: options.capability, headers: options.headers, body: options.body }, parentOrigin);",
    "  });",
    "  window.addEventListener('message', (event) => {",
    `    if (event.source !== window.parent || !event.data || event.data.type !== '${CUSTOM_DASHBOARD_SOURCE_RESPONSE_TYPE}' || event.data.bridgeSessionId !== config.bridgeSessionId) return;`,
    "    const entry = pending.get(event.data.requestId);",
    "    if (!entry) return;",
    "    pending.delete(event.data.requestId);",
    "    entry.signal?.removeEventListener('abort', entry.cancel);",
    "    if (event.data.ok) entry.resolve(event.data.data);",
    "    else entry.reject(new Error(String(event.data.error || 'Custom dashboard source request failed.').slice(0, 320)));",
    "  });",
    "  const bridge = Object.freeze({",
    "    ...config,",
    "    listSources: () => config.sourceNodeGraph?.nodes ? [...config.sourceNodeGraph.nodes] : [],",
    "    readSource,",
    "    get routePath() { return currentRoute; },",
    "    navigate: (path, options = {}) => navigate(path, options),",
    "  });",
    "  Object.defineProperty(window, 'codeUxDataBridge', { value: bridge, writable: false, configurable: false });",
    "  Object.defineProperty(window, 'CodeUXCustomDashboard', { value: bridge, writable: false, configurable: false });",
    "  const normalizePath = (value) => { const parts = String(value || '/').split(/[?#]/, 1)[0].replace(/\\\\/g, '/').split('/').filter(Boolean); const out = []; for (const part of parts) { if (part === '.') continue; if (part === '..') out.pop(); else out.push(part); } return `/${out.join('/')}`; };",
    "  const declaredRoutes = Array.isArray(config.routes) ? config.routes : [];",
    "  const isDeclared = (path) => declaredRoutes.length === 0 || declaredRoutes.some((route) => normalizePath(route.path) === path);",
    "  const selectDeclared = (path) => { const normalized = normalizePath(path); return declaredRoutes.find((route) => normalizePath(route.path) === normalized) || declaredRoutes.find((route) => normalizePath(route.path) === '/') || declaredRoutes[0] || { path: '/' }; };",
    "  let currentRoute = normalizePath(selectDeclared(config.routePath).path);",
    "  const emitRoute = () => window.parent.postMessage({ type: 'codeux-custom-dashboard:route-change', bridgeSessionId: config.bridgeSessionId, route: currentRoute }, parentOrigin);",
    "  const navigate = (path, options = {}) => { const next = normalizePath(path); if (!isDeclared(next)) throw new Error(`Custom dashboard route is not declared: ${next}`); currentRoute = next; const hash = `#${next}`; if (options.replace) history.replaceState({ route: next }, '', hash); else history.pushState({ route: next }, '', hash); emitRoute(); window.dispatchEvent(new CustomEvent('codeux:dashboard-route', { detail: { path: next } })); return next; };",
    "  window.addEventListener('popstate', (event) => { const restored = normalizePath(event.state?.route || location.hash.slice(1) || config.routePath); currentRoute = normalizePath(selectDeclared(restored).path); emitRoute(); window.dispatchEvent(new CustomEvent('codeux:dashboard-route', { detail: { path: currentRoute } })); });",
    "  history.replaceState({ route: currentRoute }, '', `#${currentRoute}`);",
    "  let runtimeStateReported = false;",
    "  const report = (message) => { if (runtimeStateReported) return; runtimeStateReported = true; window.parent.postMessage({ type: 'codeux-custom-dashboard:runtime-error', bridgeSessionId: config.bridgeSessionId, message: String(message).slice(0, 320) }, parentOrigin); };",
    "  window.addEventListener('error', (event) => report(event.message || 'Custom dashboard runtime error.'));",
    "  window.addEventListener('unhandledrejection', (event) => report(event.reason?.message || String(event.reason || 'Unhandled custom dashboard rejection.')));",
    "  window.addEventListener('DOMContentLoaded', () => {",
    "    if (!document.body || document.body.childElementCount === 0) { report('Custom dashboard runtime produced no usable document body.'); return; }",
    "    if (!runtimeStateReported) { window.parent.postMessage({ type: 'codeux-custom-dashboard:runtime-ready', bridgeSessionId: config.bridgeSessionId }, parentOrigin); emitRoute(); }",
    "  }, { once: true });",
    "})();",
  ].join("\n");
}

function injectBootstrapIntoHtml(html: string, bootstrap: string, title: string, legacySource = false): string {
  const script = `<script>${bootstrap}</script>`;
  const securityPolicy = legacySource ? `${legacyFrameSecurityPolicy()}\n` : "";
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n${securityPolicy}${baseFrameStyle()}\n<title>${title}</title>\n${script}`);
  }
  if (legacySource && /<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b[^>]*>/i, (body) => `<head>${securityPolicy}${baseFrameStyle()}\n<title>${title}</title>\n${script}</head>\n${body}`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${securityPolicy}${script}\n</body>`);
  }
  return `${securityPolicy}${script}\n${html}`;
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

function legacyFrameSecurityPolicy(): string {
  return "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data:; media-src data: blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\" />";
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

function createBridgeSessionId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function boundedRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Custom dashboard source request failed.";
  return message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 320) || "Custom dashboard source request failed.";
}

function boundedRuntimeReason(reason: string): string {
  return reason
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b(Bearer)\s+[^\s]+/gi, "$1 [REDACTED]")
    .replace(/\b(api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320) || "Custom dashboard runtime became unusable.";
}
