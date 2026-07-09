import { expect, type APIRequestContext, type APIResponse, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionDashboardSnapshot } from '../../../src/contracts/app-types.js';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import type {
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
  ProjectInvocationsQueryResult,
} from '../../../src/contracts/invocation-types.js';
import type { ProjectSettingsOverride } from '../../../src/contracts/settings-scope-types.js';
import {
  completeOnboardingViaApi,
  createProjectViaApi,
  deleteProjectViaApi,
  selectProjectViaApi,
} from '../helpers/e2e-api';
import {
  buildLocalHostExecutionSettingsOverride,
  configureProjectForLocalHostExecution,
  createE2eFixturePrefix,
  createSprintWithTasks,
  createTemporaryGitRepository,
  pollApiCondition,
  type TemporaryGitRepository,
} from '../helpers/e2e-fixtures';

type LiveSnapshot = {
  projectId: string | null;
  selectedSprintId: string | null;
  status: {
    project_id?: string;
    sprint_id?: string;
    subtasks: Array<{ record_id?: string; id: string; status?: string }>;
    timestamp: string | null;
  };
  execution: ExecutionDashboardSnapshot;
  updatedAt: string | null;
};

const TERMINAL_SUCCESS_DISPATCH_STATUS = 'completed';
const TERMINAL_SUCCESS_TASK_RUN_STATE = 'COMPLETED';
const TERMINAL_SUCCESS_INVOCATION_STATUS = 'completed';
const TERMINAL_SUCCESS_SPRINT_RUN_STATUS = 'completed';
const TASK_CODING_INVOCATION_TYPES = new Set(['cli_task_coding', 'task_coding']);
const MOCKUP_CLI_PROVIDER = 'mockup-cli';

function buildMockupCliHostExecutionSettings(): ProjectSettingsOverride {
  const base = buildLocalHostExecutionSettingsOverride();
  const aiProvider = base.aiProvider;
  const workers = base.workers;
  if (!aiProvider || !workers) {
    throw new Error('E2E local host execution settings were missing required sections.');
  }
  const mockupCli = aiProvider.providers[MOCKUP_CLI_PROVIDER];
  if (!mockupCli) {
    throw new Error('E2E local host execution settings were missing the mockup-cli provider.');
  }
  const routeProvider = { enabled: true, model: 'default', weight: 100 };
  const workerRoute = () => ({
    profile: 'WORKER' as const,
    strategy: 'MANUAL' as const,
    provider: MOCKUP_CLI_PROVIDER,
    allowedProviders: [MOCKUP_CLI_PROVIDER],
    providers: { [MOCKUP_CLI_PROVIDER]: routeProvider },
  });

  return {
    ...base,
    sprintLoopSteps: {
      branchPreflight: false,
    },
    aiProvider: {
      ...aiProvider,
      provider: MOCKUP_CLI_PROVIDER,
      strategy: 'MANUAL',
      providers: {
        ...aiProvider.providers,
        [MOCKUP_CLI_PROVIDER]: {
          ...mockupCli,
          name: 'E2E Mockup CLI',
          enabled: true,
          model: 'default',
          weight: 100,
          maxConcurrentTasks: 4,
        },
      },
      invocationRouting: {
        ...aiProvider.invocationRouting,
        task_coding: {
          ...aiProvider.invocationRouting.task_coding,
          profile: 'GLOBAL',
          strategy: 'MANUAL',
          provider: MOCKUP_CLI_PROVIDER,
          allowedProviders: [MOCKUP_CLI_PROVIDER],
          providers: { [MOCKUP_CLI_PROVIDER]: routeProvider },
        },
        planning: workerRoute(),
        ci_fix: workerRoute(),
        merge_conflict: workerRoute(),
      },
    },
    workers: {
      ...workers,
      virtualWorkerProvider: MOCKUP_CLI_PROVIDER,
      model: 'default',
      maxConcurrency: 4,
      timeoutSeconds: 120,
    },
  };
}

async function readJson<T>(response: APIResponse, context: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${context} failed with ${response.status()}: ${await response.text()}`);
  }
  return await response.json() as T;
}

async function fetchExecutionSnapshot(request: APIRequestContext, projectId: string): Promise<ExecutionDashboardSnapshot> {
  return readJson<ExecutionDashboardSnapshot>(
    await request.get(`/api/projects/${encodeURIComponent(projectId)}/execution`),
    'fetch project execution snapshot',
  );
}

async function fetchSelectedExecutionSnapshot(request: APIRequestContext): Promise<ExecutionDashboardSnapshot> {
  return readJson<ExecutionDashboardSnapshot>(
    await request.get('/api/execution'),
    'fetch selected execution snapshot',
  );
}

async function fetchLiveSnapshot(request: APIRequestContext, projectId: string): Promise<LiveSnapshot> {
  return readJson<LiveSnapshot>(
    await request.get(`/api/live?projectId=${encodeURIComponent(projectId)}`),
    'fetch live snapshot',
  );
}

async function fetchProjectInvocations(
  request: APIRequestContext,
  projectId: string,
): Promise<ProjectInvocationsQueryResult> {
  return readJson<ProjectInvocationsQueryResult>(
    await request.get(
      `/api/projects/${encodeURIComponent(projectId)}/execution/invocations?limit=50&purpose=task_coding&sortKey=startedAt&sortDir=desc`,
    ),
    'fetch project invocations',
  );
}

async function fetchInvocationMessages(
  request: APIRequestContext,
  invocationId: string,
): Promise<ExecutionInvocationMessageRecord[]> {
  return readJson<ExecutionInvocationMessageRecord[]>(
    await request.get(`/api/execution/invocations/${encodeURIComponent(invocationId)}/messages`),
    'fetch invocation messages',
  );
}

function requireTaskCodingInvocation(
  invocations: ProjectInvocationsQueryResult,
  taskId: string,
): ExecutionInvocationRecord {
  const invocation = invocations.items.find((item) => (
    item.taskId === taskId
    && TASK_CODING_INVOCATION_TYPES.has(item.type)
    && item.status === TERMINAL_SUCCESS_INVOCATION_STATUS
  ));

  if (!invocation) {
    throw new Error(`Completed task-coding invocation was not found. Items: ${JSON.stringify(invocations.items)}`);
  }

  return invocation;
}

function assertNoSecretOrHomeLeak(messages: ExecutionInvocationMessageRecord[]): void {
  const combined = messages.map((message) => message.contentMarkdown).join('\n\n');

  expect(combined).not.toContain('codeux-e2e-home-');
  expect(combined).not.toContain('/.code-ux/app.db');
  expect(combined).not.toMatch(/(?:OPENAI|ANTHROPIC|GEMINI|JULES|GITHUB|GITLAB|QWEN|DASHSCOPE|ANTIGRAVITY)_[A-Z_]*(?:KEY|TOKEN)\s*=/i);
  expect(combined).not.toMatch(/ghp_[A-Za-z0-9_]+/);
  expect(combined).not.toMatch(/glpat-[A-Za-z0-9_-]+/);
}

test.describe('invocation runtime observability', () => {
  let cleanupProject: (() => Promise<void>) | null = null;

  test.afterEach(async () => {
    await cleanupProject?.();
    cleanupProject = null;
  });

  test('surfaces a deterministic fake-CLI task run through runtime APIs', async ({ request }, testInfo) => {
    test.setTimeout(90_000);

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'invocation-runtime' });
    const featureBranch = `e2e/invocation-runtime-w${testInfo.workerIndex}-r${testInfo.retry}`;
    const repository: TemporaryGitRepository = await createTemporaryGitRepository({ prefix });
    await repository.git(['checkout', '-B', featureBranch, 'main']);
    await completeOnboardingViaApi(request);
    const project: ProjectSummary = await createProjectViaApi(request, {
      name: `E2E Git Project ${prefix.slice(-8)}`,
      sourceType: 'local',
      sourceRef: repository.root,
      status: 'idle',
      initMode: 'existing',
      defaultBranch: 'main',
      featureBranchPrefix: 'e2e/',
    });
    cleanupProject = async () => {
      await deleteProjectViaApi(request, project.id);
      await repository.cleanup();
    };
    await configureProjectForLocalHostExecution(request, project.id, buildMockupCliHostExecutionSettings());
    const effectiveSettingsResponse = await request.get(`/api/projects/${encodeURIComponent(project.id)}/settings/effective`);
    expect(effectiveSettingsResponse.status()).toBe(200);
    const effectiveSettings = await effectiveSettingsResponse.json() as {
      settings: {
        cliWorkflow?: { executionMode?: string; gitMode?: string };
        sprintLoopSteps?: { branchPreflight?: boolean };
      };
    };
    expect(effectiveSettings.settings.cliWorkflow?.executionMode).toBe('HOST');
    expect(effectiveSettings.settings.cliWorkflow?.gitMode).toBe('local');
    expect(effectiveSettings.settings.sprintLoopSteps?.branchPreflight).toBe(false);
    await selectProjectViaApi(request, project.id);

    const outputRelativePath = path.posix.join('e2e-output', `${prefix}-provider.txt`);
    const taskPrompt = [
      'Use the deterministic mockup-cli fake CLI provider for this task.',
      `mockup-cli:write ${outputRelativePath} :: Code UX mock provider output\\nprovider=mockup-cli\\nmodel=default`,
      'The resulting file must be deterministic and must not include secrets.',
    ].join('\n');
    const { sprint, tasks } = await createSprintWithTasks(request, project.id, {
      sprint: {
        name: `${prefix} invocation runtime sprint`,
        goal: 'Verify fake CLI invocation telemetry through dashboard runtime APIs.',
        featureBranch,
      },
      tasks: [
        {
          title: `${prefix} invocation runtime task`,
          promptMarkdown: taskPrompt,
        },
      ],
    });
    const task = tasks[0]!;

    const orchestrateResponse = await request.post(
      `/api/projects/${encodeURIComponent(project.id)}/sprints/${encodeURIComponent(sprint.id)}/orchestrate`,
    );
    expect(orchestrateResponse.status()).toBe(202);

    const execution = await pollApiCondition(
      async () => fetchExecutionSnapshot(request, project.id),
      (snapshot) => {
        const sprintRun = snapshot.sprintRuns.find((run) => run.sprintId === sprint.id);
        const taskDispatch = snapshot.taskDispatches.find((dispatch) => dispatch.taskId === task.id);
        if (
          sprintRun?.status === 'failed'
          || sprintRun?.status === 'cancelled'
          || taskDispatch?.status === 'failed'
          || taskDispatch?.status === 'cancelled'
          || taskDispatch?.taskRunState === 'FAILED'
        ) {
          throw new Error(`E2E orchestration reached a failed terminal state: ${JSON.stringify({ sprintRun, taskDispatch })}`);
        }

        return sprintRun?.status === TERMINAL_SUCCESS_SPRINT_RUN_STATUS
          && taskDispatch?.status === TERMINAL_SUCCESS_DISPATCH_STATUS
          && taskDispatch.taskRunState === TERMINAL_SUCCESS_TASK_RUN_STATE
          && snapshot.recentEvents.some((event) => event.taskId === task.id)
          && snapshot.recentInvocations?.some((invocation) => (
            invocation.taskId === task.id
            && TASK_CODING_INVOCATION_TYPES.has(invocation.type)
            && invocation.status === TERMINAL_SUCCESS_INVOCATION_STATUS
          )) === true;
      },
      {
        timeoutMs: 70_000,
        intervalMs: 500,
        description: 'completed fake CLI dispatch, task run, sprint run, events, and invocation',
      },
    );

    const selectedExecution = await fetchSelectedExecutionSnapshot(request);
    expect(selectedExecution.projectId).toBe(project.id);
    expect(selectedExecution.sprintRuns.some((run) => run.sprintId === sprint.id)).toBe(true);
    expect(selectedExecution.taskDispatches.some((dispatch) => dispatch.taskId === task.id)).toBe(true);

    const sprintRun = execution.sprintRuns.find((run) => run.sprintId === sprint.id);
    const taskDispatch = execution.taskDispatches.find((dispatch) => dispatch.taskId === task.id);
    expect(sprintRun).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      status: TERMINAL_SUCCESS_SPRINT_RUN_STATUS,
    });
    expect(taskDispatch).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun?.id,
      taskId: task.id,
      status: TERMINAL_SUCCESS_DISPATCH_STATUS,
      taskRunState: TERMINAL_SUCCESS_TASK_RUN_STATE,
      provider: MOCKUP_CLI_PROVIDER,
    });
    expect(execution.recentEvents.some((event) => (
      event.projectId === project.id
      && event.sprintId === sprint.id
      && event.taskId === task.id
      && event.taskRunState === TERMINAL_SUCCESS_TASK_RUN_STATE
    ))).toBe(true);
    expect(execution.recentInvocations?.some((invocation) => invocation.taskId === task.id)).toBe(true);

    const invocations = await fetchProjectInvocations(request, project.id);
    const invocation = requireTaskCodingInvocation(invocations, task.id);
    expect(invocation).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun?.id,
      dispatchId: taskDispatch?.id,
      taskRunId: taskDispatch?.taskRunId,
      type: 'cli_task_coding',
      status: TERMINAL_SUCCESS_INVOCATION_STATUS,
      provider: MOCKUP_CLI_PROVIDER,
      model: 'default',
      executionMode: 'HOST',
      taskTitle: task.title,
    });
    expect(invocation.messageCount).toBeGreaterThanOrEqual(2);
    expect(invocation.promptChars).toBeGreaterThanOrEqual(taskPrompt.length);
    expect(invocation.transcriptChars).toBeGreaterThan(0);

    const messages = await fetchInvocationMessages(request, invocation.id);
    expect(messages.some((message) => message.role === 'user' && message.contentMarkdown.includes(outputRelativePath))).toBe(true);
    expect(messages.some((message) => (
      message.role === 'assistant'
      && message.contentMarkdown.includes('Mockup CLI completed deterministic workspace task.')
    ))).toBe(true);
    assertNoSecretOrHomeLeak(messages);

    const live = await fetchLiveSnapshot(request, project.id);
    expect(live.projectId).toBe(project.id);
    expect(live.selectedSprintId).toBe(sprint.id);
    expect(live.status.project_id).toBe(project.id);
    expect(live.status.subtasks.some((subtask) => subtask.record_id === task.id || subtask.id === task.taskKey)).toBe(true);
    expect(live.execution.projectId).toBe(project.id);
    expect(live.execution.sprintRuns.some((run) => run.sprintId === sprint.id)).toBe(true);
    expect(live.execution.taskDispatches.some((dispatch) => dispatch.taskId === task.id)).toBe(true);
    expect(live.execution.recentEvents.length).toBeGreaterThan(0);
    expect(live.execution.recentInvocations?.some((item) => item.id === invocation.id)).toBe(true);

    const outputContent = await fs.readFile(path.join(repository.root, outputRelativePath), 'utf8');
    expect(outputContent).toContain('Code UX mock provider output');
    expect(outputContent).toContain(`provider=${MOCKUP_CLI_PROVIDER}`);
    expect(outputContent).toContain('model=default');
  });
});
