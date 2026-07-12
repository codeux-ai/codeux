import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { NodeFlowRuntimeService } from "../../../src/services/node-flow-runtime-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import type { NodeFlowGraph } from "../../../src/contracts/node-flow-types.js";
import type { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";

const tempDirs: string[] = [];

async function createRuntime(providerExecutionService?: Partial<ProviderExecutionService>,credentialBroker?:Partial<CredentialBroker>, egressPolicyService?: EgressPolicyService): Promise<{
  dir: string;
  projectRepository: ProjectManagementRepository;
  nodeFlowRepository: NodeFlowRepository;
  executionRepository: ExecutionRepository;
  runtime: NodeFlowRuntimeService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-flow-runtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const nodeFlowRepository = new NodeFlowRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const runtime = new NodeFlowRuntimeService({
    nodeFlowRepository,
    executionRepository,
    projectManagementRepository: projectRepository,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    providerExecutionService: providerExecutionService as ProviderExecutionService | undefined,
    credentialBroker: credentialBroker as CredentialBroker | undefined,
    egressPolicyService,
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
  });
  return { dir, projectRepository, nodeFlowRepository, executionRepository, runtime };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("NodeFlowRuntimeService", () => {
  it("persists unselected condition branches as skipped while the selected branch runs", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Branch Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Branch", graph: {
      nodes: [
        { id: "condition", type: "condition", title: "Condition", data: { path: "input.enabled" } },
        { id: "yes", type: "set_fields", title: "Yes", data: { fields: { branch: "yes" } } },
        { id: "no", type: "set_fields", title: "No", data: { fields: { branch: "no" } } },
        { id: "merge", type: "merge", title: "Merge", data: { strategy: "object" } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [
        { fromNodeId: "condition", fromHandle: "true", toNodeId: "yes" },
        { fromNodeId: "condition", fromHandle: "false", toNodeId: "no" },
        { fromNodeId: "yes", toNodeId: "merge" }, { fromNodeId: "no", toNodeId: "merge" },
        { fromNodeId: "merge", toNodeId: "output" },
      ],
    } });
    const result = await runtime.runFlow(project.id, flow.id, { enabled: true });
    expect(result.run.status).toBe("succeeded");
    expect(result.nodeRuns.find((node) => node.nodeId === "no")?.status).toBe("skipped");
    expect(result.output).toMatchObject({ branch: "yes" });
  });

  it("executes an explicitly pinned publication while latest selection follows the newest publication", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Version Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Versioned", graph: { nodes: [{ id: "set", type: "set_fields", title: "Set", data: { fields: { release: "v1" } } }], edges: [] } });
    nodeFlowRepository.updateFlow(flow.id, { graph: { nodes: [{ id: "set", type: "set_fields", title: "Set", data: { fields: { release: "v2" } } }], edges: [] } });

    const pinned = await runtime.runFlow(project.id, flow.id, {}, { versionSelection: { mode: "pinned", version: 1 } });
    const latest = await runtime.runFlow(project.id, flow.id, {}, { versionSelection: { mode: "latest_published" } });

    expect(pinned.run.version).toBe(1);
    expect(pinned.output).toEqual({ release: "v1" });
    expect(latest.run.version).toBe(2);
    expect(latest.output).toEqual({ release: "v2" });
  });

  it("retries classified transient failures and persists redacted numbered attempts", async () => {
    const executeProvider = vi.fn()
      .mockRejectedValueOnce(new Error("503 temporarily unavailable"))
      .mockResolvedValue({ ok: true, stdout: "ok", stderr: "", code: 0, text: "ok", nativeSessionId: null, usageTelemetry: { transcriptText: "ok", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "reported", rawUsageJson: null } });
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Retry Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Retry", graph: { nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "{{input.apiToken}}" }, policy: { retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 } } }], edges: [] } });

    const result = await runtime.runFlow(project.id, flow.id, { apiToken: "never-store" });

    expect(result.run.status).toBe("succeeded");
    expect(executeProvider).toHaveBeenCalledTimes(2);
    expect(result.attempts?.map((attempt) => [attempt.attemptNumber, attempt.retryDecision])).toEqual([[1, "retry"], [2, "stop"]]);
    expect(JSON.stringify(result.attempts)).not.toContain("never-store");
  });

  it("propagates node timeouts to the executor and classifies the attempt", async () => {
    const executeProvider = vi.fn().mockImplementation(({ signal }: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Timeout Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Timeout", graph: { nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "wait" }, policy: { timeout: { timeoutMs: 5 } } }], edges: [] } });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("failed");
    expect(result.attempts?.[0]).toMatchObject({ failureClassification: "timeout", retryDecision: "stop" });
  });

  it("executes deterministic nodes in topological order and persists the succeeded run", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Runtime Project", sourceType: "local", sourceRef: dir });
    const graph: NodeFlowGraph = {
      nodes: [
        { id: "input", type: "input", title: "Input" },
        { id: "set", type: "set_fields", title: "Set", data: { fields: { greeting: "Hello {{input.name}}" } } },
        { id: "template", type: "template", title: "Template", data: { template: "{{nodes.set.greeting}}", outputKey: "message" } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [
        { fromNodeId: "input", toNodeId: "set" },
        { fromNodeId: "set", toNodeId: "template" },
        { fromNodeId: "template", toNodeId: "output" },
      ],
    };
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Greeting", graph });

    const result = await runtime.runFlow(project.id, flow.id, { name: "Ada" });

    expect(result.run.status).toBe("succeeded");
    expect(result.output).toEqual({ message: "Hello Ada" });
    expect(result.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual(["input", "set", "template", "output"]);
    expect(result.nodeRuns.every((nodeRun) => nodeRun.status === "succeeded")).toBe(true);
    expect(result.run.executionInvocationId).toMatch(/^xi_/);
  });

  it("uses ProviderExecutionService for provider_prompt nodes and links the node invocation", async () => {
    const executeProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "provider stdout",
      stderr: "",
      code: 0,
      text: "provider answer",
      nativeSessionId: "native-1",
      usageTelemetry: {
        transcriptText: "provider answer",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });
    const resolveCredentialId=vi.fn().mockResolvedValue({credentialId:"credential-1",value:"bound-secret",version:1});
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>,{resolveCredentialId});
    const project = projectRepository.createProject({ name: "Provider Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Provider",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "Answer {{input.question}}" }, credentialBindings: [{slot:"provider",credentialId:"credential-1"}] },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "input", toNodeId: "prompt" },
          { fromNodeId: "prompt", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { question: "now" });

    expect(executeProvider).toHaveBeenCalledWith(expect.objectContaining({
      type: "node_flow_node",
      provider: "mockup-cli",
      prompt: "Answer now",
      apiKey: "bound-secret",
      invocationId: expect.stringMatching(/^xi_/),
      trackPromptInInvocation: false,
      trackAssistantInInvocation: false,
    }));
    expect(resolveCredentialId).toHaveBeenCalledWith(expect.objectContaining({projectId:project.id,credentialId:"credential-1",bindingKey:`${flow.id}:prompt:provider`,capability:"read"}));
    const promptRun = result.nodeRuns.find((nodeRun) => nodeRun.nodeId === "prompt");
    expect(promptRun?.executionInvocationId).toMatch(/^xi_/);
    expect(promptRun?.output).toMatchObject({ text: "provider answer", nativeSessionId: "native-1" });
    expect(executionRepository.getExecutionInvocation(promptRun!.executionInvocationId!)?.type).toBe("node_flow_node");
  });

  it("executes governed HTTP request nodes with query, body, timeout, and JSON response extraction", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { message: "hello" } }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
      const egressPolicyService = new EgressPolicyService({ fetch: fetchMock, lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
      const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime(undefined, undefined, egressPolicyService);
      const project = projectRepository.createProject({ name: "HTTP Project", sourceType: "local", sourceRef: dir });
      const flow = nodeFlowRepository.createFlow(project.id, {
        title: "HTTP",
        graph: {
          nodes: [
            {
              id: "http",
              type: "http_request",
              title: "HTTP",
              data: {
                method: "POST",
                url: "https://api.example.test/ok",
                query: { name: "Ada" },
                body: { ok: true },
                timeout: 1000,
                responsePath: "data.message",
              },
            },
          ],
          edges: [],
        },
      });

      const result = await runtime.runFlow(project.id, flow.id, {});

      expect(result.run.status).toBe("succeeded");
      expect(result.output).toMatchObject({ status: 200, extracted: "hello" });
      expect(result.nodeRuns[0]?.executionInvocationId).toMatch(/^xi_/);
      expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ search: "?name=Ada" }), expect.objectContaining({ redirect: "manual" }));
  });

  it("fails HTTP nodes clearly and skips downstream nodes without continueOnError", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "HTTP Failure Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "HTTP failure",
      graph: {
        nodes: [
          { id: "http", type: "http_request", title: "HTTP", data: { method: "GET", url: "ftp://example.test/file" } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [{ fromNodeId: "http", toNodeId: "output" }],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("failed");
    expect(result.run.errorMessage).toMatch(/http or https/i);
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["http", "failed"],
      ["output", "skipped"],
    ]);
  });

  it("continues downstream from failed nodes that opt into continueOnError", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Continue Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Continue",
      graph: {
        nodes: [
          { id: "http", type: "http_request", title: "HTTP", data: { method: "GET", url: "ftp://example.test/file", continueOnError: true } },
          { id: "set", type: "set_fields", title: "Set", data: { fields: { recovered: "{{nodes.http.error}}" } } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "http", toNodeId: "set" },
          { fromNodeId: "set", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("succeeded");
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["http", "failed"],
      ["set", "succeeded"],
      ["output", "succeeded"],
    ]);
    expect(result.output?.recovered).toMatch(/http or https/i);
  });

  it("preserves cancelled run status when an abort is observed during node execution", async () => {
    const controller = new AbortController();
    const executeProvider = vi.fn().mockImplementation(() => {
      controller.abort("test_cancel");
      throw new Error("provider cancelled");
    });
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Cancelled Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Cancelled",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "Answer {{input.question}}" } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "input", toNodeId: "prompt" },
          { fromNodeId: "prompt", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { question: "now" }, { signal: controller.signal });

    expect(result.run.status).toBe("cancelled");
    expect(result.run.errorMessage).toBe("provider cancelled");
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["input", "succeeded"],
      ["prompt", "cancelled"],
      ["output", "cancelled"],
    ]);
    expect(executionRepository.getExecutionInvocation(result.run.executionInvocationId!)?.status).toBe("cancelled");
  });

  it("masks secrets in run payloads, node payloads, and invocation messages", async () => {
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Secret Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Secrets",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [{ fromNodeId: "input", toNodeId: "output" }],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { apiToken: "secret-token", visible: "ok" }, {
      triggerPayload: { authorization: "Bearer secret-token" },
    });

    expect(result.run.input).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    expect(result.run.triggerPayload).toEqual({ authorization: "[REDACTED]" });
    expect(result.output).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    expect(result.nodeRuns[0]?.output).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    const messages = executionRepository.listExecutionInvocationMessages(result.run.executionInvocationId!);
    expect(JSON.stringify(messages)).not.toContain("secret-token");
  });
});
