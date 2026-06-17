import { describe, expect, it, vi } from "vitest";
import { queryProjectStatsSnapshot } from "../../../../src/repositories/execution/project-stats-snapshot-query.js";
import { ProjectStatsQueryDependencies } from "../../../../src/repositories/execution/execution-stats-types.js";
import { mapProviderInvocationUsageRow, mapExecutionSprintRunSummaryRow } from "../../../../src/repositories/execution/execution-read-model-mappers.js";
import { ProviderInvocationUsageRow, ExecutionSprintRunSummaryRow } from "../../../../src/repositories/execution/execution-repository-types.js";
import { ExecutionUsageTotals } from "../../../../src/contracts/app-types.js";

describe("execution-read-model-mappers", () => {
  it("mapProviderInvocationUsageRow coerces fields and produces the correct shape", () => {
    const row: ProviderInvocationUsageRow = {
      id: "invoc-1",
      project_id: "proj-1",
      session_id: "sess-1",
      sprint_id: "sprint-1",
      sprint_run_id: "run-1",
      task_id: "task-1",
      dispatch_id: "disp-1",
      task_run_id: "tr-1",
      attention_item_id: null,
      connection_id: "conn-1",
      provider: "openai",
      purpose: "test_purpose",
      status: "success",
      model: "gpt-4",
      execution_mode: null,
      native_session_id: "ns-1",
      usage_source: "agent",
      prompt_chars: "100",
      transcript_chars: 50,
      input_tokens: "10",
      cached_input_tokens: null,
      output_tokens: 20,
      reasoning_output_tokens: null,
      total_tokens: 30,
      started_at: "2023-01-01T00:00:00Z",
      finished_at: "2023-01-01T00:00:01Z",
      duration_ms: "1000",
      cost_cents: "5",
      created_at: "2023-01-01T00:00:00Z",
      updated_at: "2023-01-01T00:00:01Z",
      raw_usage_json: '{"raw":true}',
    };

    const record = mapProviderInvocationUsageRow(row);
    expect(record).toMatchObject({
      id: "invoc-1",
      projectId: "proj-1",
      sessionId: "sess-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      taskId: "task-1",
      dispatchId: "disp-1",
      taskRunId: "tr-1",
      attentionItemId: null,
      connectionId: "conn-1",
      provider: "openai",
      purpose: "test_purpose",
      status: "success",
      model: "gpt-4",
      nativeSessionId: "ns-1",
      usageSource: "agent",
      promptChars: 100,
      transcriptChars: 50,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 30,
      startedAt: "2023-01-01T00:00:00Z",
      finishedAt: "2023-01-01T00:00:01Z",
      durationMs: 1000,
      costCents: 5,
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:01Z",
      rawUsageJson: { raw: true },
    });
  });

  it("mapExecutionSprintRunSummaryRow constructs the summary and includes intervention and usage", () => {
    const row: ExecutionSprintRunSummaryRow = {
      id: "run-1",
      project_id: "proj-1",
      sprint_id: "sprint-1",
      sprint_name: "Sprint 1",
      sprint_number: "2",
      status: "running",
      trigger_type: "manual",
      triggered_by: "user-1",
      executor_mode: "auto",
      started_at: "2023-01-01T00:00:00Z",
      finished_at: null,
      last_heartbeat_at: "2023-01-01T00:00:05Z",
      created_at: "2023-01-01T00:00:00Z",
      active_lease_owner_key: "worker-1",
      active_lease_expires_at: "2023-01-01T00:01:00Z",
    };

    const usage: ExecutionUsageTotals = {
      invocationCount: 1,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      unsupportedInvocationCount: 0,
      unavailableInvocationCount: 0,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 30,
      activeTimeMs: 1000,
      wallTimeMs: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      cachedInputCostUsd: 0,
      totalCostUsd: 0,
    };

    const record = mapExecutionSprintRunSummaryRow(row, null, usage);
    expect(record).toMatchObject({
      id: "run-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      sprintName: "Sprint 1",
      sprintNumber: 2,
      status: "running",
      triggerType: "manual",
      triggeredBy: "user-1",
      executorMode: "auto",
      startedAt: "2023-01-01T00:00:00Z",
      finishedAt: null,
      lastHeartbeatAt: "2023-01-01T00:00:05Z",
      createdAt: "2023-01-01T00:00:00Z",
      activeLeaseOwnerKey: "worker-1",
      activeLeaseExpiresAt: "2023-01-01T00:01:00Z",
      humanIntervention: null,
      usage,
    });
  });
});

describe("queryProjectStatsSnapshot", () => {
  it("computes stats snapshot calling the expected dependencies", () => {
    const dbMock = {
      prepare: vi.fn().mockImplementation((query: string) => {
        return {
          get: vi.fn().mockReturnValue({ id: "proj-1", name: "Project 1", sprint_id: "sprint-1", sprint_name: "Sprint 1", sprint_number: 1 }),
          all: vi.fn().mockImplementation(() => {
            if (query.includes("AVG(duration_ms)")) {
              return [{ provider: "openai", model: "gpt-4", sampleCount: 1, minMs: 100, maxMs: 100, avgMs: 100 }];
            }
            if (query.includes("duration_ms as durationMs")) {
              return [{ provider: "openai", model: "gpt-4", durationMs: 100 }];
            }
            if (query.includes("SELECT\n      CAST((julianday(started_at) - julianday(?))") || query.includes("bucketIndex,")) {
              return [
                {
                  bucketIndex: 0,
                  task_id: "task-1",
                  sprint_key: "sprint-1",
                  provider: "openai",
                  purpose: "test",
                  usage_source: "reported",
                  model: "gpt-4",
                  status: "completed",
                  lastActivityAt: "2023-01-01T00:00:00Z",
                  invocationCount: 1,
                  activeTimeMs: 100,
                  inputTokens: 1000000,
                  cachedInputTokens: 500000,
                  outputTokens: 2000000,
                  reasoningOutputTokens: 0,
                  totalTokens: 3500000,
                  toolCallCount: 0,
                  reportedInvocationCount: 1,
                  estimatedInvocationCount: 0,
                  unsupportedInvocationCount: 0,
                  unavailableInvocationCount: 0,
                }
              ];
            }
            return [];
          }),
        };
      })
    };

    const depsMock: ProjectStatsQueryDependencies = {
      requireProject: vi.fn(),
      getWallTimeTotalsByTaskIdsForRange: vi.fn().mockReturnValue(new Map()),
      getWallTimeTotalsBySprintRunIdsForRange: vi.fn().mockReturnValue(new Map()),
      getTaskMetadata: vi.fn().mockReturnValue(new Map()),
      getSprintMetadata: vi.fn().mockReturnValue(new Map()),
      updateLastActivity: vi.fn(),
      getProviderPricing: vi.fn().mockReturnValue({ inputTokens: 5, outputTokens: 15, cachedInputTokens: 2.5 }),
    };

    const snapshot = queryProjectStatsSnapshot(dbMock as any, "proj-1", "7d", depsMock);

    expect(depsMock.requireProject).toHaveBeenCalledWith("proj-1");
    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.projectName).toBe("Project 1");
    expect(snapshot.window).toBe("7d");
    expect(snapshot.git).toBeDefined();
    expect(snapshot.git.totals).toEqual({ insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0, mergeConflictCount: 0 });

    // Assert calculated usage costs
    expect(snapshot.usage.inputCostUsd).toBe(5); // 1,000,000 / 1_000_000 * 5
    expect(snapshot.usage.cachedInputCostUsd).toBe(1.25); // 500,000 / 1_000_000 * 2.5
    expect(snapshot.usage.outputCostUsd).toBe(30); // 2,000,000 / 1_000_000 * 15
    expect(snapshot.usage.totalCostUsd).toBe(36.25);

    // Assert provider and model costs are tracked
    expect(snapshot.providers.find(p => p.id === "openai")?.usage.totalCostUsd).toBe(36.25);
    expect(snapshot.models.find(m => m.provider === "openai")?.usage.totalCostUsd).toBe(36.25);

    // Assert bucket aggregates have correct cost
    expect(snapshot.buckets[0].usage.totalCostUsd).toBe(36.25);

    // Assert chart series exist
    expect(snapshot.chartSeries.find(s => s.id === 'core_total_cost')).toMatchObject({ grouping: 'totals', formatter: 'number', defaultEnabled: false });
    expect(snapshot.chartSeries.find(s => s.id === 'provider_cost_openai')).toMatchObject({ grouping: 'providers_cost', formatter: 'number', defaultEnabled: false });
    expect(snapshot.chartSeries.find(s => s.id.startsWith('model_cost_'))).toMatchObject({ grouping: 'models_cost', formatter: 'number', defaultEnabled: false });
    expect(snapshot.activeSprint?.sprintId).toBe("sprint-1");

    // Model + reliability analytics are present even on an empty window
    expect(snapshot.models.length).toBe(1);
    expect(snapshot.statusCounts).toEqual({ completed: 1, failed: 0, cancelled: 0, running: 0, paused: 0 });
    // Duration reflects the mock data injected via the aggregate query
    expect(snapshot.duration).toEqual({ sampleCount: 1, avgMs: 100, p50Ms: 100, p95Ms: 100, maxMs: 100 });
    expect(snapshot.chartSeries.find(s => s.id === 'core_cache_hit')).toMatchObject({ grouping: 'details', formatter: 'percent', defaultEnabled: false });

    // Assert git series
    expect(snapshot.chartSeries.find(s => s.id === 'git_insertions')).toMatchObject({ grouping: 'git', formatter: 'number', defaultEnabled: true });
    expect(snapshot.chartSeries.find(s => s.id === 'git_deletions')).toMatchObject({ grouping: 'git', formatter: 'number', defaultEnabled: true });
    expect(snapshot.chartSeries.find(s => s.id === 'git_prs')).toMatchObject({ grouping: 'git', formatter: 'number', defaultEnabled: false });
    expect(snapshot.chartSeries.find(s => s.id === 'git_merges')).toMatchObject({ grouping: 'git', formatter: 'number', defaultEnabled: false });
  });
});
