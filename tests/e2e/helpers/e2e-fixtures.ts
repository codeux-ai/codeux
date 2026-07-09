import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CreateSprintInput,
  CreateTaskInput,
  ProjectSummary,
  SprintRecord,
  TaskRecord,
} from '../../../src/contracts/project-management-types.js';
import type { ProjectSettingsOverride } from '../../../src/contracts/settings-scope-types.js';
import { DEFAULT_DASHBOARD_SETTINGS } from '../../../src/repositories/settings-defaults.js';
import {
  completeOnboardingViaApi,
  createProjectViaApi,
  createSprintViaApi,
  createTaskViaApi,
  deleteProjectViaApi,
  selectProjectViaApi,
  selectSprintViaApi,
} from './e2e-api';
import {
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  createTaskInSprint,
  ensureSelectedProject,
} from './prepare-app';

export {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  createE2EAgentPreset,
  createE2eFixturePrefix,
  createOrFindIsolatedLocalProject,
  createTaskInSprint,
  deleteSprint,
  deleteTask,
  ensureSelectedProject,
  fetchProjectsViaApi,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  selectProject,
  updateSprintFields,
  updateTaskFields,
} from './prepare-app';

const execFileAsync = promisify(execFile);
const DASHBOARD_TOUR_STORAGE_KEY = 'codeux:dashboard-tour-hidden:v1';

export interface TemporaryGitRepository {
  root: string;
  cleanup: () => Promise<void>;
  git: (args: string[]) => Promise<string>;
  writeFile: (relativePath: string, contents: string) => Promise<void>;
}

export interface SeededCodeUxProject {
  project: ProjectSummary;
  repository: TemporaryGitRepository;
  cleanup: () => Promise<void>;
}

export interface SeededCodeUxProjectOptions {
  testInfo?: Pick<TestInfo, 'workerIndex' | 'repeatEachIndex' | 'retry'>;
  fixtureKey?: string;
  name?: string;
  configureForLocalHostExecution?: boolean;
}

export interface CreateSprintWithTasksOptions {
  sprint?: Omit<CreateSprintInput, 'name' | 'goal'> & {
    name?: string;
    goal?: string;
  };
  tasks?: Array<Omit<CreateTaskInput, 'sprintId' | 'title' | 'promptMarkdown'> & {
    title: string;
    promptMarkdown?: string;
  }>;
  select?: boolean;
}

export interface PollApiConditionOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath.trim() || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    throw new Error(`Unsafe relative path for E2E fixture: ${relativePath}`);
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd });
    return result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E2E git command failed in ${cwd}: git ${args.join(' ')}\n${message}`);
  }
}

async function removeDirectory(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
}

export async function createTemporaryGitRepository(
  options: { prefix?: string; files?: Record<string, string> } = {},
): Promise<TemporaryGitRepository> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${options.prefix ?? 'codeux-e2e-repo'}-`));
  const writeFixtureFile = async (relativePath: string, contents: string): Promise<void> => {
    assertSafeRelativePath(relativePath);
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  };

  await writeFixtureFile('README.md', '# Code UX E2E Fixture\n');
  for (const [relativePath, contents] of Object.entries(options.files ?? {})) {
    await writeFixtureFile(relativePath, contents);
  }

  await runGit(root, ['init']);
  await runGit(root, ['checkout', '-B', 'main']);
  await runGit(root, ['config', 'user.name', 'Code UX E2E']);
  await runGit(root, ['config', 'user.email', 'e2e@example.invalid']);
  await runGit(root, ['add', '.']);
  await runGit(root, ['commit', '-m', 'Initial E2E fixture']);

  return {
    root,
    cleanup: () => removeDirectory(root),
    git: (args: string[]) => runGit(root, args),
    writeFile: writeFixtureFile,
  };
}

export function buildLocalHostExecutionSettingsOverride(): ProjectSettingsOverride {
  const routeProvider = (): { enabled: boolean; model: string; weight: number } => ({
    enabled: true,
    model: 'default',
    weight: 100,
  });
  const workerRoute = () => ({
    profile: 'WORKER' as const,
    strategy: 'MANUAL' as const,
    provider: 'codex',
    allowedProviders: ['codex'],
    providers: { codex: routeProvider() },
  });

  return {
    git: {
      ...DEFAULT_DASHBOARD_SETTINGS.git,
      githubMode: 'LOCAL',
      autoCreatePr: false,
      autoCloseLinkedIssues: false,
      deleteMergedBranches: true,
      defaultBranch: 'main',
      featureBranchPrefix: 'e2e/',
      gitlabToken: DEFAULT_DASHBOARD_SETTINGS.git.gitlabToken ?? '',
    },
    ciIntelligence: {
      ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
      enabled: false,
      enableLivePrMonitoring: false,
      resolveAllCommentsBeforeMainMerge: false,
      resolveMainMergeConflicts: false,
      resolveMainMergeFailedChecks: false,
      resolveAllCommentsBeforeFeatureMerge: false,
      resolveMergeConflicts: false,
      waitForJulesCiAutofix: false,
      featurePrAutoMergeMode: 'OFF',
      mainBranchAutoMergeMode: 'OFF',
    },
    cliWorkflow: {
      ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
      executionMode: 'HOST',
      gitMode: 'local',
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: true,
      containerInstallPlaywrightBrowsers: false,
    },
    sprintPreview: {
      ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview,
      enabled: false,
      autoStartOnRunningSprint: false,
      rebuildOnTaskCompletion: false,
      rebuildOnSprintCompletion: false,
    },
    aiProvider: {
      ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
      provider: 'codex',
      strategy: 'MANUAL',
      providers: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
        jules: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules, enabled: false },
        codex: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex,
          name: 'E2E Codex Shim',
          enabled: true,
          model: 'default',
          weight: 100,
          thinkingMode: 'MEDIUM',
          maxConcurrentTasks: 4,
        },
      },
      invocationRouting: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting,
        task_coding: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting.task_coding,
          profile: 'GLOBAL',
          strategy: 'MANUAL',
          provider: 'codex',
          allowedProviders: ['codex'],
          providers: { codex: routeProvider() },
        },
        planning: workerRoute(),
        ci_fix: workerRoute(),
        merge_conflict: workerRoute(),
      },
    },
    workers: {
      ...DEFAULT_DASHBOARD_SETTINGS.workers,
      virtualWorkerProvider: 'codex',
      model: 'default',
      maxConcurrency: 4,
      timeoutSeconds: 120,
    },
    agents: {
      ...DEFAULT_DASHBOARD_SETTINGS.agents,
      qualityAssurance: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
        enabled: false,
        maxTaskReviewRuns: 0,
        maxSprintReviewRuns: 0,
        taskCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion, enabled: false },
        sprintCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion, enabled: false },
        completedTaskWithoutPr: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr, enabled: false },
      },
      selfReflection: {
        planning: { ...DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.planning, enabled: false },
        qualityAssurance: { ...DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance, enabled: false },
      },
    },
  };
}

export async function configureProjectForLocalHostExecution(
  request: APIRequestContext,
  projectId: string,
  overrides: ProjectSettingsOverride = {},
): Promise<ProjectSettingsOverride> {
  const settings = {
    ...buildLocalHostExecutionSettingsOverride(),
    ...overrides,
  } satisfies ProjectSettingsOverride;
  const response = await request.put(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    headers: { 'Content-Type': 'application/json' },
    data: settings,
  });

  if (!response.ok()) {
    throw new Error(`Failed to configure E2E project settings: ${response.status()} ${await response.text()}`);
  }

  return await response.json() as ProjectSettingsOverride;
}

export async function seedSelectedCodeUxProject(
  request: APIRequestContext,
  options: SeededCodeUxProjectOptions = {},
): Promise<SeededCodeUxProject> {
  await completeOnboardingViaApi(request);
  const prefix = createE2eFixturePrefix({ testInfo: options.testInfo, fixtureKey: options.fixtureKey ?? 'git-project' });
  const repository = await createTemporaryGitRepository({ prefix });
  const project = await createProjectViaApi(request, {
    name: options.name ?? `E2E Git Project ${prefix.slice(-8)}`,
    sourceType: 'local',
    sourceRef: repository.root,
    status: 'idle',
    initMode: 'existing',
    defaultBranch: 'main',
    featureBranchPrefix: 'e2e/',
  });

  if (options.configureForLocalHostExecution ?? true) {
    await configureProjectForLocalHostExecution(request, project.id);
  }

  await selectProjectViaApi(request, project.id);

  return {
    project,
    repository,
    cleanup: async () => {
      await deleteProjectViaApi(request, project.id);
      await repository.cleanup();
    },
  };
}

export async function createSprintWithTasks(
  request: APIRequestContext,
  projectId: string,
  options: CreateSprintWithTasksOptions = {},
): Promise<{ sprint: SprintRecord; tasks: TaskRecord[] }> {
  const sprint = await createSprintViaApi(request, projectId, {
    name: options.sprint?.name ?? 'E2E deterministic sprint',
    goal: options.sprint?.goal ?? 'Run deterministic local E2E fixture work.',
    status: 'idle',
    showcasePinned: false,
    ...options.sprint,
  });

  if (options.select ?? true) {
    await selectSprintViaApi(request, projectId, sprint.id);
  }

  const tasks: TaskRecord[] = [];
  for (const task of options.tasks ?? []) {
    tasks.push(await createTaskViaApi(request, projectId, {
      sprintId: sprint.id,
      promptMarkdown: task.promptMarkdown ?? 'Use the deterministic mock provider for this E2E task.',
      status: 'pending',
      priority: 'medium',
      executorType: 'auto',
      ...task,
    }));
  }

  return { sprint, tasks };
}

export async function pollApiCondition<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollApiConditionOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;

  while (Date.now() <= deadline) {
    lastValue = await read();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(`Timed out waiting for E2E API condition${options.description ? `: ${options.description}` : ''}. Last value: ${JSON.stringify(lastValue)}`);
}

export async function hideOnboardingAndTours(
  page: Page,
  request?: APIRequestContext,
): Promise<void> {
  if (request) {
    await completeOnboarding(request);
  }

  await page.addInitScript((tourStorageKey) => {
    localStorage.setItem(tourStorageKey, 'true');
    localStorage.setItem('codeux:sidebar:minimized', 'false');
  }, DASHBOARD_TOUR_STORAGE_KEY);

  await page.evaluate((tourStorageKey) => {
    localStorage.setItem(tourStorageKey, 'true');
    localStorage.setItem('codeux:sidebar:minimized', 'false');
  }, DASHBOARD_TOUR_STORAGE_KEY).catch(() => undefined);
}

export async function prepareSelectedLocalProject(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<ProjectSummary> {
  await hideOnboardingAndTours(page, request);
  return ensureSelectedProject(request, { testInfo, fixtureKey });
}

export async function prepareSelectedLocalGitProject(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<SeededCodeUxProject> {
  await hideOnboardingAndTours(page, request);
  return seedSelectedCodeUxProject(request, { testInfo, fixtureKey });
}

export async function createDraftSprintWithTask(
  request: APIRequestContext,
  projectId: string,
  options: {
    sprintName?: string;
    taskTitle?: string;
    promptMarkdown?: string;
    testInfo?: Pick<TestInfo, 'workerIndex' | 'repeatEachIndex' | 'retry'>;
    fixtureKey?: string;
  } = {},
): Promise<{ sprint: SprintRecord; task: TaskRecord }> {
  const sprint = await createDraftSprint(request, projectId, {
    name: options.sprintName,
    testInfo: options.testInfo,
    fixtureKey: options.fixtureKey,
  });
  const task = await createTaskInSprint(request, projectId, sprint.id, {
    title: options.taskTitle,
    promptMarkdown: options.promptMarkdown ?? 'Use deterministic E2E fixture task instructions.',
    testInfo: options.testInfo,
    fixtureKey: options.fixtureKey,
  });
  return { sprint, task };
}
