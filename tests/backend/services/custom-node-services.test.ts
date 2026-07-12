import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CustomNodeArtifact, CustomNodeManifest, CustomNodeValidationReport } from "../../../src/contracts/custom-node-types.js";
import { resolveNodeDefinition } from "../../../src/domain/node-flows/node-definition-registry.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { CustomNodeBuildService } from "../../../src/services/custom-nodes/custom-node-build-service.js";
import { CustomNodeProjectService } from "../../../src/services/custom-nodes/custom-node-project-service.js";
import { buildCustomNodeDockerRunArgs, CustomNodeRuntimeService } from "../../../src/services/custom-nodes/custom-node-runtime-service.js";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";

const temporaryDirectories: string[] = [];
const result = (stdout = "", stderr = ""): CommandResult => ({ ok: true, code: 0, stdout, stderr });

async function fixture(nodeId: string): Promise<{ root: string; storage: AppDbStorage; repository: CustomNodeRepository; projectId: string; projectService: CustomNodeProjectService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-custom-node-test-"));
  temporaryDirectories.push(root);
  const storage = new AppDbStorage(path.join(root, "app.db"));
  const project = new ProjectManagementRepository(storage).createProject({ name: "Custom Node Service Test", sourceType: "local", sourceRef: root });
  const repository = new CustomNodeRepository(storage);
  const projectService = new CustomNodeProjectService();
  const generated = await projectService.generate({ projectRoot: root, nodeId, name: "Safe node" });
  repository.createDraft(project.id, { manifest: generated.manifest, sourceRevision: "revision-1", createdBy: "test" });
  return { root, storage, repository, projectId: project.id, projectService };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("custom node project and build services", () => {
  it("generates the SDK package and validates/builds/publishes a deterministic fixture through Docker", async () => {
    const setup = await fixture("fixture-node");
    const calls: string[][] = [];
    const commandRunner = vi.fn(async (_command: string, args: string[]): Promise<CommandResult> => {
      calls.push(args);
      if (args[0] === "image") return result(`sha256:${"d".repeat(64)}\n`);
      if (args[0] === "run") return result(JSON.stringify({ value: 1, executedAt: "2026-01-01T00:00:00.000Z" }));
      return result();
    });
    const service = new CustomNodeBuildService({ repository: setup.repository, projectService: setup.projectService, commandRunner, vulnerabilityAudit: async () => ({ passed: true, details: "fixture audit passed" }) });
    const validation = await service.validateAndBuild({ projectRoot: setup.root, nodeId: "fixture-node", creator: "test", invocationId: "invocation", correlationId: "correlation" });

    expect(validation.report.valid).toBe(true);
    expect(validation.artifact).toMatchObject({ sourceRevision: "revision-1", runtimeImageDigest: `sha256:${"d".repeat(64)}`, capabilities: ["clock.read"] });
    expect(calls.some((args) => args[0] === "build" && args.includes("--pull=false"))).toBe(true);
    await expect(fs.readFile(path.join(setup.root, ".code-ux", "nodes", "fixture-node", "Dockerfile"), "utf8")).resolves.toContain("RUN --network=none pnpm run typecheck");
    expect(calls.some((args) => args[0] === "run" && args.includes("--read-only"))).toBe(true);
    const artifact = service.publish("fixture-node", "publisher");
    expect(resolveNodeDefinition("custom.fixture-node", 1)?.executionKind).toBe("custom");
    expect(artifact.digest).toBe(validation.artifact?.digest);
    await expect(fs.readFile(path.join(setup.root, ".code-ux", "nodes", "fixture-node", "src", "sdk.ts"), "utf8")).resolves.toContain("NodeExecutionContext");
    setup.storage.close();
  });

  it.each([
    ["host filesystem", 'import fs from "node:fs";'],
    ["host environment", "const value = process.env.SECRET;"],
    ["subprocess", 'import { spawn } from "node:child_process";'],
    ["Docker", 'const socket = "/var/run/docker.sock";'],
    ["unrestricted network", 'const response = await fetch("https://example.test");'],
  ])("fails closed when generated code requests %s access", async (_name, attack) => {
    const nodeId = `blocked-${temporaryDirectories.length + 10}`;
    const setup = await fixture(nodeId);
    await fs.writeFile(path.join(setup.root, ".code-ux", "nodes", nodeId, "src", "index.ts"), `${attack}\nexport const run = async () => ({});\n`);
    const commandRunner = vi.fn(async (): Promise<CommandResult> => result());
    const validation = await new CustomNodeBuildService({ repository: setup.repository, projectService: setup.projectService, commandRunner })
      .validateAndBuild({ projectRoot: setup.root, nodeId, creator: "test", invocationId: "invocation", correlationId: "correlation" });
    expect(validation.report.valid).toBe(false);
    expect(validation.report.issues.some((issue) => issue.check === "prohibited-api-scan")).toBe(true);
    expect(commandRunner).not.toHaveBeenCalled();
    setup.storage.close();
  });

  it("rejects resource exhaustion declarations before Docker execution", async () => {
    const setup = await fixture("resource-node");
    const manifestPath = path.join(setup.root, ".code-ux", "nodes", "resource-node", "node.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as CustomNodeManifest;
    manifest.resources.memoryMb = 100_000;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const commandRunner = vi.fn(async (): Promise<CommandResult> => result());
    const validation = await new CustomNodeBuildService({ repository: setup.repository, commandRunner })
      .validateAndBuild({ projectRoot: setup.root, nodeId: "resource-node", creator: "test", invocationId: "invocation", correlationId: "correlation" });
    expect(validation.report.issues.some((issue) => issue.check === "resource-policy")).toBe(true);
    expect(commandRunner).not.toHaveBeenCalled();
    setup.storage.close();
  });
});

describe("custom node Docker plan and runtime security", () => {
  it("applies a non-root read-only network-none container with bounded resources and no project or Docker mounts", () => {
    const artifact = artifactFixture("plan-node", "/immutable-image");
    const args = buildCustomNodeDockerRunArgs({ artifact, containerName: "custom-run", seccompProfile: "/profiles/custom.json", appArmorProfile: "code-ux-custom-node" });
    expect(args).toEqual(expect.arrayContaining(["--network", "none", "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--read-only", "--user", "65532:65532", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5"]));
    expect(args).toContain("seccomp=/profiles/custom.json");
    expect(args).toContain("apparmor=code-ux-custom-node");
    expect(args.join(" ")).not.toMatch(/docker\.sock|--network host|\/workspace|\/project/);
    expect(args.filter((arg) => arg.startsWith("type="))).toEqual([]);
  });

  it("uses the credential broker, isolates each run, and redacts canaries from outputs, logs, and diagnostics", async () => {
    const setup = await fixture("runtime-node");
    const artifact = artifactFixture("runtime-node", `sha256:${"e".repeat(64)}`, setup.projectId);
    artifact.manifest.capabilities = ["credentials.read"];
    artifact.manifest.credentials = [{ slot: "api", label: "API", required: true, allowedKinds: ["http"], requiredCapability: "read" }];
    setup.repository.beginValidation("runtime-node");
    setup.repository.completeValidation("runtime-node", artifact.validationReport, artifact);
    setup.repository.publish("runtime-node", "publisher");
    const secret = "CODEUX_SECRET_CANARY_DO_NOT_LEAK";
    const runDirectories: string[] = [];
    const commandRunner = vi.fn(async (_command: string, _args: string[], _cwd: string, options: { stdinFile?: string }): Promise<CommandResult> => {
      if (!options.stdinFile) throw new Error("missing credential bundle");
      runDirectories.push(path.dirname(options.stdinFile));
      return result(JSON.stringify({ value: secret }), `log ${secret}`);
    });
    const broker = { resolveCredentialId: vi.fn(async () => ({ credentialId: "credential", value: secret, version: 1 })) };
    const runtime = new CustomNodeRuntimeService({ repository: setup.repository, credentialBroker: broker as never, egressPolicyService: {} as never, featureEnabled: true, commandRunner });
    const execute = () => runtime.execute({ projectId: setup.projectId, nodeType: "custom.runtime-node", version: 1, input: {}, config: {}, credentialBindings: { api: "credential" }, workspaceId: "run", invocationId: `invocation-${runDirectories.length}`, correlationId: "correlation" });
    const first = await execute();
    const second = await execute();
    expect(first).toMatchObject({ output: { value: "[REDACTED]" }, logs: "log [REDACTED]", diagnostics: "{\"value\":\"[REDACTED]\"}" });
    expect(second.output).toEqual({ value: "[REDACTED]" });
    expect(runDirectories[0]).not.toBe(runDirectories[1]);
    await expect(fs.access(runDirectories[0]!)).rejects.toThrow();
    await expect(fs.access(runDirectories[1]!)).rejects.toThrow();
    expect(broker.resolveCredentialId).toHaveBeenCalledTimes(2);
    setup.storage.close();
  });

  it("keeps execution behind the feature and publication gates", async () => {
    const setup = await fixture("gated-node");
    const runtime = new CustomNodeRuntimeService({ repository: setup.repository, credentialBroker: {} as never, egressPolicyService: {} as never, featureEnabled: false });
    await expect(runtime.execute({ projectId: setup.projectId, nodeType: "custom.gated-node", version: 1, input: {}, config: {}, credentialBindings: {}, workspaceId: "run", invocationId: "invocation", correlationId: "correlation" })).rejects.toThrow(/feature gate/i);
    setup.storage.close();
  });
});

function artifactFixture(nodeId: string, runtimeImageDigest: string, projectId = "project"): CustomNodeArtifact {
  const generatedManifest: CustomNodeManifest = {
    schemaVersion: 1, id: nodeId, nodeType: `custom.${nodeId}`, version: 1, name: "Test", description: "",
    entrypoint: "dist/index.js", inputSchema: { type: "object" }, outputSchema: { type: "object" }, configurationSchema: { type: "object" },
    capabilities: [], credentials: [], resources: { cpu: 0.5, memoryMb: 128, pids: 64, timeoutMs: 30_000, maxOutputBytes: 262_144, scratchMb: 32 },
  };
  const report: CustomNodeValidationReport = { valid: true, checks: [], issues: [], validatedAt: new Date().toISOString() };
  return { digest: `sha256:${"a".repeat(64)}`, nodeId, projectId, version: 1, sourceRevision: "revision-1", buildDigest: `sha256:${"b".repeat(64)}`, runtimeImageDigest, dependencies: [], validationReport: report, createdBy: "test", invocationId: "invocation", correlationId: "correlation", capabilities: [], manifest: generatedManifest, createdAt: new Date().toISOString() };
}
