import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { SkillService, type SkillEmbeddingProvider } from "../../../src/services/skill-service.js";
import type { IProviderRunner, ProviderRunResult } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

class FakeEmbeddingProvider implements SkillEmbeddingProvider {
  isLoaded(): boolean {
    return true;
  }

  getLoadedModelId(): string | null {
    return "fake-2d";
  }

  async embed(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("review")) {
      return new Float32Array([1, 0]);
    }
    if (lower.includes("deploy")) {
      return new Float32Array([0, 1]);
    }
    return new Float32Array([0.5, 0.5]);
  }
}

async function createFixture(): Promise<{
  projectId: string;
  agentPresetRepository: AgentPresetRepository;
  skillService: SkillService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-persistent-skills-runtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const skillRepository = new SkillRepository(storage);
  const skillService = new SkillService(skillRepository, new FakeEmbeddingProvider());
  const project = projectRepository.createProject({
    name: "Persistent Skills Integration Project",
    sourceType: "local",
    sourceRef: "/workspace/persistent-skills-integration",
  });

  return {
    projectId: project.id,
    agentPresetRepository,
    skillService,
  };
}

const parseMcpEnvelope = (response: { content: Array<{ text: string }> }): { result: { results: Array<{ skill: { id: string; name: string } }> } } => {
  return JSON.parse(response.content[0]!.text) as { result: { results: Array<{ skill: { id: string; name: string } }> } };
};

describe("persistent skills runtime integration", () => {
  it("shares attached skill storage through agent-scoped MCP search only for attached agents", async () => {
    const { projectId, agentPresetRepository, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, {
      id: "shared-review-skills",
      name: "Shared Review Skills",
      description: "Reusable review practices",
    });
    const skill = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Review Discipline
description: Keep review findings concrete.
tags: ["review"]
---

Review pull requests for regressions, missing tests, and rollback risk.
`);
    const firstAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "review-agent-a",
      name: "Review Agent A",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [storage.id],
    });
    const secondAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "review-agent-b",
      name: "Review Agent B",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [storage.id],
    });
    const unattachedAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "review-agent-unattached",
      name: "Unattached Review Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [],
    });
    const handler = new ManagementToolHandler({ skillService } as ConstructorParameters<typeof ManagementToolHandler>[0]);

    const firstSearch = parseMcpEnvelope(await handler.handleSearchSkills({
      projectId,
      agentPresetId: firstAgent.id,
      query: "review regressions",
      minSimilarity: 0,
      limit: 5,
    }));
    const secondSearch = parseMcpEnvelope(await handler.handleSearchSkills({
      projectId,
      agentPresetId: secondAgent.id,
      query: "review regressions",
      minSimilarity: 0,
      limit: 5,
    }));
    const unattachedSearch = parseMcpEnvelope(await handler.handleSearchSkills({
      projectId,
      agentPresetId: unattachedAgent.id,
      query: "review regressions",
      minSimilarity: 0,
      limit: 5,
    }));

    expect(firstSearch.result.results.map((result) => result.skill.id)).toEqual([skill.id]);
    expect(secondSearch.result.results.map((result) => result.skill.id)).toEqual([skill.id]);
    expect(unattachedSearch.result.results).toEqual([]);
  });

  it("injects persistent skill prompt guidance and isolated mounts only for enabled attached agents", async () => {
    const { projectId, agentPresetRepository, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, {
      id: "runtime-review-skills",
      name: "Runtime Review Skills",
    });
    const enabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-enabled-agent",
      name: "Runtime Enabled Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [storage.id],
    });
    const disabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-disabled-agent",
      name: "Runtime Disabled Agent",
      persistentSkillStorage: { enabled: false },
      persistentSkillStorageIds: [storage.id],
    });
    const unattachedAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-unattached-agent",
      name: "Runtime Unattached Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [],
    });
    const providerResult: ProviderRunResult = {
      ok: true,
      stdout: "done",
      stderr: "",
      exitCode: 0,
      nativeSessionId: "native-runtime-1",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "unknown",
        rawUsageJson: null,
      },
    };
    const providerRunner: import("vitest").Mocked<IProviderRunner> = {
      runProvider: vi.fn().mockResolvedValue(providerResult),
      runProviderForText: vi.fn(),
    } as unknown as import("vitest").Mocked<IProviderRunner>;
    const executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-runtime-1", status: "running" }),
      getExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-runtime-1", status: "running" }),
      appendExecutionInvocationMessage: vi.fn(),
      createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-runtime-1", status: "running" }),
      getProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-runtime-1", status: "running" }),
      updateProviderInvocationUsage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
    } as unknown as ExecutionRepository;
    const service = new ProviderExecutionService({
      providerRunner,
      executionRepository,
      agentPresetRepository,
      skillService,
      getMcpConnectionInfo: vi.fn().mockReturnValue({ url: "http://127.0.0.1:4444/mcp", authToken: "test-token" }),
      getGithubToken: vi.fn(),
    });
    const baseArgs = {
      projectId,
      provider: "claude-code" as const,
      model: "test-model",
      prompt: "Implement the task.",
      cwd: "/workspace/test-project",
      apiKey: "test-key",
      sessionId: "session-runtime-1",
      workflowSettings: {
        retryOnReadFileNotFound: false,
        maxRateLimitRetries: 0,
      } as DashboardSettings["cliWorkflow"],
      repoPath: "/workspace/test-project",
      purpose: "task_coding" as const,
      type: "task_coding",
      agentMcpAccess: { codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: [] },
    };

    await service.executeProvider({ ...baseArgs, mcpAgentId: enabledAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: disabledAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: unattachedAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: null });

    const enabledRun = providerRunner.runProvider.mock.calls[0]![0];
    expect(enabledRun.prompt).toContain("Implement the task.");
    expect(enabledRun.prompt).toContain("## PERSISTENT SKILL STORAGE");
    expect(enabledRun.prompt).toContain("search_skills");
    expect(enabledRun.mcpConnection).toEqual({
      url: "http://127.0.0.1:4444/mcp",
      authToken: "test-token",
      agentId: enabledAgent.id,
    });
    expect(enabledRun.persistentSkillStorageMounts).toEqual([
      expect.objectContaining({
        storageId: storage.id,
        storageName: "Runtime Review Skills",
        containerPath: "/code-ux/persistent-skills/runtime-review-skills",
      }),
    ]);
    expect(enabledRun.persistentSkillStorageMounts?.[0]?.hostPath).toContain(path.join(".code-ux", "persistent-skill-storages"));

    for (const run of providerRunner.runProvider.mock.calls.slice(1).map((call) => call[0])) {
      expect(run.prompt).toBe("Implement the task.");
      expect(run.mcpConnection).toBeNull();
      expect(run.persistentSkillStorageMounts).toBeUndefined();
    }
  });
});
