import type { TaskPrComposerInput, SprintPrComposerInput } from "../../../../src/domain/sprint/composer/pr-description-composer.js";

const SAMPLE_TASK_PROMPT = `Add rate limiting to the webhook ingestion endpoint.

Use a token-bucket algorithm keyed by the source IP + webhook signature, backed by the existing
Redis client. Requests over the limit should return 429 with a Retry-After header. Add unit tests
covering the burst and steady-state cases, and update the API docs.`;

const SAMPLE_SPRINT_PROMPT = `Build a rate-limited webhook ingestion pipeline with retry and dead-lettering.

We're seeing occasional bursts from a couple of high-volume partners that overwhelm downstream
processing. Add ingestion-side rate limiting, a retry queue for transient failures, and a
dead-letter queue for anything that fails repeatedly so we stop losing events silently.`;

export const SAMPLE_TASK_PR_INPUT: Omit<TaskPrComposerInput, "sections"> = {
  taskId: "task-42",
  taskTitle: "Add rate limiting to webhook ingestion endpoint",
  taskPrompt: SAMPLE_TASK_PROMPT,
  provider: "claude-code",
  model: "claude-opus-4-6",
  sprintGoal: SAMPLE_SPRINT_PROMPT,
  sprintNumber: 12,
  sprintName: "Webhook Reliability",
  featureBranch: "sprint/12-webhook-reliability",
  workerBranch: "sprint/12-webhook-reliability/task-42",
  startedAt: "2026-07-01T14:02:00.000Z",
  finishedAt: "2026-07-01T14:16:12.000Z",
  durationMs: 14 * 60 * 1000 + 12 * 1000,
  usage: {
    invocationCount: 3,
    inputTokens: 42180,
    cachedInputTokens: 18650,
    outputTokens: 8340,
    totalTokens: 69170,
    toolCallCount: 27,
    activeTimeMs: 14 * 60 * 1000 + 12 * 1000,
    costUsd: 0.87,
    billedInvocationCount: 3,
    subscriptionInvocationCount: 0,
  },
  qa: {
    outcome: "changes_requested",
    summary: "Rate limiter looks correct but the Retry-After header uses seconds where the spec expects milliseconds.",
    findings: [
      "Retry-After header returns seconds; downstream client expects milliseconds — see webhook-ingestion.ts:118.",
      "Missing test for the exact-boundary case (request count == limit).",
      "Consider logging the rejected IP for abuse monitoring.",
    ],
    reviewer: "qa-agent",
    finishedAt: "2026-07-01T14:20:00.000Z",
  },
};

export const SAMPLE_SPRINT_PR_INPUT: Omit<SprintPrComposerInput, "sections"> = {
  sprintId: "sprint-12",
  sprintNumber: 12,
  sprintName: "Webhook Reliability",
  sprintGoal: SAMPLE_SPRINT_PROMPT,
  sprintOriginalPrompt: SAMPLE_SPRINT_PROMPT,
  defaultBranch: "main",
  featureBranch: "sprint/12-webhook-reliability",
  subtasks: [
    { id: "task-40", title: "Add Redis-backed token bucket rate limiter", provider: "claude-code", model: "claude-opus-4-6", prUrl: "https://github.com/example/repo/pull/401", completed: true },
    { id: "task-41", title: "Add retry queue for transient ingestion failures", provider: "codex", model: "gpt-6-codex", prUrl: "https://github.com/example/repo/pull/402", completed: true },
    { id: "task-42", title: "Add rate limiting to webhook ingestion endpoint", provider: "claude-code", model: "claude-opus-4-6", prUrl: "https://github.com/example/repo/pull/403", completed: true },
    { id: "task-43", title: "Add dead-letter queue + alerting", provider: "gemini", model: "gemini-3-pro", prUrl: "https://github.com/example/repo/pull/404", completed: true },
    { id: "task-44", title: "Update API docs and runbook", provider: "claude-code", model: "claude-sonnet-5", completed: false },
  ],
  planning: {
    provider: "claude-code",
    model: "claude-opus-4-6",
    usage: {
      invocationCount: 1,
      inputTokens: 12400,
      cachedInputTokens: 2100,
      outputTokens: 3800,
      totalTokens: 16200,
      toolCallCount: 4,
      activeTimeMs: 96 * 1000,
      costUsd: 0.31,
      billedInvocationCount: 1,
      subscriptionInvocationCount: 0,
    },
  },
  aggregateUsage: {
    invocationCount: 14,
    inputTokens: 214000,
    cachedInputTokens: 61200,
    outputTokens: 48300,
    totalTokens: 262300,
    toolCallCount: 133,
    activeTimeMs: 2 * 60 * 60 * 1000 + 40 * 60 * 1000,
    costUsd: 3.42,
    billedInvocationCount: 9,
    subscriptionInvocationCount: 5,
  },
  startedAt: "2026-07-01T09:00:00.000Z",
  finishedAt: "2026-07-01T11:40:00.000Z",
  qa: {
    outcome: "pass",
    summary: "All tasks reviewed. One follow-up noted for the Retry-After header units, already addressed before merge.",
    findings: [
      "Retry-After header units mismatch was caught and fixed during task-42 QA.",
      "Dead-letter queue alerting threshold looks conservative — consider revisiting after a week of production data.",
    ],
    reviewer: "qa-agent",
    finishedAt: "2026-07-01T11:38:00.000Z",
  },
};
