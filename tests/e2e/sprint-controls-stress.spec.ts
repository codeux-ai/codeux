import { expect, type APIRequestContext, test } from '@playwright/test';
import type { ExecutionDashboardSnapshot, ProjectLiveDashboardSnapshot } from '../../src/contracts/app-types.js';
import type { TaskRecord } from '../../src/contracts/project-management-types.js';
import { DEFAULT_DASHBOARD_SETTINGS } from '../../src/repositories/settings-defaults.js';
import {
  cleanupSprintFixture,
  configureProjectForLocalHostExecution,
  createE2eFixturePrefix,
  createSprintWithTasks,
  fetchTasksViaApi,
  pollApiCondition,
  seedSelectedCodeUxProject,
  updateTaskFields,
  type SeededCodeUxProject,
} from './helpers/e2e-fixtures';

const ACTIVE_SPRINT_RUN_STATUSES = new Set(['queued', 'running', 'cancel_requested']);
const CLEANUP_SPRINT_RUN_STATUSES = new Set(['queued', 'running', 'paused', 'cancel_requested']);
const ACTIVE_DISPATCH_STATUSES = new Set(['queued', 'claimed', 'running', 'cancel_requested']);
const CLEANUP_DISPATCH_STATUSES = new Set(['queued', 'claimed', 'running', 'paused', 'cancel_requested']);
const TERMINAL_DISPATCH_STATUSES = new Set(['completed', 'failed', 'cancelled', 'blocked', 'quota']);

interface ApiFixture {
  fixture: SeededCodeUxProject;
  sprintIds: string[];
}

async function expectApiStatus(response: Awaited<ReturnType<APIRequestContext['post']>>, statuses: number[]): Promise<void> {
  if (statuses.includes(response.status())) {
    return;
  }
  throw new Error(`Expected API status ${statuses.join(' or ')}, received ${response.status()}: ${await response.text()}`);
}

async function fetchExecution(request: APIRequestContext, projectId: string): Promise<ExecutionDashboardSnapshot> {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/execution`);
  await expectApiStatus(response, [200]);
  return await response.json() as ExecutionDashboardSnapshot;
}

async function fetchLive(request: APIRequestContext, projectId: string): Promise<ProjectLiveDashboardSnapshot> {
  const response = await request.get(`/api/live?projectId=${encodeURIComponent(projectId)}`);
  await expectApiStatus(response, [200]);
  return await response.json() as ProjectLiveDashboardSnapshot;
}

async function startSprint(request: APIRequestContext, projectId: string, sprintId: string): Promise<void> {
  await expectApiStatus(
    await request.post(`/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/orchestrate`),
    [202],
  );
}

async function postControl(request: APIRequestContext, path: string, expectedStatuses: number[] = [200]): Promise<void> {
  await expectApiStatus(await request.post(path), expectedStatuses);
}

async function waitForSprintRun(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
  predicate: (run: ExecutionDashboardSnapshot['sprintRuns'][number]) => boolean,
  description: string,
): Promise<ExecutionDashboardSnapshot['sprintRuns'][number]> {
  const snapshot = await pollApiCondition(
    () => fetchExecution(request, projectId),
    (execution) => execution.sprintRuns.some((run) => run.sprintId === sprintId && predicate(run)),
    { timeoutMs: 30_000, intervalMs: 250, description },
  );
  const run = snapshot.sprintRuns.find((candidate) => candidate.sprintId === sprintId && predicate(candidate));
  if (!run) {
    throw new Error(`Sprint run disappeared while waiting for ${description}`);
  }
  return run;
}

async function waitForDispatch(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
  taskId: string,
  predicate: (dispatch: ExecutionDashboardSnapshot['taskDispatches'][number]) => boolean,
  description: string,
): Promise<ExecutionDashboardSnapshot['taskDispatches'][number]> {
  const snapshot = await pollApiCondition(
    () => fetchExecution(request, projectId),
    (execution) => execution.taskDispatches.some((dispatch) => (
      dispatch.sprintId === sprintId
      && dispatch.taskId === taskId
      && predicate(dispatch)
    )),
    { timeoutMs: 30_000, intervalMs: 250, description },
  );
  const dispatch = snapshot.taskDispatches.find((candidate) => (
    candidate.sprintId === sprintId
    && candidate.taskId === taskId
    && predicate(candidate)
  ));
  if (!dispatch) {
    throw new Error(`Task dispatch disappeared while waiting for ${description}`);
  }
  return dispatch;
}

async function waitForNoStaleActiveWork(request: APIRequestContext, projectId: string, description: string): Promise<void> {
  await pollApiCondition(
    () => fetchExecution(request, projectId),
    (execution) => {
      const staleRuns = execution.sprintRuns.filter((run) => ACTIVE_SPRINT_RUN_STATUSES.has(run.status));
      const staleDispatches = execution.taskDispatches.filter((dispatch) => ACTIVE_DISPATCH_STATUSES.has(dispatch.status));
      const staleInvocations = (execution.recentInvocations ?? []).filter((invocation) => invocation.status === 'running');
      return staleRuns.length === 0 && staleDispatches.length === 0 && staleInvocations.length === 0;
    },
    { timeoutMs: 30_000, intervalMs: 250, description },
  );
}

async function forceCancelActiveWork(request: APIRequestContext, projectId: string): Promise<void> {
  const execution = await fetchExecution(request, projectId).catch(() => null);
  if (!execution) {
    return;
  }

  for (const run of execution.sprintRuns) {
    if (CLEANUP_SPRINT_RUN_STATUSES.has(run.status)) {
      await postControl(
        request,
        `/api/sprint-runs/${encodeURIComponent(run.id)}/force-cancel`,
        [200, 404, 500],
      ).catch(() => undefined);
    }
  }

  const afterRuns = await fetchExecution(request, projectId).catch(() => execution);
  for (const dispatch of afterRuns.taskDispatches) {
    if (CLEANUP_DISPATCH_STATUSES.has(dispatch.status)) {
      await postControl(
        request,
        `/api/task-dispatches/${encodeURIComponent(dispatch.id)}/force-cancel`,
        [200, 404, 500],
      ).catch(() => undefined);
    }
  }

  await waitForNoStaleActiveWork(request, projectId, 'cleanup active work to settle').catch(() => undefined);
}

async function createApiFixture(
  request: APIRequestContext,
  testInfo: { workerIndex: number; repeatEachIndex: number; retry: number },
  fixtureKey: string,
  options: { watchLoop?: boolean } = {},
): Promise<ApiFixture> {
  const fixture = await seedSelectedCodeUxProject(request, { testInfo, fixtureKey });
  await configureProjectForLocalHostExecution(request, fixture.project.id, {
    sprintLoopSteps: {
      ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
      branchPreflight: false,
      watchLoop: options.watchLoop ?? true,
      watchLoopIntervalSeconds: 1,
      watchLoopOutputIntervalSeconds: 60,
    },
  });
  return { fixture, sprintIds: [] };
}

async function createSingleTaskSprint(
  request: APIRequestContext,
  fixture: SeededCodeUxProject,
  sprintIds: string[],
  args: {
    fixtureKey: string;
    promptMarkdown: string;
    testInfo: { workerIndex: number; repeatEachIndex: number; retry: number };
  },
): Promise<{ sprintId: string; task: TaskRecord }> {
  const prefix = createE2eFixturePrefix({ testInfo: args.testInfo, fixtureKey: args.fixtureKey });
  const featureBranch = `e2e/${prefix}-feature`;
  await fixture.repository.git(['branch', featureBranch]);
  const { sprint, tasks } = await createSprintWithTasks(request, fixture.project.id, {
    sprint: {
      name: `${prefix} sprint`,
      goal: 'Exercise sprint control routes with deterministic fake provider work.',
      featureBranch,
    },
    tasks: [{
      title: `${prefix} task`,
      promptMarkdown: args.promptMarkdown,
    }],
  });
  sprintIds.push(sprint.id);
  return { sprintId: sprint.id, task: tasks[0] };
}

test.describe('sprint controls stress', () => {
  test.describe.configure({ mode: 'serial' });

  let currentFixture: ApiFixture | null = null;

  test.afterEach(async ({ request }) => {
    if (!currentFixture) {
      return;
    }
    const { fixture, sprintIds } = currentFixture;
    await forceCancelActiveWork(request, fixture.project.id);
    for (const sprintId of [...sprintIds].reverse()) {
      await cleanupSprintFixture(request, fixture.project.id, sprintId).catch(() => undefined);
    }
    await fixture.cleanup();
    currentFixture = null;
  });

  test('pauses and resumes a sleeping sprint run without duplicate active runs', async ({ request }, testInfo) => {
    currentFixture = await createApiFixture(request, testInfo, 'controls-pause-resume');
    const projectId = currentFixture.fixture.project.id;
    const { sprintId, task } = await createSingleTaskSprint(request, currentFixture.fixture, currentFixture.sprintIds, {
      testInfo,
      fixtureKey: 'controls-pause-resume',
      promptMarkdown: 'Write a deterministic pause/resume marker. [mock-provider:sleep=3000] [mock-provider:write=control/pause-resume.txt]',
    });

    await startSprint(request, projectId, sprintId);
    const runningRun = await waitForSprintRun(
      request,
      projectId,
      sprintId,
      (run) => run.status === 'running',
      'sleeping sprint run to start',
    );
    await waitForDispatch(request, projectId, sprintId, task.id, (dispatch) => dispatch.status === 'running', 'sleeping dispatch to start');

    await postControl(request, `/api/sprint-runs/${encodeURIComponent(runningRun.id)}/pause`);
    await waitForSprintRun(request, projectId, sprintId, (run) => run.id === runningRun.id && run.status === 'paused', 'sprint run to pause');

    await postControl(request, `/api/sprint-runs/${encodeURIComponent(runningRun.id)}/resume`);
    const resumed = await waitForSprintRun(
      request,
      projectId,
      sprintId,
      (run) => run.id === runningRun.id && (run.status === 'running' || run.status === 'completed'),
      'sprint run to resume',
    );
    expect(resumed.id).toBe(runningRun.id);

    const execution = await fetchExecution(request, projectId);
    const activeRunsForSprint = execution.sprintRuns.filter((run) => (
      run.sprintId === sprintId && ACTIVE_SPRINT_RUN_STATUSES.has(run.status)
    ));
    expect(activeRunsForSprint.length).toBeLessThanOrEqual(1);

    await postControl(request, `/api/sprint-runs/${encodeURIComponent(runningRun.id)}/force-cancel`);
    await waitForNoStaleActiveWork(request, projectId, 'pause/resume scenario cleanup');
  });

  test('starts short sprints sequentially only after active blockers clear', async ({ request }, testInfo) => {
    currentFixture = await createApiFixture(request, testInfo, 'controls-sequential');
    const projectId = currentFixture.fixture.project.id;

    for (let index = 0; index < 3; index += 1) {
      await waitForNoStaleActiveWork(request, projectId, `before sequential start ${index + 1}`);
      const { sprintId } = await createSingleTaskSprint(request, currentFixture.fixture, currentFixture.sprintIds, {
        testInfo,
        fixtureKey: `controls-sequential-${index}`,
        promptMarkdown: `Write a deterministic sequential marker ${index}. [mock-provider:sleep=100] [mock-provider:write=control/sequential-${index}.txt]`,
      });

      await startSprint(request, projectId, sprintId);
      await waitForSprintRun(request, projectId, sprintId, (run) => run.status === 'running', `sequential sprint ${index + 1} to start`);
      await waitForNoStaleActiveWork(request, projectId, `sequential sprint ${index + 1} to settle`);
    }
  });

  test('cancels a sleeping fake CLI dispatch and leaves runtime records terminal', async ({ request }, testInfo) => {
    currentFixture = await createApiFixture(request, testInfo, 'controls-cancel');
    const projectId = currentFixture.fixture.project.id;
    const { sprintId, task } = await createSingleTaskSprint(request, currentFixture.fixture, currentFixture.sprintIds, {
      testInfo,
      fixtureKey: 'controls-cancel',
      promptMarkdown: 'Sleep until dashboard cancellation stops this task. [mock-provider:sleep=5000] [mock-provider:write=control/cancel.txt]',
    });

    await startSprint(request, projectId, sprintId);
    const sprintRun = await waitForSprintRun(request, projectId, sprintId, (run) => run.status === 'running', 'cancellable sprint run to start');
    const runningDispatch = await waitForDispatch(request, projectId, sprintId, task.id, (dispatch) => dispatch.status === 'running', 'cancellable dispatch to start');

    await postControl(request, `/api/sprint-runs/${encodeURIComponent(sprintRun.id)}/cancel`);
    await pollApiCondition(
      () => fetchExecution(request, projectId),
      (execution) => {
        const dispatch = execution.taskDispatches.find((candidate) => candidate.id === runningDispatch.id);
        const invocations = (execution.recentInvocations ?? []).filter((invocation) => invocation.sprintRunId === sprintRun.id);
        return dispatch !== undefined
          && TERMINAL_DISPATCH_STATUSES.has(dispatch.status)
          && invocations.every((invocation) => invocation.status !== 'running');
      },
      { timeoutMs: 30_000, intervalMs: 250, description: 'cancelled dispatch and provider invocations to become terminal' },
    );
    await waitForNoStaleActiveWork(request, projectId, 'cancellation scenario to settle');
  });

  test('retries a failed fake CLI dispatch after updating the task prompt', async ({ request }, testInfo) => {
    currentFixture = await createApiFixture(request, testInfo, 'controls-retry', { watchLoop: false });
    const projectId = currentFixture.fixture.project.id;
    const { sprintId, task } = await createSingleTaskSprint(request, currentFixture.fixture, currentFixture.sprintIds, {
      testInfo,
      fixtureKey: 'controls-retry',
      promptMarkdown: 'Fail the first provider attempt. [mock-provider:exit=2]',
    });

    await startSprint(request, projectId, sprintId);
    const failedDispatch = await waitForDispatch(
      request,
      projectId,
      sprintId,
      task.id,
      (dispatch) => dispatch.status === 'failed',
      'initial fake CLI dispatch to fail',
    );

    await updateTaskFields(request, projectId, task.id, {
      promptMarkdown: 'Retry with a successful fake provider write. [mock-provider:sleep=100] [mock-provider:write=control/retry-success.txt]',
    });
    await postControl(request, `/api/task-dispatches/${encodeURIComponent(failedDispatch.id)}/retry`);

    await pollApiCondition(
      () => fetchExecution(request, projectId),
      (execution) => execution.taskDispatches.some((dispatch) => (
        dispatch.taskId === task.id
        && dispatch.id !== failedDispatch.id
        && dispatch.status === 'completed'
      )),
      { timeoutMs: 30_000, intervalMs: 250, description: 'retried fake CLI dispatch to complete' },
    );

    const execution = await fetchExecution(request, projectId);
    for (const run of execution.sprintRuns.filter((run) => run.sprintId === sprintId && CLEANUP_SPRINT_RUN_STATUSES.has(run.status))) {
      await postControl(request, `/api/sprint-runs/${encodeURIComponent(run.id)}/force-cancel`);
    }
    await waitForNoStaleActiveWork(request, projectId, 'retry scenario cleanup');
  });

  test('force-completes a live task and records runtime events', async ({ request }, testInfo) => {
    currentFixture = await createApiFixture(request, testInfo, 'controls-force-complete');
    const projectId = currentFixture.fixture.project.id;
    const { sprintId, task } = await createSingleTaskSprint(request, currentFixture.fixture, currentFixture.sprintIds, {
      testInfo,
      fixtureKey: 'controls-force-complete',
      promptMarkdown: 'Sleep until the dashboard force-completes this task. [mock-provider:sleep=5000] [mock-provider:write=control/force-complete.txt]',
    });

    await startSprint(request, projectId, sprintId);
    const sprintRun = await waitForSprintRun(request, projectId, sprintId, (run) => run.status === 'running', 'force-complete sprint run to start');
    await waitForDispatch(request, projectId, sprintId, task.id, (dispatch) => dispatch.status === 'running', 'force-complete dispatch to start');

    const reason = 'E2E force-complete stress control';
    await expectApiStatus(
      await request.post(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}/force-complete`, {
        headers: { 'Content-Type': 'application/json' },
        data: { reason },
      }),
      [200],
    );

    await pollApiCondition(
      () => fetchTasksViaApi(request, projectId, sprintId),
      (tasks) => tasks.some((candidate) => candidate.id === task.id && candidate.status === 'completed' && candidate.isMerged),
      { timeoutMs: 30_000, intervalMs: 250, description: 'force-completed task record to update' },
    );

    const live = await pollApiCondition(
      () => fetchLive(request, projectId),
      (snapshot) => snapshot.execution.recentEvents.some((event) => (
        event.eventType === 'task_force_completed'
        && event.taskId === task.id
        && JSON.stringify(event.payload ?? {}).includes(reason)
      )),
      { timeoutMs: 30_000, intervalMs: 250, description: 'force-complete event to appear in live stream' },
    );
    expect(live.execution.recentEvents.some((event) => event.sprintRunId === sprintRun.id && event.eventType === 'task_force_completed')).toBe(true);

    await postControl(request, `/api/sprint-runs/${encodeURIComponent(sprintRun.id)}/force-cancel`);
    await waitForNoStaleActiveWork(request, projectId, 'force-complete scenario cleanup');
  });
});
