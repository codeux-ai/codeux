import { expect, test, type APIRequestContext } from '@playwright/test';
import type { ExecutionDashboardSnapshot, ExecutionTaskDispatchSummary } from '../../src/contracts/app-types.js';
import type { ExecutionInvocationRecord, ProjectInvocationsQueryResult } from '../../src/contracts/invocation-types.js';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../src/contracts/project-management-types.js';
import type { ProjectSettingsOverride } from '../../src/contracts/settings-scope-types.js';
import { DEFAULT_DASHBOARD_SETTINGS } from '../../src/repositories/settings-defaults.js';
import {
  completeOnboardingViaApi,
  createProjectViaApi,
  createSprintViaApi,
  createTaskViaApi,
  deleteProjectViaApi,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  selectProjectViaApi,
  selectSprintViaApi,
} from './helpers/e2e-api';
import {
  buildLocalHostExecutionSettingsOverride,
  configureProjectForLocalHostExecution,
  createE2eFixturePrefix,
  createTemporaryGitRepository,
  pollApiCondition,
  type TemporaryGitRepository,
} from './helpers/e2e-fixtures';

const ACTIVE_DISPATCH_STATUSES = new Set(['queued', 'claimed', 'running', 'cancel_requested', 'paused']);
const ACTIVE_SPRINT_RUN_STATUSES = new Set(['queued', 'running', 'paused', 'cancel_requested']);
const ACTIVE_INVOCATION_STATUSES = new Set(['running', 'paused']);
const TERMINAL_SPRINT_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

interface SprintFixture {
  project: ProjectSummary;
  sprint: SprintRecord;
  repository: TemporaryGitRepository;
  tasks: {
    rootAlpha: TaskRecord;
    rootBeta: TaskRecord;
    dependent: TaskRecord;
    noChange: TaskRecord;
    lowPriority: TaskRecord;
  };
}

async function expectApiAccepted(responsePromise: Promise<{ status: () => number; text: () => Promise<string> }>): Promise<void> {
  const response = await responsePromise;
  if (response.status() !== 202) {
    throw new Error(`Expected orchestration API to return 202, received ${response.status()}: ${await response.text()}`);
  }
}

async function fetchExecutionSnapshot(
  request: APIRequestContext,
  projectId: string,
): Promise<ExecutionDashboardSnapshot> {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/execution`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as ExecutionDashboardSnapshot;
}

async function fetchProjectInvocations(
  request: APIRequestContext,
  projectId: string,
  query: Record<string, string>,
): Promise<ExecutionInvocationRecord[]> {
  const params = new URLSearchParams(query);
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/execution/invocations?${params.toString()}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as ProjectInvocationsQueryResult;
  return payload.items;
}

function dispatchByTaskId(
  snapshot: ExecutionDashboardSnapshot,
  taskId: string,
): ExecutionTaskDispatchSummary | null {
  return snapshot.taskDispatches.find((dispatch) => dispatch.taskId === taskId) ?? null;
}

function requireDispatch(
  snapshot: ExecutionDashboardSnapshot,
  task: TaskRecord,
): ExecutionTaskDispatchSummary {
  const dispatch = dispatchByTaskId(snapshot, task.id);
  if (!dispatch) {
    throw new Error(`Missing dispatch for ${task.taskKey} ${task.title}`);
  }
  return dispatch;
}

function isoTime(value: string | null): number {
  expect(value).toBeTruthy();
  return Date.parse(value as string);
}

function taskPrompt(taskKey: string, title: string, marker: string): string {
  return [
    marker,
    `[mock-provider:sleep=${taskKey === 'T01' || taskKey === 'T02' ? '5000' : taskKey === 'T03' ? '3000' : '500'}]`,
    `TASK ${taskKey} ${title}`,
    'Write only the deterministic mock-provider fixture output for this E2E task.',
  ].join('\n');
}

function buildFullSprintSettingsOverride(): ProjectSettingsOverride {
  return {
    ...buildLocalHostExecutionSettingsOverride(),
    sprintLoopSteps: {
      ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
      branchPreflight: false,
      sessionSync: false,
      watchLoopIntervalSeconds: 1,
      watchLoopOutputIntervalSeconds: 30,
    },
  };
}

async function expectHostCliSettings(
  request: APIRequestContext,
  projectId: string,
  sprintId?: string,
): Promise<void> {
  const url = sprintId
    ? `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/settings/effective`
    : `/api/projects/${encodeURIComponent(projectId)}/settings/effective`;
  const response = await request.get(url);
  expect(response.ok(), `${url} should load`).toBeTruthy();
  const payload = await response.json() as { settings: { cliWorkflow: { executionMode: string; gitMode: string }; git: { githubMode: string } } };
  expect(payload.settings.cliWorkflow.executionMode).toBe('HOST');
  expect(payload.settings.cliWorkflow.gitMode).toBe('local');
  expect(payload.settings.git.githubMode).toBe('LOCAL');
}

async function prepareFullSprintFixture(
  request: APIRequestContext,
  testInfo: { workerIndex: number; repeatEachIndex: number; retry: number },
): Promise<SprintFixture> {
  await completeOnboardingViaApi(request);
  const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'full-sprint-orchestration' });
  const repository = await createTemporaryGitRepository({ prefix });

  await repository.writeFile('.gitattributes', '.codeux-mock-provider/provider-run.json merge=ours\n');
  await repository.writeFile('.codeux-mock-provider/provider-run.json', '{}\n');
  await repository.git(['config', 'merge.ours.driver', 'true']);
  await repository.git(['add', '.gitattributes', '.codeux-mock-provider/provider-run.json']);
  await repository.git(['commit', '-m', 'Configure E2E mock provider audit merge']);
  const featureBranch = `e2e/full-sprint-${testInfo.workerIndex}-${testInfo.retry}`;
  await repository.git(['branch', featureBranch, 'main']);
  await repository.git(['checkout', '--detach', 'HEAD']);
  const settingsOverrides = buildFullSprintSettingsOverride();

  const project = await createProjectViaApi(request, {
    name: `E2E Full Sprint ${prefix.slice(-8)}`,
    sourceType: 'local',
    sourceRef: repository.root,
    status: 'idle',
    initMode: 'existing',
    defaultBranch: 'main',
    featureBranchPrefix: 'e2e/',
    settingsOverrides,
  });

  await configureProjectForLocalHostExecution(request, project.id, settingsOverrides);
  await expectHostCliSettings(request, project.id);
  await selectProjectViaApi(request, project.id);

  const sprint = await createSprintViaApi(request, project.id, {
    name: `${prefix} full sprint`,
    goal: 'Exercise local full-sprint orchestration with deterministic fake CLI writes.',
    status: 'idle',
    showcasePinned: false,
    featureBranch,
  });
  await expectHostCliSettings(request, project.id, sprint.id);
  await selectSprintViaApi(request, project.id, sprint.id);

  const rootAlpha = await createTaskViaApi(request, project.id, {
    sprintId: sprint.id,
    taskKey: 'T01',
    title: 'Root alpha write',
    promptMarkdown: taskPrompt('T01', 'Root alpha write', '[mock-provider:write=e2e-output/root-alpha.txt]'),
    priority: 'high',
    executorType: 'auto',
  });
  const rootBeta = await createTaskViaApi(request, project.id, {
    sprintId: sprint.id,
    taskKey: 'T02',
    title: 'Root beta write',
    promptMarkdown: taskPrompt('T02', 'Root beta write', '[mock-provider:write=e2e-output/root-beta.txt]'),
    priority: 'high',
    executorType: 'auto',
  });
  const dependent = await createTaskViaApi(request, project.id, {
    sprintId: sprint.id,
    taskKey: 'T03',
    title: 'Dependent write after roots',
    promptMarkdown: taskPrompt('T03', 'Dependent write after roots', '[mock-provider:write=e2e-output/dependent.txt]'),
    priority: 'medium',
    executorType: 'auto',
    dependsOnTaskIds: [rootAlpha.id, rootBeta.id],
  });
  const noChange = await createTaskViaApi(request, project.id, {
    sprintId: sprint.id,
    taskKey: 'T04',
    title: 'No change settlement',
    promptMarkdown: [
      '[mock-provider:no-op]',
      '[mock-provider:sleep=1000]',
      'TASK T04 No change settlement',
      'Return successfully without modifying files.',
    ].join('\n'),
    priority: 'medium',
    executorType: 'auto',
  });
  const lowPriority = await createTaskViaApi(request, project.id, {
    sprintId: sprint.id,
    taskKey: 'T05',
    title: 'Low priority unlock write',
    promptMarkdown: taskPrompt('T05', 'Low priority unlock write', '[mock-provider:write=e2e-output/low-priority.txt]'),
    priority: 'low',
    executorType: 'auto',
    dependsOnTaskIds: [dependent.id],
  });

  return {
    project,
    sprint,
    repository,
    tasks: {
      rootAlpha,
      rootBeta,
      dependent,
      noChange,
      lowPriority,
    },
  };
}

test.describe('full sprint orchestration', () => {
  test('runs a local multi-task sprint to completion with dependency ordering and fake CLI writes', async ({ request }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = await prepareFullSprintFixture(request, testInfo);

    try {
      await expectApiAccepted(
        request.post(`/api/projects/${encodeURIComponent(fixture.project.id)}/sprints/${encodeURIComponent(fixture.sprint.id)}/orchestrate`),
      );

      const rootConcurrentSnapshot = await pollApiCondition(
        () => fetchExecutionSnapshot(request, fixture.project.id),
        (snapshot) => {
          const alpha = dispatchByTaskId(snapshot, fixture.tasks.rootAlpha.id);
          const beta = dispatchByTaskId(snapshot, fixture.tasks.rootBeta.id);
          return alpha?.status === 'running'
            && beta?.status === 'running'
            && !dispatchByTaskId(snapshot, fixture.tasks.dependent.id)
            && !dispatchByTaskId(snapshot, fixture.tasks.lowPriority.id);
        },
        {
          timeoutMs: 25_000,
          intervalMs: 250,
          description: 'root tasks should run concurrently while dependent tasks remain undispatched',
        },
      );
      expect(requireDispatch(rootConcurrentSnapshot, fixture.tasks.rootAlpha).startedAt).toBeTruthy();
      expect(requireDispatch(rootConcurrentSnapshot, fixture.tasks.rootBeta).startedAt).toBeTruthy();
      expect(dispatchByTaskId(rootConcurrentSnapshot, fixture.tasks.dependent.id)).toBeNull();
      expect(dispatchByTaskId(rootConcurrentSnapshot, fixture.tasks.lowPriority.id)).toBeNull();

      const dependentRunningSnapshot = await pollApiCondition(
        () => fetchExecutionSnapshot(request, fixture.project.id),
        (snapshot) => {
          const dependent = dispatchByTaskId(snapshot, fixture.tasks.dependent.id);
          return dependent?.status === 'running'
            && requireDispatch(snapshot, fixture.tasks.rootAlpha).status === 'completed'
            && requireDispatch(snapshot, fixture.tasks.rootBeta).status === 'completed'
            && !dispatchByTaskId(snapshot, fixture.tasks.lowPriority.id);
        },
        {
          timeoutMs: 45_000,
          intervalMs: 500,
          description: 'dependent task should unlock only after both root tasks complete',
        },
      );
      const dependentDispatch = requireDispatch(dependentRunningSnapshot, fixture.tasks.dependent);
      const alphaDispatch = requireDispatch(dependentRunningSnapshot, fixture.tasks.rootAlpha);
      const betaDispatch = requireDispatch(dependentRunningSnapshot, fixture.tasks.rootBeta);
      expect(isoTime(dependentDispatch.startedAt)).toBeGreaterThanOrEqual(
        Math.max(isoTime(alphaDispatch.finishedAt), isoTime(betaDispatch.finishedAt)),
      );

      const completedSnapshot = await pollApiCondition(
        () => fetchExecutionSnapshot(request, fixture.project.id),
        (snapshot) => {
          const sprintRun = snapshot.sprintRuns.find((run) => run.sprintId === fixture.sprint.id);
          if (!sprintRun || !TERMINAL_SPRINT_RUN_STATUSES.has(sprintRun.status)) {
            return false;
          }
          return Object.values(fixture.tasks).every((task) => {
            const dispatch = dispatchByTaskId(snapshot, task.id);
            return dispatch?.status === 'completed' && dispatch.taskRunState === 'COMPLETED';
          });
        },
        {
          timeoutMs: 75_000,
          intervalMs: 750,
          description: 'full sprint should reach terminal state with completed task dispatches',
        },
      );

      const finalSprintRun = completedSnapshot.sprintRuns.find((run) => run.sprintId === fixture.sprint.id);
      expect(finalSprintRun?.status).toBe('completed');
      expect(finalSprintRun?.finishedAt).toBeTruthy();

      const finalLowPriorityDispatch = requireDispatch(completedSnapshot, fixture.tasks.lowPriority);
      expect(isoTime(finalLowPriorityDispatch.startedAt)).toBeGreaterThanOrEqual(
        isoTime(requireDispatch(completedSnapshot, fixture.tasks.dependent).finishedAt),
      );

      const finalNoChangeDispatch = requireDispatch(completedSnapshot, fixture.tasks.noChange);
      expect(finalNoChangeDispatch.workerBranch).toBeNull();
      expect(finalNoChangeDispatch.prUrl).toBeNull();

      const finalTasks = await fetchTasksViaApi(request, fixture.project.id, fixture.sprint.id);
      const finalTaskById = new Map(finalTasks.map((task) => [task.id, task]));
      for (const task of Object.values(fixture.tasks)) {
        expect(finalTaskById.get(task.id)?.status, `${task.taskKey} should complete`).toBe('completed');
      }
      expect(finalTaskById.get(fixture.tasks.rootAlpha.id)?.isMerged).toBe(true);
      expect(finalTaskById.get(fixture.tasks.rootBeta.id)?.isMerged).toBe(true);
      expect(finalTaskById.get(fixture.tasks.dependent.id)?.isMerged).toBe(true);
      expect(finalTaskById.get(fixture.tasks.lowPriority.id)?.isMerged).toBe(true);
      expect(finalTaskById.get(fixture.tasks.noChange.id)?.isMerged).toBe(false);

      const { sprints } = await fetchSprintsViaApi(request, fixture.project.id);
      expect(sprints.find((sprint) => sprint.id === fixture.sprint.id)?.status).toBe('completed');

      const completedInvocations = await fetchProjectInvocations(request, fixture.project.id, {
        purpose: 'task_coding',
        status: 'completed',
        limit: '50',
      });
      const invocationTaskIds = new Set(completedInvocations
        .map((invocation) => invocation.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)));
      for (const task of Object.values(fixture.tasks)) {
        expect(invocationTaskIds.has(task.id), `${task.taskKey} should have a completed provider invocation`).toBe(true);
      }

      expect(completedSnapshot.taskDispatches.filter((dispatch) => ACTIVE_DISPATCH_STATUSES.has(dispatch.status))).toEqual([]);
      expect(completedSnapshot.sprintRuns.filter((run) => ACTIVE_SPRINT_RUN_STATUSES.has(run.status))).toEqual([]);
      expect((completedSnapshot.recentInvocations ?? []).filter((invocation) => ACTIVE_INVOCATION_STATUSES.has(invocation.status))).toEqual([]);
      const activeInvocations = [
        ...await fetchProjectInvocations(request, fixture.project.id, { status: 'running', limit: '20' }),
        ...await fetchProjectInvocations(request, fixture.project.id, { status: 'paused', limit: '20' }),
      ];
      expect(activeInvocations).toEqual([]);

      const alphaOutput = await fixture.repository.git(['show', 'main:e2e-output/root-alpha.txt']);
      const betaOutput = await fixture.repository.git(['show', 'main:e2e-output/root-beta.txt']);
      const dependentOutput = await fixture.repository.git(['show', 'main:e2e-output/dependent.txt']);
      const lowPriorityOutput = await fixture.repository.git(['show', 'main:e2e-output/low-priority.txt']);
      expect(alphaOutput).toContain('TASK T01 Root alpha write');
      expect(betaOutput).toContain('TASK T02 Root beta write');
      expect(dependentOutput).toContain('TASK T03 Dependent write after roots');
      expect(lowPriorityOutput).toContain('TASK T05 Low priority unlock write');
    } finally {
      await deleteProjectViaApi(request, fixture.project.id).catch(() => undefined);
      await fixture.repository.cleanup();
    }
  });
});
