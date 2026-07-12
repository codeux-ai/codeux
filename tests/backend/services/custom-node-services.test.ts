import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createConnection } from "node:net";
import type { CustomNodeArtifact, CustomNodeManifest, CustomNodeValidationReport } from "../../../src/contracts/custom-node-types.js";
import { resolveNodeDefinition } from "../../../src/domain/node-flows/node-definition-registry.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomNodeRepository } from "../../../src/repositories/custom-node-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { CustomNodeBuildService } from "../../../src/services/custom-nodes/custom-node-build-service.js";
import { CustomNodeProjectService } from "../../../src/services/custom-nodes/custom-node-project-service.js";
import { buildCustomNodeDockerRunArgs, CustomNodeRuntimeService } from "../../../src/services/custom-nodes/custom-node-runtime-service.js";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";
import { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";

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
    const runner = await fs.readFile(path.join(setup.root, ".code-ux", "nodes", "fixture-node", "src", "runner.ts"), "utf8");
    expect(runner).toContain("net.createConnection");
    expect(runner).not.toContain("HTTP requires the Code UX egress broker and is unavailable");
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

  it("rejects a modified generated runner before Docker execution", async () => {
    const setup = await fixture("runner-tamper");
    const runnerPath = path.join(setup.root, ".code-ux", "nodes", "runner-tamper", "src", "runner.ts");
    await fs.appendFile(runnerPath, "\n// untrusted modification\n");
    const commandRunner = vi.fn(async (): Promise<CommandResult> => result());
    const validation = await new CustomNodeBuildService({ repository: setup.repository, projectService: setup.projectService, commandRunner })
      .validateAndBuild({ projectRoot: setup.root, nodeId: "runner-tamper", creator: "test", invocationId: "invocation", correlationId: "correlation" });
    expect(validation.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: "trusted-build-recipe", message: expect.stringMatching(/trusted generated bridge/i) }),
    ]));
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

  it("bridges declared HTTP through the shared egress policy while retaining network-none isolation", async () => {
    const fetchMock = vi.fn(async () => new Response("accepted", { status: 200, headers: { "content-type": "text/plain" } }));
    const scenario = await networkRuntime("allowed-http", fetchMock);
    const execution = await scenario.execute({ url: "https://api.example.test/jobs" });

    expect(execution.output).toEqual({ status: 200, body: "accepted" });
    expect(scenario.dockerArgs).toEqual(expect.arrayContaining(["--network", "none", "--mount"]));
    expect(scenario.dockerArgs.join(" ")).not.toContain("--network bridge");
    expect(fetchMock).toHaveBeenCalledOnce();
    scenario.storage.close();
  });

  it("permits plain HTTP only when the manifest explicitly opts in", async () => {
    const fetchMock = vi.fn(async () => new Response("accepted", { status: 200, headers: { "content-type": "text/plain" } }));
    const scenario = await networkRuntime("allowed-plain-http", fetchMock, { allowHttp: true, allowedPorts: [80] });
    await expect(scenario.execute({ url: "http://api.example.test/jobs" })).resolves.toMatchObject({ output: { status: 200, body: "accepted" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    scenario.storage.close();
  });

  it.each([
    {
      name: "SSRF to a loopback address",
      request: { url: "https://127.0.0.1/data" },
      policy: { allowedHosts: ["127.0.0.1"] },
      error: /private|loopback|metadata/i,
    },
    {
      name: "plain HTTP without opt-in",
      request: { url: "http://api.example.test/data" },
      policy: { allowedPorts: [80] },
      error: /HTTPS unless HTTP is explicitly enabled/i,
    },
    {
      name: "a restricted authorization header",
      request: { url: "https://api.example.test/data", headers: { Authorization: "Bearer secret" } },
      error: /header is restricted/i,
    },
  ])("fails closed for $name", async ({ request, policy, error }) => {
    const fetchMock = vi.fn(async () => new Response("should not run", { headers: { "content-type": "text/plain" } }));
    const scenario = await networkRuntime(`blocked-${temporaryDirectories.length}`, fetchMock, policy);
    await expect(scenario.execute(request)).rejects.toThrow(error);
    expect(fetchMock).not.toHaveBeenCalled();
    scenario.storage.close();
  });

  it("revalidates redirects and rejects a redirect to a private destination", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/metadata" } }));
    const scenario = await networkRuntime("blocked-redirect", fetchMock, { allowedHosts: ["api.example.test", "127.0.0.1"] });
    await expect(scenario.execute({ url: "https://api.example.test/start" })).rejects.toThrow(/private|loopback|metadata/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    scenario.storage.close();
  });

  it("rejects DNS rebinding before a bridged request reaches the network", async () => {
    let lookups = 0;
    const fetchMock = vi.fn(async () => new Response("should not run", { headers: { "content-type": "text/plain" } }));
    const scenario = await networkRuntime(
      "blocked-rebinding",
      fetchMock,
      {},
      async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }],
    );
    await expect(scenario.execute({ url: "https://api.example.test/data" })).rejects.toThrow(/rebinding/i);
    expect(fetchMock).not.toHaveBeenCalled();
    scenario.storage.close();
  });

  it.each([
    {
      name: "an oversized response",
      fetch: async () => new Response("12345", { headers: { "content-type": "text/plain", "content-length": "5" } }),
      policy: { maxResponseBytes: 4 },
      error: /size limit/i,
    },
    {
      name: "a disallowed response content type",
      fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      policy: { allowedContentTypes: ["application/json"] },
      error: /content type is not allowed/i,
    },
  ])("fails closed for $name", async ({ fetch, policy, error }) => {
    const scenario = await networkRuntime(`response-${temporaryDirectories.length}`, vi.fn(fetch), policy);
    await expect(scenario.execute({ url: "https://api.example.test/data" })).rejects.toThrow(error);
    scenario.storage.close();
  });

  it("propagates request timeouts through the bridge", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const scenario = await networkRuntime("timeout-http", fetchMock, { timeoutMs: 5 });
    await expect(scenario.execute({ url: "https://api.example.test/slow" })).rejects.toThrow(/timed out/i);
    scenario.storage.close();
  });

  it("bounds retries and fails closed after the declared retry count", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("upstream unavailable"); });
    const scenario = await networkRuntime("retry-http", fetchMock, { maxRetries: 2 });
    await expect(scenario.execute({ url: "https://api.example.test/jobs" })).rejects.toThrow(/upstream unavailable/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    scenario.storage.close();
  });

  it("enforces the declared per-minute request rate", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { headers: { "content-type": "text/plain" } }));
    const scenario = await networkRuntime("rate-http", fetchMock, { maxRequests: 1 });
    await scenario.execute({ url: "https://api.example.test/first" });
    await expect(scenario.execute({ url: "https://api.example.test/second" })).rejects.toThrow(/rate limit/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    scenario.storage.close();
  });

  it("does not create a broker or mount for undeclared network access", async () => {
    const setup = await fixture("undeclared-http");
    const artifact = artifactFixture("undeclared-http", `sha256:${"f".repeat(64)}`, setup.projectId);
    publishArtifact(setup.repository, artifact);
    const fetchMock = vi.fn();
    const commandRunner = vi.fn(async (_command: string, args: string[], _cwd: string, options: { stdinFile?: string }): Promise<CommandResult> => {
      expect(args).not.toContain("--mount");
      const envelope = JSON.parse(await fs.readFile(options.stdinFile!, "utf8")) as { egress?: unknown };
      expect(envelope.egress).toBeUndefined();
      throw new Error("network.http capability is not declared");
    });
    const runtime = new CustomNodeRuntimeService({ repository: setup.repository, credentialBroker: {} as never, egressPolicyService: new EgressPolicyService({ fetch: fetchMock }), featureEnabled: true, commandRunner });
    await expect(runtime.execute(executionRequest(setup.projectId, "undeclared-http"))).rejects.toThrow(/not declared/i);
    expect(fetchMock).not.toHaveBeenCalled();
    setup.storage.close();
  });

  it("redacts the per-invocation bridge token from outputs, logs, diagnostics, and errors", async () => {
    const setup = await fixture("bridge-redaction");
    const artifact = artifactFixture("bridge-redaction", `sha256:${"f".repeat(64)}`, setup.projectId);
    artifact.manifest.capabilities = ["network.http"];
    artifact.manifest.http = { allowedHosts: ["api.example.test"], maxRequests: 1, timeoutMs: 1_000, maxResponseBytes: 1_024 };
    publishArtifact(setup.repository, artifact);
    let fail = false;
    const commandRunner = vi.fn(async (_command: string, _args: string[], _cwd: string, options: { stdinFile?: string }): Promise<CommandResult> => {
      const envelope = JSON.parse(await fs.readFile(options.stdinFile!, "utf8")) as { egress: { token: string } };
      if (fail) throw new Error(`runner failed with ${envelope.egress.token}`);
      return result(JSON.stringify({ token: envelope.egress.token }), `log ${envelope.egress.token}`);
    });
    const runtime = new CustomNodeRuntimeService({ repository: setup.repository, credentialBroker: {} as never, egressPolicyService: new EgressPolicyService(), featureEnabled: true, commandRunner });
    const request = executionRequest(setup.projectId, "bridge-redaction");
    await expect(runtime.execute(request)).resolves.toMatchObject({
      output: { token: "[REDACTED]" },
      logs: "log [REDACTED]",
      diagnostics: "{\"token\":\"[REDACTED]\"}",
    });
    fail = true;
    await expect(runtime.execute({ ...request, invocationId: "invocation-bridge-redaction-error" })).rejects.toThrow("runner failed with [REDACTED]");
    setup.storage.close();
  });
});

type HttpRequestFixture = { url: string; method?: string; headers?: Record<string, string>; body?: string };

async function networkRuntime(
  nodeId: string,
  fetchMock: typeof fetch,
  policyOverrides: Partial<NonNullable<CustomNodeManifest["http"]>> = {},
  lookup: (hostname: string) => Promise<Array<{ address: string; family: number }>> = async () => [{ address: "8.8.8.8", family: 4 }],
): Promise<{
  storage: AppDbStorage;
  dockerArgs: string[];
  execute(request: HttpRequestFixture): Promise<Awaited<ReturnType<CustomNodeRuntimeService["execute"]>>>;
}> {
  const setup = await fixture(nodeId);
  const artifact = artifactFixture(nodeId, `sha256:${"f".repeat(64)}`, setup.projectId);
  artifact.manifest.capabilities = ["network.http"];
  artifact.manifest.http = {
    allowedHosts: ["api.example.test"], maxRequests: 10, timeoutMs: 1_000, maxResponseBytes: 1_024,
    ...policyOverrides,
  };
  publishArtifact(setup.repository, artifact);
  let dockerArgs: string[] = [];
  const commandRunner = vi.fn(async (_command: string, args: string[], _cwd: string, options: { stdinFile?: string }): Promise<CommandResult> => {
    dockerArgs = args;
    const envelope = JSON.parse(await fs.readFile(options.stdinFile!, "utf8")) as { input: { request: HttpRequestFixture }; egress?: { token: string } };
    if (!envelope.egress) throw new Error("network.http capability is not declared");
    const mount = args.find((arg) => arg.startsWith("type=bind,src=") && arg.includes(`dst=/run/codeux-egress`));
    if (!mount) throw new Error("egress socket mount is unavailable");
    const socketDirectory = mount.slice("type=bind,src=".length, mount.indexOf(",dst="));
    const bridge = await bridgeRequest(path.join(socketDirectory, "egress.sock"), envelope.egress.token, envelope.input.request);
    if (!bridge.ok || !bridge.response) throw new Error(bridge.error ?? "HTTP bridge request failed");
    return result(JSON.stringify({ status: bridge.response.status, body: bridge.response.body }));
  });
  const runtime = new CustomNodeRuntimeService({
    repository: setup.repository,
    credentialBroker: {} as never,
    egressPolicyService: new EgressPolicyService({ fetch: fetchMock, lookup }),
    featureEnabled: true,
    commandRunner,
  });
  return {
    storage: setup.storage,
    get dockerArgs() { return dockerArgs; },
    execute: (request) => runtime.execute({ ...executionRequest(setup.projectId, nodeId), input: { request } }),
  };
}

async function bridgeRequest(socketPath: string, token: string, request: HttpRequestFixture): Promise<{ ok: boolean; response?: { status: number; headers: Record<string, string>; body: string }; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.end(JSON.stringify({ token, request })));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok: boolean; response?: { status: number; headers: Record<string, string>; body: string }; error?: string }));
    socket.on("error", reject);
  });
}

function publishArtifact(repository: CustomNodeRepository, artifact: CustomNodeArtifact): void {
  repository.beginValidation(artifact.nodeId);
  repository.completeValidation(artifact.nodeId, artifact.validationReport, artifact);
  repository.publish(artifact.nodeId, "publisher");
}

function executionRequest(projectId: string, nodeId: string) {
  return { projectId, nodeType: `custom.${nodeId}`, version: 1, input: {}, config: {}, credentialBindings: {}, workspaceId: "run", invocationId: `invocation-${nodeId}`, correlationId: "correlation" };
}

function artifactFixture(nodeId: string, runtimeImageDigest: string, projectId = "project"): CustomNodeArtifact {
  const generatedManifest: CustomNodeManifest = {
    schemaVersion: 1, id: nodeId, nodeType: `custom.${nodeId}`, version: 1, name: "Test", description: "",
    entrypoint: "dist/index.js", inputSchema: { type: "object" }, outputSchema: { type: "object" }, configurationSchema: { type: "object" },
    capabilities: [], credentials: [], resources: { cpu: 0.5, memoryMb: 128, pids: 64, timeoutMs: 30_000, maxOutputBytes: 262_144, scratchMb: 32 },
  };
  const report: CustomNodeValidationReport = { valid: true, checks: [], issues: [], validatedAt: new Date().toISOString() };
  return { digest: `sha256:${"a".repeat(64)}`, nodeId, projectId, version: 1, sourceRevision: "revision-1", buildDigest: `sha256:${"b".repeat(64)}`, runtimeImageDigest, dependencies: [], validationReport: report, createdBy: "test", invocationId: "invocation", correlationId: "correlation", capabilities: [], manifest: generatedManifest, createdAt: new Date().toISOString() };
}
