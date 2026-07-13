import * as fs from "fs/promises";
import * as path from "path";
import * as pathPosix from "path/posix";
import type {
  CustomDashboardBuildManifest,
  CustomDashboardBuildDependency,
  CustomDashboardJsonObject,
  CustomDashboardRevisionRecord,
} from "../contracts/custom-dashboard-types.js";
import { isPathInside } from "../utils/path-validator.js";

export const CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES = 200;
export const CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_TAIL_LINES = 1000;
export const CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_BYTES = 256 * 1024;
export const CUSTOM_DASHBOARD_MAX_SOURCE_FILES = 128;
export const CUSTOM_DASHBOARD_MAX_SOURCE_FILE_BYTES = 512 * 1024;
export const CUSTOM_DASHBOARD_MAX_SOURCE_TOTAL_BYTES = 2 * 1024 * 1024;

const SUPPORTED_SOURCE_EXTENSION = /\.(?:ts|tsx|css)$/i;
const TYPESCRIPT_ENTRY_EXTENSION = /\.(?:ts|tsx)$/i;
const RESERVED_CONFIGURATION_FILE = /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.npmrc|vite\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|postcss\.config\.[^/]+|tailwind\.config\.[^/]+)$/i;
const RAW_SECRET_LITERAL = /(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|secret)\s*(?::|=)\s*["'`](?!\s*(?:"|'|`))[^"'`\r\n]{4,}["'`]|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}/i;

export const CUSTOM_DASHBOARD_BUILD_DEPENDENCIES: Record<CustomDashboardBuildDependency, string> = Object.freeze({
  "@preact/preset-vite": "2.10.5",
  "@preact/signals": "2.9.0",
  "@tailwindcss/vite": "4.2.1",
  preact: "10.29.0",
  tailwindcss: "4.2.1",
  typescript: "5.9.3",
  vite: "8.0.8",
});

export interface CustomDashboardBridgeConfig {
  projectId: string;
  dashboardId: string;
  revisionId: string;
  manifest: CustomDashboardRevisionRecord["manifest"];
  sourceNodeGraph: CustomDashboardRevisionRecord["sourceNodeGraph"];
  styleguide: CustomDashboardRevisionRecord["styleguide"];
  runtimeMetadata: CustomDashboardJsonObject;
  integrations: CustomDashboardJsonObject;
  externalApiNodes: CustomDashboardJsonObject[];
  routes: CustomDashboardRevisionRecord["routes"];
  runtimeAccess: { kind: "validation"; sessionId: string };
}

export interface MaterializedCustomDashboardWorkspace {
  workspacePath: string;
  entryImportPath: string;
  buildManifest: CustomDashboardBuildManifest;
}

declare const validatedCustomDashboardPathBrand: unique symbol;

export type ValidatedCustomDashboardPath = string & {
  readonly [validatedCustomDashboardPathBrand]: true;
};

function asValidatedCustomDashboardPath(candidate: string): ValidatedCustomDashboardPath {
  return candidate as ValidatedCustomDashboardPath;
}

async function findExistingAncestor(candidate: string): Promise<{ path: string; realPath: string }> {
  let current = path.resolve(candidate);
  while (true) {
    try {
      // current is being canonicalized as part of the containment guard; the
      // returned real path is checked before any caller uses the target path.
      // codeql[js/path-injection]
      return { path: current, realPath: await fs.realpath(current) };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Unable to canonicalize custom dashboard path: ${candidate}`);
      }
      current = parent;
    }
  }
}

export async function resolveContainedCustomDashboardPath(
  basePath: string,
  targetPath: string,
  label = "custom dashboard path",
): Promise<ValidatedCustomDashboardPath> {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathInside(resolvedBase, resolvedTarget)) {
    throw new Error(`${label} must stay inside the custom dashboard runtime directory.`);
  }

  // resolvedBase is the trusted runtime base for this containment check.
  // codeql[js/path-injection]
  const realBase = await fs.realpath(resolvedBase);
  const existingAncestor = await findExistingAncestor(resolvedTarget);
  if (!isPathInside(realBase, existingAncestor.realPath)) {
    throw new Error(`${label} must stay inside the custom dashboard runtime directory.`);
  }

  const canonicalTarget = path.resolve(
    existingAncestor.realPath,
    path.relative(existingAncestor.path, resolvedTarget),
  );
  if (!isPathInside(realBase, canonicalTarget)) {
    throw new Error(`${label} must stay inside the custom dashboard runtime directory.`);
  }
  return asValidatedCustomDashboardPath(canonicalTarget);
}

export async function materializeCustomDashboardWorkspace(args: {
  revision: CustomDashboardRevisionRecord;
  workspacePath: ValidatedCustomDashboardPath;
  bridgeConfig: CustomDashboardBridgeConfig;
}): Promise<MaterializedCustomDashboardWorkspace> {
  const buildManifest = buildCustomDashboardBuildManifest(args.revision);
  // workspacePath is returned by resolveContainedCustomDashboardPath after
  // lexical and realpath containment checks against the project runtime root.
  // codeql[js/path-injection]
  await fs.rm(args.workspacePath, { recursive: true, force: true });
  // codeql[js/path-injection]
  await fs.mkdir(args.workspacePath, { recursive: true });

  const fileByPath = new Map(args.revision.fileBundle.files.map((file) => [
    normalizeCustomDashboardBundlePath(file.path),
    file,
  ]));
  for (const declaredPath of buildManifest.sourceFiles) {
    const file = fileByPath.get(declaredPath);
    if (!file) {
      throw new Error(`Custom dashboard manifest declares a missing source file: ${declaredPath}`);
    }
    const safeRelativePath = normalizeCustomDashboardBundlePath(file.path);
    const absolutePath = await resolveContainedCustomDashboardPath(
      args.workspacePath,
      path.join(args.workspacePath, safeRelativePath),
      "custom dashboard bundle file path",
    );
    // absolutePath was resolved under the freshly created workspace and is
    // checked again before writing so symlinked parents cannot redirect output.
    // codeql[js/path-injection]
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const safeWritePath = await resolveContainedCustomDashboardPath(
      args.workspacePath,
      absolutePath,
      "custom dashboard bundle file path",
    );
    // codeql[js/path-injection]
    await fs.writeFile(safeWritePath, file.content, "utf8");
  }

  const harnessDir = await resolveContainedCustomDashboardPath(
    args.workspacePath,
    path.join(args.workspacePath, ".codeux-harness"),
    "custom dashboard harness directory",
  );
  // codeql[js/path-injection]
  await fs.mkdir(harnessDir, { recursive: true });
  const entryPath = normalizeCustomDashboardBundlePath(args.revision.manifest.entryFile);
  const entryImportPath = toRelativeImportPath(".codeux-harness/main.tsx", entryPath);
  const packageJsonPath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(args.workspacePath, "package.json"));
  const indexHtmlPath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(args.workspacePath, "index.html"));
  const viteConfigPath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(args.workspacePath, "vite.config.ts"));
  const tsConfigPath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(args.workspacePath, "tsconfig.json"));
  const dataBridgePath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(harnessDir, "codeux-data-bridge.ts"));
  const harnessEntryPath = await resolveContainedCustomDashboardPath(args.workspacePath, path.join(harnessDir, "main.tsx"));

  await Promise.all([
    writeJsonFile(packageJsonPath, buildPackageJson(buildManifest)),
    writeTextFile(indexHtmlPath, buildIndexHtml()),
    writeTextFile(viteConfigPath, buildViteConfig()),
    writeTextFile(tsConfigPath, buildTsConfig()),
    writeTextFile(dataBridgePath, buildDataBridgeModule(args.bridgeConfig)),
    writeTextFile(harnessEntryPath, buildHarnessEntry(buildManifest)),
  ]);

  return {
    workspacePath: args.workspacePath,
    entryImportPath,
    buildManifest,
  };
}

export function buildCustomDashboardBuildManifest(
  revision: CustomDashboardRevisionRecord,
): CustomDashboardBuildManifest {
  assertNoRawSecretJson({
    manifestMetadata: revision.manifest.metadata ?? {},
    runtimeMetadata: revision.runtimeMetadata,
    styleguide: revision.styleguide,
    sourceNodeGraph: revision.sourceNodeGraph,
    routes: revision.routes,
  });
  const declaredPaths = revision.manifest.filePaths.map(normalizeCustomDashboardBundlePath);
  if (declaredPaths.length === 0 || declaredPaths.length > CUSTOM_DASHBOARD_MAX_SOURCE_FILES) {
    throw new Error(`Custom dashboard manifest must declare between 1 and ${CUSTOM_DASHBOARD_MAX_SOURCE_FILES} source files.`);
  }
  if (new Set(declaredPaths).size !== declaredPaths.length) {
    throw new Error("Custom dashboard manifest contains duplicate source files.");
  }

  const bundlePaths = new Map<string, (typeof revision.fileBundle.files)[number]>();
  let totalBytes = 0;
  for (const file of revision.fileBundle.files) {
    const filePath = normalizeCustomDashboardBundlePath(file.path);
    if (bundlePaths.has(filePath)) {
      throw new Error(`Custom dashboard bundle contains a duplicate file: ${filePath}`);
    }
    if (RESERVED_CONFIGURATION_FILE.test(filePath) || !SUPPORTED_SOURCE_EXTENSION.test(filePath)) {
      throw new Error(`Unsupported custom dashboard source or package configuration: ${filePath}`);
    }
    if (!declaredPaths.includes(filePath)) {
      throw new Error(`Custom dashboard bundle file is not declared in manifest.filePaths: ${filePath}`);
    }
    const size = Buffer.byteLength(file.content, "utf8");
    if (size > CUSTOM_DASHBOARD_MAX_SOURCE_FILE_BYTES) {
      throw new Error(`Custom dashboard source file is too large: ${filePath}`);
    }
    totalBytes += size;
    if (totalBytes > CUSTOM_DASHBOARD_MAX_SOURCE_TOTAL_BYTES) {
      throw new Error("Custom dashboard source bundle exceeds the maximum allowed size.");
    }
    if (RAW_SECRET_LITERAL.test(file.content)) {
      throw new Error(`Custom dashboard source contains a raw secret literal: ${filePath}`);
    }
    bundlePaths.set(filePath, file);
  }
  for (const declaredPath of declaredPaths) {
    if (!bundlePaths.has(declaredPath)) {
      throw new Error(`Custom dashboard manifest declares a missing source file: ${declaredPath}`);
    }
  }

  const entryFile = normalizeCustomDashboardBundlePath(revision.manifest.entryFile);
  assertDeclaredTypeScriptEntry(entryFile, declaredPaths, "manifest entryFile");
  const routes = revision.routes.map((route) => {
    const routeEntry = normalizeCustomDashboardBundlePath(route.entryFile);
    assertDeclaredTypeScriptEntry(routeEntry, declaredPaths, `route entryFile for ${route.path}`);
    return { ...route, entryFile: routeEntry };
  });

  return {
    entryFile,
    sourceFiles: declaredPaths,
    styleEntries: declaredPaths.filter((filePath) => /\.css$/i.test(filePath)),
    routes,
    dependencies: { ...CUSTOM_DASHBOARD_BUILD_DEPENDENCIES },
  };
}

function assertNoRawSecretJson(value: unknown, pathSegments: string[] = []): void {
  if (typeof value === "string") {
    const field = pathSegments.at(-1) ?? "value";
    const sensitiveField = /^(?:authorization|api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|secret|credentialValue)$/i;
    if ((sensitiveField.test(field) && value.trim().length > 0)
      || /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}/i.test(value)) {
      throw new Error(`Custom dashboard metadata contains a raw secret literal at ${pathSegments.join(".") || "metadata"}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawSecretJson(entry, [...pathSegments, String(index)]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoRawSecretJson(entry, [...pathSegments, key]);
    }
  }
}

function assertDeclaredTypeScriptEntry(entryFile: string, declaredPaths: string[], label: string): void {
  if (!TYPESCRIPT_ENTRY_EXTENSION.test(entryFile)) {
    throw new Error(`Custom dashboard ${label} must be a TypeScript or TSX file: ${entryFile}`);
  }
  if (!declaredPaths.includes(entryFile)) {
    throw new Error(`Custom dashboard ${label} must be declared in manifest.filePaths: ${entryFile}`);
  }
}

export function normalizeCustomDashboardBundlePath(input: string): string {
  const normalized = input.trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.includes("\\")) {
    throw new Error(`Invalid custom dashboard bundle path: ${input}`);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    throw new Error(`Invalid custom dashboard bundle path: ${input}`);
  }
  const collapsed = pathPosix.normalize(normalized);
  if (collapsed !== normalized || collapsed === "." || collapsed.startsWith("../") || collapsed === "..") {
    throw new Error(`Custom dashboard bundle path escapes the workspace: ${input}`);
  }
  if (collapsed.split("/").some((segment) => segment === "node_modules" || segment === ".codeux-harness")) {
    throw new Error(`Custom dashboard bundle path targets a server-controlled directory: ${input}`);
  }
  return collapsed;
}

export function tailLogLines(logs: string, tail: number): string {
  const boundedTail = Math.max(1, Math.min(CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_TAIL_LINES, Math.round(tail)));
  const lines = logs.split(/\r?\n/);
  return lines.slice(-boundedTail).join("\n");
}

export async function appendValidationLog(logPath: ValidatedCustomDashboardPath, section: string, content: string): Promise<void> {
  // logPath is a validated runtime-contained path; its parent is created only
  // after that realpath containment check.
  // codeql[js/path-injection]
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const body = sanitizeValidationOutput(content.trim().length > 0 ? content.trimEnd() : "(no output)");
  let existing = "";
  try {
    existing = await fs.readFile(logPath, "utf8");
  } catch {
    // A missing first-run log is expected.
  }
  const next = `${existing}\n## ${section}\n${body}\n`;
  const bounded = Buffer.byteLength(next, "utf8") <= CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_BYTES
    ? next
    : Buffer.from(next, "utf8").subarray(-CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_BYTES).toString("utf8");
  // codeql[js/path-injection]
  await fs.writeFile(logPath, bounded, "utf8");
}

export function sanitizeValidationOutput(content: string): string {
  return content
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

export async function readValidationLog(logPath: ValidatedCustomDashboardPath | null | undefined, tail: number): Promise<string> {
  if (!logPath) {
    return "";
  }
  try {
    // logPath is returned by resolveContainedCustomDashboardPath before it is
    // read from the validation runtime directory.
    // codeql[js/path-injection]
    return tailLogLines(await fs.readFile(logPath, "utf8"), tail);
  } catch {
    return "";
  }
}

export function buildBridgeConfig(
  revision: CustomDashboardRevisionRecord,
  validationSessionId: string,
): CustomDashboardBridgeConfig {
  return {
    projectId: revision.projectId,
    dashboardId: revision.dashboardId,
    revisionId: revision.id,
    manifest: revision.manifest,
    sourceNodeGraph: revision.sourceNodeGraph,
    styleguide: revision.styleguide,
    runtimeMetadata: revision.runtimeMetadata,
    integrations: extractJsonObject(revision.runtimeMetadata.integrations),
    externalApiNodes: revision.sourceNodeGraph.nodes
      .filter((node) => node.type === "external_api")
      .map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        config: extractJsonObject(node.config),
      })),
    routes: revision.routes,
    runtimeAccess: { kind: "validation", sessionId: validationSessionId },
  };
}

function extractJsonObject(value: unknown): CustomDashboardJsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CustomDashboardJsonObject
    : {};
}

function toRelativeImportPath(fromPath: string, toPath: string): string {
  const relative = pathPosix.relative(pathPosix.dirname(fromPath), toPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function buildPackageJson(buildManifest: CustomDashboardBuildManifest): Record<string, unknown> {
  return {
    private: true,
    type: "module",
    scripts: {
      build: "tsc --noEmit && vite build",
      start: "vite preview --host 0.0.0.0",
    },
    dependencies: buildManifest.dependencies,
    devDependencies: {},
  };
}

function buildIndexHtml(): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "    <title>Code UX Custom Dashboard Validation</title>",
    "  </head>",
    "  <body>",
    "    <div id=\"app\"></div>",
    "    <script type=\"module\" src=\"/.codeux-harness/main.tsx\"></script>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function buildViteConfig(): string {
  return [
    "import { defineConfig } from \"vite\";",
    "import preact from \"@preact/preset-vite\";",
    "import tailwindcss from \"@tailwindcss/vite\";",
    "",
    "export default defineConfig({",
    "  plugins: [preact(), tailwindcss()],",
    "  build: { sourcemap: false, emptyOutDir: true },",
    "  server: { host: \"0.0.0.0\" },",
    "  preview: { host: \"0.0.0.0\" },",
    "});",
    "",
  ].join("\n");
}

function buildTsConfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      jsxImportSource: "preact",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["vite/client"],
    },
    include: ["**/*.ts", "**/*.tsx"],
  }, null, 2)}\n`;
}

function buildDataBridgeModule(config: CustomDashboardBridgeConfig): string {
  return [
    `const config = Object.freeze(${JSON.stringify(config, null, 2)});`,
    "const normalizePath = (value: string): string => { const parts = String(value || '/').split(/[?#]/, 1)[0].replace(/\\\\/g, '/').split('/').filter(Boolean); const out: string[] = []; for (const part of parts) { if (part === '.') continue; if (part === '..') out.pop(); else out.push(part); } return `/${out.join('/')}`; };",
    "const declaredRoutes = config.routes.length > 0 ? config.routes : [{ path: '/', label: 'Overview', entryFile: config.manifest.entryFile }];",
    "const selectDeclaredRoute = (value: string) => { const normalized = normalizePath(value); return declaredRoutes.find((route) => normalizePath(route.path) === normalized) ?? declaredRoutes.find((route) => normalizePath(route.path) === '/') ?? declaredRoutes[0]; };",
    "const initialRoute = new URLSearchParams(window.location.search).get('route') ?? window.location.hash.slice(1) ?? '/';",
    "let currentRoute = normalizePath(selectDeclaredRoute(initialRoute)?.path ?? '/');",
    "const isDeclared = (value: string): boolean => { const normalized = normalizePath(value); return declaredRoutes.some((route) => normalizePath(route.path) === normalized); };",
    "const emitRoute = (): void => window.dispatchEvent(new CustomEvent('codeux:dashboard-route', { detail: { path: currentRoute } }));",
    "const navigate = (value: string, options: { replace?: boolean } = {}): string => { const next = normalizePath(value); if (!isDeclared(next)) throw new Error(`Custom dashboard route is not declared: ${next}`); currentRoute = next; if (options.replace) history.replaceState({ route: next }, '', `#${next}`); else history.pushState({ route: next }, '', `#${next}`); emitRoute(); return next; };",
    "window.addEventListener('popstate', (event) => { const restored = normalizePath((event.state as { route?: string } | null)?.route ?? window.location.hash.slice(1) ?? initialRoute); currentRoute = normalizePath(selectDeclaredRoute(restored)?.path ?? '/'); emitRoute(); });",
    "history.replaceState({ route: currentRoute }, '', `#${currentRoute}`);",
    "let sequence = 0;",
    "const readSource = async (sourceId: string, options: { route?: string; method?: string; credentialSlot?: string; capability?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}) => {",
    "  const requestId = `validation-${Date.now()}-${++sequence}`;",
    "  const response = await fetch('/api/custom-dashboard-runtime/source', {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json', 'x-request-id': requestId },",
    "    credentials: 'same-origin',",
    "    signal: options.signal,",
    "    body: JSON.stringify({ requestId, projectId: config.projectId, dashboardId: config.dashboardId, revisionId: config.revisionId, access: config.runtimeAccess, sourceId, route: options.route, method: options.method, credentialSlot: options.credentialSlot, capability: options.capability, headers: options.headers, body: options.body }),",
    "  });",
    "  const payload = await response.json().catch(() => null);",
    "  if (!response.ok) throw new Error(payload?.error?.message || 'Custom dashboard source request failed.');",
    "  return payload.data;",
    "};",
    "export const codeUxDataBridge = Object.freeze({ ...config, get routePath() { return currentRoute; }, navigate, listSources: () => [...config.sourceNodeGraph.nodes], readSource });",
    "",
    "export type CodeUxDataBridge = typeof codeUxDataBridge;",
    "",
  ].join("\n");
}

function buildHarnessEntry(buildManifest: CustomDashboardBuildManifest): string {
  const entries = [buildManifest.entryFile, ...buildManifest.routes.map((route) => route.entryFile)]
    .filter((entry, index, values) => values.indexOf(entry) === index);
  const imports = entries.map((entry, index) =>
    `import * as DashboardModule${index} from ${JSON.stringify(toRelativeImportPath(".codeux-harness/main.tsx", entry))};`
  );
  const styleImports = buildManifest.styleEntries.map((entry) =>
    `import ${JSON.stringify(toRelativeImportPath(".codeux-harness/main.tsx", entry))};`
  );
  const moduleIndex = new Map(entries.map((entry, index) => [entry, index]));
  const routes = buildManifest.routes.map((route) => ({
    path: route.path,
    moduleIndex: moduleIndex.get(route.entryFile) ?? 0,
  }));
  return [
    "import { h, render } from \"preact\";",
    "import { codeUxDataBridge } from \"./codeux-data-bridge\";",
    ...imports,
    ...styleImports,
    "",
    "const root = document.getElementById(\"app\");",
    `const dashboardModules = [${entries.map((_entry, index) => `DashboardModule${index}`).join(", ")}];`,
    `const routes = ${JSON.stringify(routes)} as const;`,
    "const runtimeWindow = window as Window & { CodeUXCustomDashboard?: typeof codeUxDataBridge; codeUxDataBridge?: typeof codeUxDataBridge };",
    "const runtimeBridge = runtimeWindow.CodeUXCustomDashboard ?? runtimeWindow.codeUxDataBridge ?? codeUxDataBridge;",
    "const normalizePath = (value: string): string => { const parts = String(value || '/').split(/[?#]/, 1)[0].replace(/\\\\/g, '/').split('/').filter(Boolean); const out: string[] = []; for (const part of parts) { if (part === '.') continue; if (part === '..') out.pop(); else out.push(part); } return `/${out.join('/')}`; };",
    "const selectRoute = (value: string) => { const normalized = normalizePath(value); return routes.find((candidate) => normalizePath(candidate.path) === normalized) ?? routes.find((candidate) => normalizePath(candidate.path) === '/') ?? routes[0]; };",
    "const renderRoute = (): void => {",
    "  const DashboardModule = dashboardModules[selectRoute(runtimeBridge.routePath)?.moduleIndex ?? 0];",
    "  const Candidate = (DashboardModule.default ?? DashboardModule.Dashboard ?? DashboardModule.App) as unknown;",
    "",
    "  if (root && typeof Candidate === \"function\") {",
    "    render(h(Candidate as never, { codeUxDataBridge: runtimeBridge }), root);",
    "  } else if (root) {",
    "    root.dataset.codeUxValidationReady = \"true\";",
    "  }",
    "};",
    "renderRoute();",
    "window.addEventListener('codeux:dashboard-route', renderRoute);",
    "",
    "if (!runtimeWindow.codeUxDataBridge) Object.defineProperty(window, \"codeUxDataBridge\", { value: runtimeBridge, writable: false, configurable: false });",
    "",
  ].join("\n");
}

async function writeJsonFile(filePath: ValidatedCustomDashboardPath, value: Record<string, unknown>): Promise<void> {
  // filePath is a workspace-contained path resolved through
  // resolveContainedCustomDashboardPath immediately before this helper is used.
  // codeql[js/path-injection]
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(filePath: ValidatedCustomDashboardPath, content: string): Promise<void> {
  // filePath is a workspace-contained path resolved through
  // resolveContainedCustomDashboardPath immediately before this helper is used.
  // codeql[js/path-injection]
  await fs.writeFile(filePath, content, "utf8");
}
