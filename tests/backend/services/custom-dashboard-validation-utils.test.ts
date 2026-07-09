import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CustomDashboardRevisionRecord } from "../../../src/contracts/custom-dashboard-types.js";
import {
  materializeCustomDashboardWorkspace,
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
      },
    });

    expect(materialized.entryImportPath).toBe("../src/dashboard.tsx");
    await expect(fs.readFile(path.join(workspacePath, "src", "dashboard.tsx"), "utf8")).resolves.toContain("Dashboard");
    await expect(fs.readFile(path.join(workspacePath, ".codeux-harness", "main.tsx"), "utf8")).resolves.toContain("DashboardModule");
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
