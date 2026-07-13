import * as fs from "fs/promises";
import * as path from "path";
import * as pathPosix from "path/posix";
import type {
  CustomDashboardJsonObject,
  CustomDashboardRevisionRecord,
} from "../contracts/custom-dashboard-types.js";
import { isPathInside } from "../utils/path-validator.js";

export const CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES = 200;
export const CUSTOM_DASHBOARD_VALIDATION_MAX_LOG_TAIL_LINES = 1000;

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
}

export interface MaterializedCustomDashboardWorkspace {
  workspacePath: string;
  entryImportPath: string;
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
  assertBundleOmitsCredentialBindingIds(args.revision);
  // workspacePath is returned by resolveContainedCustomDashboardPath after
  // lexical and realpath containment checks against the project runtime root.
  // codeql[js/path-injection]
  await fs.rm(args.workspacePath, { recursive: true, force: true });
  // codeql[js/path-injection]
  await fs.mkdir(args.workspacePath, { recursive: true });

  for (const file of args.revision.fileBundle.files) {
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
  const safeBridgeConfig = sanitizeBridgeValue(args.bridgeConfig, credentialBindingIds(args.revision));

  await Promise.all([
    writeJsonFile(packageJsonPath, buildPackageJson()),
    writeTextFile(indexHtmlPath, buildIndexHtml()),
    writeTextFile(viteConfigPath, buildViteConfig()),
    writeTextFile(tsConfigPath, buildTsConfig()),
    writeTextFile(dataBridgePath, buildDataBridgeModule(safeBridgeConfig)),
    writeTextFile(harnessEntryPath, buildHarnessEntry(entryImportPath)),
  ]);

  return {
    workspacePath: args.workspacePath,
    entryImportPath,
  };
}

export function normalizeCustomDashboardBundlePath(input: string): string {
  const normalized = input.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error(`Invalid custom dashboard bundle path: ${input}`);
  }
  const collapsed = pathPosix.normalize(normalized);
  if (collapsed === "." || collapsed.startsWith("../") || collapsed === "..") {
    throw new Error(`Custom dashboard bundle path escapes the workspace: ${input}`);
  }
  if (collapsed.split("/").includes("node_modules")) {
    throw new Error(`Custom dashboard bundle path cannot target node_modules: ${input}`);
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
  const body = content.trim().length > 0 ? content.trimEnd() : "(no output)";
  // codeql[js/path-injection]
  await fs.appendFile(logPath, `\n## ${section}\n${body}\n`, "utf8");
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

export function buildBridgeConfig(revision: CustomDashboardRevisionRecord): CustomDashboardBridgeConfig {
  const config: CustomDashboardBridgeConfig = {
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
  };
  return sanitizeBridgeValue(config, credentialBindingIds(revision));
}

function assertBundleOmitsCredentialBindingIds(revision: CustomDashboardRevisionRecord): void {
  const bindingIds = credentialBindingIds(revision);
  if (bindingIds.size === 0) return;
  if (revision.fileBundle.files.some((file) => [...bindingIds].some((credentialId) => file.content.includes(credentialId)))) {
    throw new Error("Custom dashboard file bundles cannot contain credential binding identifiers.");
  }
}

function credentialBindingIds(revision: CustomDashboardRevisionRecord): Set<string> {
  return new Set((revision.credentialBindings ?? []).map((binding) => binding.credentialId));
}

function sanitizeBridgeValue<T>(value: T, excludedIdentifiers: ReadonlySet<string>): T {
  return sanitizeBridgeUnknown(value, excludedIdentifiers) as T;
}

function sanitizeBridgeUnknown(value: unknown, excludedIdentifiers: ReadonlySet<string>): unknown {
  if (typeof value === "string") {
    return excludedIdentifiers.has(value) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeBridgeUnknown(entry, excludedIdentifiers))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return value;

  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "credentialbindings"
      || normalizedKey === "credentialbindingrevision"
      || normalizedKey === "credentialid") {
      continue;
    }
    const sanitized = sanitizeBridgeUnknown(entry, excludedIdentifiers);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
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

function buildPackageJson(): Record<string, unknown> {
  return {
    private: true,
    type: "module",
    scripts: {
      build: "vite build",
      start: "vite preview --host 0.0.0.0",
    },
    dependencies: {
      "@preact/preset-vite": "^2.10.5",
      "@preact/signals": "^2.9.0",
      "preact": "^10.29.0",
      "typescript": "^5.9.3",
      "vite": "^8.0.8",
    },
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
    "",
    "export default defineConfig({",
    "  plugins: [preact()],",
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
    "export const codeUxDataBridge = Object.freeze(",
    `${JSON.stringify(config, null, 2)}`,
    ");",
    "",
    "export type CodeUxDataBridge = typeof codeUxDataBridge;",
    "",
  ].join("\n");
}

function buildHarnessEntry(entryImportPath: string): string {
  return [
    "import { h, render } from \"preact\";",
    "import { codeUxDataBridge } from \"./codeux-data-bridge\";",
    `import * as DashboardModule from ${JSON.stringify(entryImportPath)};`,
    "",
    "const root = document.getElementById(\"app\");",
    "const Candidate = (DashboardModule.default ?? DashboardModule.Dashboard ?? DashboardModule.App) as unknown;",
    "",
    "if (root && typeof Candidate === \"function\") {",
    "  render(h(Candidate as never, { codeUxDataBridge }), root);",
    "} else if (root) {",
    "  root.dataset.codeUxValidationReady = \"true\";",
    "}",
    "",
    "Object.defineProperty(window, \"codeUxDataBridge\", {",
    "  value: codeUxDataBridge,",
    "  writable: false,",
    "  configurable: false,",
    "});",
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
