import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CustomDashboardRevisionRecord } from "../../../src/contracts/custom-dashboard-types.js";
import {
  buildBridgeConfig,
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

  it("omits credential binding identifiers from generated bridge and workspace files", async () => {
    const runtimeRoot = await mkTempDir("custom-dashboard-runtime-");
    const workspacePath = await resolveContainedCustomDashboardPath(runtimeRoot, path.join(runtimeRoot, "workspace"));
    const credentialId = "credential-binding-id-canary";
    const boundRevision = revision({
      manifest: {
        ...revision().manifest,
        credentialSlots: [{
          slotId: "metrics_api",
          label: "Metrics API",
          phase: "runtime",
          required: true,
          allowedKinds: ["http.token"],
          requiredCapabilities: ["metrics.read"],
        }],
      },
      credentialBindings: [{ slotId: "metrics_api", credentialId }],
      sourceNodeGraph: {
        nodes: [{
          id: "metrics",
          type: "external_api",
          title: "Metrics",
          config: { endpoint: `https://metrics.invalid/credentials/${credentialId}/summary` },
        }],
        edges: [],
      },
      runtimeMetadata: {
        credentialBindings: [{ slotId: "metrics_api", credentialId }],
        [`diagnostic-${credentialId}`]: "must be removed with its binding-bearing key",
        nested: {
          credentialId,
          diagnostic: `binding=${credentialId};state=configured`,
        },
      },
    });
    const bridgeConfig = buildBridgeConfig(boundRevision);

    await materializeCustomDashboardWorkspace({
      revision: boundRevision,
      workspacePath,
      bridgeConfig,
    });

    const serializedBridgeConfig = JSON.stringify(bridgeConfig);
    expect(serializedBridgeConfig).not.toContain(credentialId);
    expect(serializedBridgeConfig).not.toContain('"credentialBindings"');
    expect(serializedBridgeConfig).not.toContain('"credentialId"');
    expect(serializedBridgeConfig).toContain("[REDACTED_CREDENTIAL_BINDING_ID]");
    const materializedBridge = await fs.readFile(
      path.join(workspacePath, ".codeux-harness", "codeux-data-bridge.ts"),
      "utf8",
    );
    expect(materializedBridge).not.toContain(credentialId);
    expect(materializedBridge).toContain("[REDACTED_CREDENTIAL_BINDING_ID]");
    expect(await readDirectoryText(workspacePath)).not.toContain(credentialId);
  });

  it("rejects generated source that embeds a bound credential identifier", async () => {
    const runtimeRoot = await mkTempDir("custom-dashboard-runtime-");
    const workspacePath = await resolveContainedCustomDashboardPath(runtimeRoot, path.join(runtimeRoot, "workspace"));
    const credentialId = "credential-binding-id-canary";
    const boundRevision = revision({
      fileBundle: {
        files: [{ path: "src/dashboard.tsx", content: `export const embedded = ${JSON.stringify(credentialId)};` }],
      },
      credentialBindings: [{ slotId: "metrics_api", credentialId }],
    });

    await expect(materializeCustomDashboardWorkspace({
      revision: boundRevision,
      workspacePath,
      bridgeConfig: buildBridgeConfig(boundRevision),
    })).rejects.toThrow("cannot contain credential binding identifiers");
    await expect(fs.stat(workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function readDirectoryText(root: string): Promise<string> {
  const chunks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) chunks.push(await fs.readFile(target, "utf8"));
    }
  };
  await visit(root);
  return chunks.join("\n");
}
