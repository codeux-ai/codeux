import * as fs from "fs/promises";
import * as path from "path";
import * as pathPosix from "path/posix";
import type {
  CustomDashboardJsonObject,
  CustomDashboardRevisionRecord,
} from "../contracts/custom-dashboard-types.js";

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

export async function materializeCustomDashboardWorkspace(args: {
  revision: CustomDashboardRevisionRecord;
  workspacePath: string;
  bridgeConfig: CustomDashboardBridgeConfig;
}): Promise<MaterializedCustomDashboardWorkspace> {
  await fs.rm(args.workspacePath, { recursive: true, force: true });
  await fs.mkdir(args.workspacePath, { recursive: true });

  for (const file of args.revision.fileBundle.files) {
    const safeRelativePath = normalizeCustomDashboardBundlePath(file.path);
    const absolutePath = path.join(args.workspacePath, safeRelativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, "utf8");
  }

  const harnessDir = path.join(args.workspacePath, ".codeux-harness");
  await fs.mkdir(harnessDir, { recursive: true });
  const entryPath = normalizeCustomDashboardBundlePath(args.revision.manifest.entryFile);
  const entryImportPath = toRelativeImportPath(".codeux-harness/main.tsx", entryPath);

  await Promise.all([
    writeJsonFile(path.join(args.workspacePath, "package.json"), buildPackageJson()),
    fs.writeFile(path.join(args.workspacePath, "index.html"), buildIndexHtml(), "utf8"),
    fs.writeFile(path.join(args.workspacePath, "vite.config.ts"), buildViteConfig(), "utf8"),
    fs.writeFile(path.join(args.workspacePath, "tsconfig.json"), buildTsConfig(), "utf8"),
    fs.writeFile(
      path.join(harnessDir, "codeux-data-bridge.ts"),
      buildDataBridgeModule(args.bridgeConfig),
      "utf8",
    ),
    fs.writeFile(
      path.join(harnessDir, "main.tsx"),
      buildHarnessEntry(entryImportPath),
      "utf8",
    ),
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

export async function appendValidationLog(logPath: string, section: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const body = content.trim().length > 0 ? content.trimEnd() : "(no output)";
  await fs.appendFile(logPath, `\n## ${section}\n${body}\n`, "utf8");
}

export async function readValidationLog(logPath: string | null | undefined, tail: number): Promise<string> {
  if (!logPath) {
    return "";
  }
  try {
    return tailLogLines(await fs.readFile(logPath, "utf8"), tail);
  } catch {
    return "";
  }
}

export function buildBridgeConfig(revision: CustomDashboardRevisionRecord): CustomDashboardBridgeConfig {
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

async function writeJsonFile(filePath: string, value: Record<string, unknown>): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
