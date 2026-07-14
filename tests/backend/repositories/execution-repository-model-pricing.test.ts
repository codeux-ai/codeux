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
    expect(snapshot.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 1,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 0,
      providerReportedCostUsd: 0,
    });
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

  it("prices OpenCode custom endpoint rows stored as provider/model ids", async () => {
    const { projectRepository, executionRepository, settingsRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "OpenCode Custom Model Pricing Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-opencode-custom",
    });

    const baseSettings = settingsRepository.getSystemSettings();
    settingsRepository.saveSystemSettings({
      ...baseSettings,
      integrations: {
        ...baseSettings.integrations,
        providers: {
          ...baseSettings.integrations.providers,
          opencode: {
            ...baseSettings.integrations.providers.opencode,
            provider: "opencode",
            name: "OpenCode Local",
            apiKey: "",
            mountAuth: false,
            authPath: "~/.local/share/opencode",
            openCodeAuthMode: "CUSTOM_PROVIDER",
            openCodeProviderId: "google",
            openCodeModelId: "gemma-4-26b-a4b-qat",
          },
        },
      },
      modelPricing: {
        overrides: {
          "google/gemma-4-26b-a4b-qat": { inputTokens: 0.25, outputTokens: 0.75, cachedInputTokens: 0 },
        },
      },
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-opencode-custom",
      provider: "opencode",
      purpose: "task_coding",
      model: "google/gemma-4-26b-a4b-qat",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 2_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 3_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBeCloseTo(0.5, 5);
    expect(snapshot.usage.outputCostUsd).toBeCloseTo(0.75, 5);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(1.25, 5);
  });

  it("prices provider/model rows from legacy custom/provider/model override keys", async () => {
    const { projectRepository, executionRepository, settingsRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Legacy Custom Override Pricing Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-legacy-custom-override",
    });

    const baseSettings = settingsRepository.getSystemSettings();
    settingsRepository.saveSystemSettings({
      ...baseSettings,
      integrations: {
        ...baseSettings.integrations,
        providers: {
          ...baseSettings.integrations.providers,
          opencode: {
            ...baseSettings.integrations.providers.opencode,
            provider: "opencode",
            name: "OpenCode Local",
            apiKey: "",
            mountAuth: false,
            authPath: "~/.local/share/opencode",
            openCodeAuthMode: "CUSTOM_PROVIDER",
            openCodeProviderId: "google",
            openCodeModelId: "gemma-4-26b-a4b-qat",
          },
        },
      },
      modelPricing: {
        overrides: {
          "custom/google/gemma-4-26b-a4b-qat": { inputTokens: 0.25, outputTokens: 0.75, cachedInputTokens: 0 },
        },
      },
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-opencode-legacy-custom",
      provider: "opencode",
      purpose: "task_coding",
      model: "google/gemma-4-26b-a4b-qat",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 2_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 3_000_000,
      usageSource: "reported",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBeCloseTo(0.5, 5);
    expect(snapshot.usage.outputCostUsd).toBeCloseTo(0.75, 5);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(1.25, 5);
  });

  it("uses provider-reported OpenCode cost when token-rate pricing is unavailable", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "OpenCode Reported Cost Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-opencode-reported-cost",
    });

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-opencode-cost",
      provider: "opencode",
      purpose: "task_coding",
      model: "unknown-provider/unknown-model",
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      inputTokens: 2_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 3_000_000,
      usageSource: "reported",
      rawUsageJson: {
        tokens: { input: 2_000_000, output: 1_000_000, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 1.23,
      },
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(snapshot.usage.inputCostUsd).toBe(0);
    expect(snapshot.usage.outputCostUsd).toBe(0);
    expect(snapshot.usage.totalCostUsd).toBeCloseTo(1.23, 5);
    expect(snapshot.providers.find((provider) => provider.id === "opencode")?.usage.totalCostUsd).toBeCloseTo(1.23, 5);
    expect(snapshot.models.find((model) => model.provider === "opencode")?.usage.totalCostUsd).toBeCloseTo(1.23, 5);
    expect(snapshot.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 1,
      unpricedInvocationCount: 0,
      providerReportedCostUsd: 1.23,
    });
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
    expect(snapshot.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 1,
      providerReportedCostUsd: 0,
    });
  });

  it("rolls mixed cost coverage through tasks, purposes, models, and canonical sprints", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Mixed Cost Coverage Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-mixed-coverage",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Canonical Cost Sprint",
      number: 4,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Aggregate cost coverage",
      promptMarkdown: "Exercise all cost sources.",
    });
    const firstRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "completed",
    });
    const secondRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "completed",
    });

    const createCompletedInvocation = (
      sessionId: string,
      provider: "codex" | "opencode" | "jules",
      model: string,
      purpose: "task_coding" | "qa_coverage",
      sprintRunId: string,
      rawUsageJson?: Record<string, unknown>,
    ) => {
      const invocation = executionRepository.createProviderInvocationUsage({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId,
        sessionId,
        provider,
        purpose,
        model,
      });
      executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: "completed",
        finishedAt: new Date().toISOString(),
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 1_000_000,
        reasoningOutputTokens: 0,
        totalTokens: 2_500_000,
        usageSource: "reported",
        rawUsageJson,
      });
    };

    createCompletedInvocation(
      "configured-cost",
      "codex",
      "gpt-5.5",
      "task_coding",
      firstRun.id,
      { cost: 999 },
    );
    createCompletedInvocation(
      "reported-zero-cost",
      "opencode",
      "unknown-provider/zero-model",
      "qa_coverage",
      secondRun.id,
      { cost: 0 },
    );
    createCompletedInvocation(
      "unpriced-cost",
      "jules",
      "default",
      "task_coding",
      secondRun.id,
    );

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    const expectedCoverage = {
      configuredPricingInvocationCount: 1,
      providerReportedCostInvocationCount: 1,
      unpricedInvocationCount: 1,
      providerReportedCostUsd: 0,
    };

    expect(snapshot.usage.totalCostUsd).toBeCloseTo(35.25, 5);
    expect(snapshot.usage.costCoverage).toEqual(expectedCoverage);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.usage.costCoverage).toEqual(expectedCoverage);
    expect(snapshot.purposes.find((purpose) => purpose.id === "task_coding")?.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 1,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 1,
      providerReportedCostUsd: 0,
    });
    expect(snapshot.purposes.find((purpose) => purpose.id === "qa_coverage")?.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 1,
      unpricedInvocationCount: 0,
      providerReportedCostUsd: 0,
    });
    expect(snapshot.models.find((model) => model.provider === "codex")?.usage.costCoverage?.configuredPricingInvocationCount).toBe(1);
    expect(snapshot.models.find((model) => model.provider === "opencode")?.usage.costCoverage?.providerReportedCostInvocationCount).toBe(1);
    expect(snapshot.models.find((model) => model.provider === "jules")?.usage.costCoverage?.unpricedInvocationCount).toBe(1);
    expect(snapshot.sprints).toHaveLength(2);
    expect(snapshot.costAnalytics?.sprints).toHaveLength(1);
    expect(snapshot.costAnalytics?.sprints[0]).toMatchObject({
      id: sprint.id,
      usage: {
        totalCostUsd: 35.25,
        costCoverage: expectedCoverage,
      },
    });
    expect(snapshot.buckets.reduce(
      (sum, bucket) => sum + (bucket.usage.costCoverage?.unpricedInvocationCount ?? 0),
      0,
    )).toBe(1);
  });

  it("returns zero-filled cost coverage for an empty stats window", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Empty Cost Coverage Project",
      sourceType: "local",
      sourceRef: "/workspace/model-pricing-empty-window",
    });

    const snapshot = executionRepository.getProjectStatsSnapshot(project.id, {
      window: "custom",
      from: "2020-01-01T00:00:00.000Z",
      to: "2020-01-02T00:00:00.000Z",
    });

    expect(snapshot.usage.costCoverage).toEqual({
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 0,
      providerReportedCostUsd: 0,
    });
    expect(snapshot.costAnalytics?.sprints).toEqual([]);
  });
});
