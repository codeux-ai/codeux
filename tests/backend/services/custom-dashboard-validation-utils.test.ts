import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CustomDashboardRevisionRecord } from "../../../src/contracts/custom-dashboard-types.js";
import {
  buildCustomDashboardBuildManifest,
  CUSTOM_DASHBOARD_BUILD_DEPENDENCIES,
  CUSTOM_DASHBOARD_MAX_SOURCE_FILE_BYTES,
  materializeCustomDashboardWorkspace,
  normalizeCustomDashboardBundlePath,
  resolveContainedCustomDashboardPath,
} from "../../../src/services/custom-dashboard-validation-utils.js";

const tempDirs: string[] = [];

async function mkTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function revision(overrides: Partial<CustomDashboardRevisionRecord> = {}): CustomDashboardRevisionRecord {
  return {
    id: "revision-1",
    dashboardId: "dashboard-1",
    projectId: "project-1",
    revisionNumber: 1,
    manifest: {
      schemaVersion: 1,
      title: "Delivery Pulse",
      entryFile: "src/dashboard.tsx",
      filePaths: ["src/dashboard.tsx"],
    },
    fileBundle: {
      files: [
        { path: "src/dashboard.tsx", content: "export default function Dashboard() { return null; }" },
      ],
    },
    sourceNodeGraph: { nodes: [], edges: [] },
    credentialBindings: [],
    routes: [],
    styleguide: {},
    validationStatus: null,
    validationReport: null,
    runtimeMetadata: {},
    validatedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("custom dashboard validation filesystem utilities", () => {
  it("materializes bundle and harness files inside a validated workspace", async () => {
    const runtimeRoot = await mkTempDir("custom-dashboard-runtime-");
    const workspacePath = await resolveContainedCustomDashboardPath(runtimeRoot, path.join(runtimeRoot, "workspace"));

    const materialized = await materializeCustomDashboardWorkspace({
      revision: revision(),
      workspacePath,
      bridgeConfig: {
        projectId: "project-1",
        dashboardId: "dashboard-1",
        revisionId: "revision-1",
        manifest: revision().manifest,
        sourceNodeGraph: { nodes: [], edges: [] },
        styleguide: {},
        runtimeMetadata: {},
        integrations: {},
        externalApiNodes: [],
        runtimeAccess: { kind: "validation", sessionId: "session-1" },
      },
    });

    expect(materialized.entryImportPath).toBe("../src/dashboard.tsx");
    expect(materialized.buildManifest.dependencies).toEqual(CUSTOM_DASHBOARD_BUILD_DEPENDENCIES);
    await expect(fs.readFile(path.join(workspacePath, "src", "dashboard.tsx"), "utf8")).resolves.toContain("Dashboard");
    await expect(fs.readFile(path.join(workspacePath, ".codeux-harness", "main.tsx"), "utf8")).resolves.toContain("DashboardModule");
    await expect(fs.readFile(path.join(workspacePath, "package.json"), "utf8")).resolves.toContain("tsc --noEmit && vite build");
    await expect(fs.readFile(path.join(workspacePath, "vite.config.ts"), "utf8")).resolves.toContain("tailwindcss()");
  });

  it("preserves declared Tailwind CSS and wires route TypeScript entries into the server harness", async () => {
    const runtimeRoot = await mkTempDir("custom-dashboard-runtime-");
    const workspacePath = await resolveContainedCustomDashboardPath(runtimeRoot, path.join(runtimeRoot, "workspace"));
    const routedRevision = revision({
      manifest: {
        ...revision().manifest,
        filePaths: ["src/dashboard.tsx", "src/details.tsx", "src/styles.css"],
      },
      fileBundle: {
        files: [
          { path: "src/dashboard.tsx", content: "export default () => <main class='grid' />;" },
          { path: "src/details.tsx", content: "export default () => <section class='text-jade-500' />;" },
          { path: "src/styles.css", content: "@import \"tailwindcss\";\n@theme { --color-jade-500: #00a86b; }" },
        ],
      },
      routes: [{ path: "/details", label: "Details", entryFile: "src/details.tsx", metadata: { layout: "wide" } }],
    });

    const materialized = await materializeCustomDashboardWorkspace({
      revision: routedRevision,
      workspacePath,
      bridgeConfig: {
        projectId: "project-1",
        dashboardId: "dashboard-1",
        revisionId: "revision-1",
        manifest: routedRevision.manifest,
        sourceNodeGraph: { nodes: [], edges: [] },
        styleguide: {},
        runtimeMetadata: {},
        integrations: {},
        externalApiNodes: [],
        runtimeAccess: { kind: "validation", sessionId: "session-1" },
      },
    });

    expect(materialized.buildManifest.styleEntries).toEqual(["src/styles.css"]);
    expect(materialized.buildManifest.routes).toEqual(routedRevision.routes);
    await expect(fs.readFile(path.join(workspacePath, "src", "styles.css"), "utf8")).resolves.toContain("@import \"tailwindcss\"");
    const harness = await fs.readFile(path.join(workspacePath, ".codeux-harness", "main.tsx"), "utf8");
    expect(harness).toContain("../src/styles.css");
    expect(harness).toContain("../src/details.tsx");
    expect(harness).toContain("/details");
  });

  it.each([
    "../escape.tsx",
    "src/../package.json",
    "src\\dashboard.tsx",
    "file:dashboard.tsx",
    ".codeux-harness/main.tsx",
  ])("rejects malicious or server-controlled bundle path %s", (candidate) => {
    expect(() => normalizeCustomDashboardBundlePath(candidate)).toThrow();
  });

  it.each(["package.json", "vite.config.ts", "tailwind.config.ts", ".npmrc", "src/logo.svg"])(
    "rejects unsupported user package or source configuration %s",
    (filePath) => {
      const candidate = revision({
        manifest: { ...revision().manifest, filePaths: ["src/dashboard.tsx", filePath] },
        fileBundle: {
          files: [
            ...revision().fileBundle.files,
            { path: filePath, content: filePath === "package.json" ? '{"scripts":{"postinstall":"curl example.invalid"}}' : "unsafe" },
          ],
        },
      });
      expect(() => buildCustomDashboardBuildManifest(candidate)).toThrow("Unsupported custom dashboard source or package configuration");
    },
  );

  it("rejects oversized sources, undeclared entries, and raw secret literals", () => {
    expect(() => buildCustomDashboardBuildManifest(revision({
      fileBundle: { files: [{ path: "src/dashboard.tsx", content: "x".repeat(CUSTOM_DASHBOARD_MAX_SOURCE_FILE_BYTES + 1) }] },
    }))).toThrow("source file is too large");
    expect(() => buildCustomDashboardBuildManifest(revision({
      manifest: { ...revision().manifest, entryFile: "src/missing.tsx" },
    }))).toThrow("must be declared in manifest.filePaths");
    expect(() => buildCustomDashboardBuildManifest(revision({
      fileBundle: { files: [{ path: "src/dashboard.tsx", content: 'const apiKey = "sk-dangerousliteral";' }] },
    }))).toThrow("raw secret literal");
    expect(() => buildCustomDashboardBuildManifest(revision({
      runtimeMetadata: { authorization: "Bearer dangerous-token-value" },
    }))).toThrow("metadata contains a raw secret literal");
  });

  it("requires TypeScript or TSX manifest and route entries", () => {
    expect(() => buildCustomDashboardBuildManifest(revision({
      manifest: { ...revision().manifest, entryFile: "src/styles.css", filePaths: ["src/styles.css"] },
      fileBundle: { files: [{ path: "src/styles.css", content: "@import \"tailwindcss\";" }] },
    }))).toThrow("must be a TypeScript or TSX file");
    expect(() => buildCustomDashboardBuildManifest(revision({
      manifest: { ...revision().manifest, filePaths: ["src/dashboard.tsx", "src/styles.css"] },
      fileBundle: { files: [...revision().fileBundle.files, { path: "src/styles.css", content: "main{}" }] },
      routes: [{ path: "/styles", label: "Styles", entryFile: "src/styles.css" }],
    }))).toThrow("route entryFile");
  });

  it("rejects paths that escape the runtime root through symlinked ancestors", async () => {
    const runtimeRoot = await mkTempDir("custom-dashboard-runtime-");
    const outsideDir = await mkTempDir("custom-dashboard-outside-");
    await fs.symlink(outsideDir, path.join(runtimeRoot, "linked-out"));

    await expect(
      resolveContainedCustomDashboardPath(runtimeRoot, path.join(runtimeRoot, "linked-out", "artifact.js")),
    ).rejects.toThrow("must stay inside the custom dashboard runtime directory");
  });
});
