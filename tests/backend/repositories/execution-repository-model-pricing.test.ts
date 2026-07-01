import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";

const tempDirs: string[] = [];

async function createRepositories() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-model-pricing-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
  return {
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage, undefined, undefined, settingsRepository),
    settingsRepository,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ExecutionRepository model pricing", () => {
  it("prices usage from the models.dev catalogue base price when no override is set", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Model Pricing Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing",
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    // openai/gpt-5.5 base price in assets/models-dev/catalog.json: $5/M input, $30/M output.
    expect(snapshot.usage.inputCostUsd).toBeCloseTo(5, 5);
    expect(snapshot.usage.outputCostUsd).toBeCloseTo(30, 5);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(35, 5);
  });

  it("prefers a user price override over the catalogue base price", async () => {
    const { projectRepository, executionRepository, settingsRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Model Pricing Override Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-override",
    });

    settingsRepository.saveSystemSettings({
      ...settingsRepository.getSystemSettings(),
      modelPricing: {
        overrides: {
          "openai/gpt-5.5": { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
        },
      },
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-2",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.5",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBeCloseTo(1, 5);
    expect(snapshot.usage.outputCostUsd).toBeCloseTo(2, 5);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(3, 5);
  });

  it("prices a self-hosted custom model with no catalogue entry, keyed by its paired API provider", async () => {
    const { projectRepository, executionRepository, settingsRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Custom Model Pricing Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-custom",
    });

    const baseSettings = settingsRepository.getSystemSettings();
    settingsRepository.saveSystemSettings({
      ...baseSettings,
      integrations: {
        ...baseSettings.integrations,
        providers: {
          ...baseSettings.integrations.providers,
          "codex-local": {
            provider: "codex",
            name: "Codex Local",
            apiKey: "",
            mountAuth: false,
            authPath: "",
            customProviderId: "my-custom-gateway",
            customModel: "my-local-model",
          },
        },
      },
      modelPricing: {
        overrides: {
          "my-custom-gateway/my-local-model": { inputTokens: 4, outputTokens: 8, cachedInputTokens: 0 },
        },
      },
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-custom",
      provider: "codex",
      purpose: "task_coding",
      model: "my-local-model",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBeCloseTo(4, 5);
    expect(snapshot.usage.outputCostUsd).toBeCloseTo(8, 5);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(12, 5);
  });

  it("omits cost when the provider/model has no catalogue match and no override", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Model Pricing Unmatched Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-unmatched",
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-3",
      provider: "jules",
      purpose: "task_coding",
      model: "default",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 2_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBe(0);
    expect(snapshot.usage.outputCostUsd).toBe(0);
    expect(snapshot.usage.totalCostUsd).toBe(0);
  });
});
