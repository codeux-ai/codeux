import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {
  CreateSprintInput,
  CreateTaskInput,
  ProjectSummary,
  SprintRecord,
  TaskRecord,
  UpdateSprintInput,
  UpdateTaskInput,
} from '../../../src/contracts/project-management-types.js';
import {
  completeOnboardingViaApi,
  createProjectViaApi,
  createSprintViaApi,
  createTaskViaApi,
  deleteProjectViaApi,
  deleteSprintViaApi,
  deleteTaskViaApi,
  fetchProjectsViaApi,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  selectProjectViaApi,
  selectSprintViaApi,
  updateSprintViaApi,
  updateTaskViaApi,
} from './e2e-api';

export {
  completeOnboardingViaApi,
  createProjectViaApi,
  createSprintViaApi,
  createTaskViaApi,
  deleteProjectViaApi,
  deleteSprintViaApi,
  deleteTaskViaApi,
  fetchProjectsViaApi,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  selectProjectViaApi,
  selectSprintViaApi,
  updateSprintViaApi,
  updateTaskViaApi,
};

export interface E2eFixtureOptions {
  testInfo?: Pick<TestInfo, 'workerIndex' | 'repeatEachIndex' | 'retry'>;
  fixtureKey?: string;
}

export interface E2eProjectFixture extends E2eFixtureOptions {
  name?: string;
}

export interface E2eSprintFixture extends E2eFixtureOptions {
  name?: string;
  goal?: string;
  input?: Omit<CreateSprintInput, 'name' | 'goal'>;
  select?: boolean;
}

export interface E2eTaskFixture extends E2eFixtureOptions {
  title?: string;
  promptMarkdown?: string;
  input?: Omit<CreateTaskInput, 'sprintId' | 'title' | 'promptMarkdown'>;
}

export interface IsolatedDashboardRuntime {
  baseUrl: string;
  dbPath: string;
  homeDirectory: string;
  stop: () => Promise<void>;
}

const RUN_SUFFIX = (process.env.CODEUX_E2E_RUN_ID || new Date().toISOString())
  .replace(/[^a-zA-Z0-9]+/g, '')
  .slice(0, 20)
  .toLowerCase();
const DASHBOARD_TOUR_STORAGE_KEY = 'codeux:dashboard-tour-hidden:v1';

async function canBindPort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function findDashboardPortPair(): Promise<number> {
  for (let port = 4700; port < 4900; port += 2) {
    if (await canBindPort(port) && await canBindPort(port + 1)) {
      return port;
    }
  }
  throw new Error('No available isolated E2E dashboard/MCP port pair found in 4700-4900.');
}

async function waitForRuntimeHealth(
  child: ChildProcess,
  baseUrl: string,
  readOutput: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Isolated dashboard runtime exited before becoming healthy.\n${readOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The listener is expected to reject connections while the runtime boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for isolated dashboard runtime health.\n${readOutput()}`);
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (graceful) return;
  child.kill('SIGKILL');
  await exited;
}

export async function startUnavailableCredentialDashboardRuntime(): Promise<IsolatedDashboardRuntime> {
  const dashboardPort = await findDashboardPortPair();
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codeux-e2e-unavailable-credentials-'));
  const baseUrl = `http://127.0.0.1:${dashboardPort}`;
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    XDG_CONFIG_HOME: path.join(homeDirectory, '.config'),
    XDG_DATA_HOME: path.join(homeDirectory, '.local', 'share'),
    CODE_UX_DIRECTORY_BROWSER_ROOTS: os.tmpdir(),
    CODEUX_E2E_PROVIDER_CLI_SHIM: process.env.CODEUX_E2E_PROVIDER_CLI_SHIM
      ?? path.resolve(process.cwd(), 'scripts/e2e/mock-provider-cli.mjs'),
    CODE_UX_CREDENTIAL_KEY_PROVIDER: 'mounted-key-file',
    DASHBOARD_PORT: String(dashboardPort),
    MCP_HTTP_PORT: String(dashboardPort + 1),
    CODE_UX_DISABLE_MCP_STDIO: '1',
    MCP_HTTP_ENABLED: 'false',
    CODE_UX_CONTAINERIZED_GIT: '0',
    CODE_UX_GIT_CONTAINER_MODE: 'host',
  };
  delete childEnvironment.CODE_UX_CREDENTIAL_KEY_FILE;
  delete childEnvironment.VITEST_IN_MEMORY_DB;

  const child = spawn(process.execPath, [path.resolve(process.cwd(), 'dist/index.js')], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-16_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  try {
    await waitForRuntimeHealth(child, baseUrl, () => output);
  } catch (error) {
    await stopChildProcess(child);
    await fs.rm(homeDirectory, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }

  let stopped = false;
  return {
    baseUrl,
    dbPath: path.join(homeDirectory, '.code-ux', 'app.db'),
    homeDirectory,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopChildProcess(child);
      await fs.rm(homeDirectory, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

function sanitizeFixtureKey(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return sanitized || 'fixture';
}

export function createE2eFixturePrefix(options: E2eFixtureOptions = {}): string {
  const workerIndex = options.testInfo?.workerIndex ?? 0;
  const repeatIndex = options.testInfo?.repeatEachIndex ?? 0;
  const retry = options.testInfo?.retry ?? 0;
  const key = sanitizeFixtureKey(options.fixtureKey ?? 'app');
  return `e2e-w${workerIndex}-r${repeatIndex}-try${retry}-${RUN_SUFFIX}-${key}`;
}

function displayName(base: string, options: E2eFixtureOptions = {}): string {
  const workerIndex = options.testInfo?.workerIndex ?? 0;
  const key = sanitizeFixtureKey(options.fixtureKey ?? 'app');
  return `${base} w${workerIndex} ${key} ${RUN_SUFFIX.slice(-6)}`;
}

async function ensureFixtureDirectory(prefix: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), 'codeux-e2e-projects', prefix);
  await fs.mkdir(projectDir, { recursive: true });
  return projectDir;
}

// A freshly-checked-out server starts with the first-run onboarding overlay
// open. This drives the same API the dashboard uses so pages load without the
// overlay intercepting pointer events.
export async function completeOnboarding(request: APIRequestContext): Promise<void> {
  await completeOnboardingViaApi(request);
}

export async function suppressDashboardTour(page: Page): Promise<void> {
  await page.addInitScript((tourStorageKey) => {
    localStorage.setItem(tourStorageKey, 'true');
  }, DASHBOARD_TOUR_STORAGE_KEY);

  await page.evaluate((tourStorageKey) => {
    localStorage.setItem(tourStorageKey, 'true');
  }, DASHBOARD_TOUR_STORAGE_KEY).catch(() => undefined);
}

export async function createOrFindIsolatedLocalProject(
  request: APIRequestContext,
  options: E2eProjectFixture = {},
): Promise<ProjectSummary> {
  const prefix = createE2eFixturePrefix(options);
  const sourceRef = await ensureFixtureDirectory(prefix);
  const name = options.name ?? displayName('E2E Project', options);
  const projects = await fetchProjectsViaApi(request);
  const existing = projects.projects.find((project) => project.sourceType === 'local' && (
    project.sourceRef === sourceRef || project.baseDir === sourceRef || project.name === name
  ));

  if (existing) {
    return existing;
  }

  return createProjectViaApi(request, {
    name,
    sourceType: 'local',
    sourceRef,
    status: 'idle',
    initMode: 'existing',
  });
}

export async function selectProject(request: APIRequestContext, projectId: string): Promise<string | null> {
  return selectProjectViaApi(request, projectId);
}

// Ensures the server has an isolated local project and selects it. The selected
// project is global app state, so tests that need a specific project should call
// this immediately before loading the page under test.
export async function ensureSelectedProject(
  request: APIRequestContext,
  options: E2eProjectFixture = {},
): Promise<ProjectSummary> {
  const project = await createOrFindIsolatedLocalProject(request, options);
  await selectProjectViaApi(request, project.id);
  return project;
}

export async function createDraftSprint(
  request: APIRequestContext,
  projectId: string,
  options: E2eSprintFixture = {},
): Promise<SprintRecord> {
  const name = options.name ?? displayName('E2E Sprint', options);
  const sprints = await fetchSprintsViaApi(request, projectId);
  const existing = sprints.sprints.find((sprint) => sprint.name === name);
  const sprint = existing ?? await createSprintViaApi(request, projectId, {
    name,
    goal: options.goal ?? 'Verify the Code UX dashboard with isolated E2E fixture data.',
    status: 'idle',
    showcasePinned: false,
    ...options.input,
  });

  if (options.select ?? true) {
    await selectSprintViaApi(request, projectId, sprint.id);
  }

  return sprint;
}

export async function createTaskInSprint(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
  options: E2eTaskFixture = {},
): Promise<TaskRecord> {
  const title = options.title ?? displayName('E2E Task', options);
  const tasks = await fetchTasksViaApi(request, projectId, sprintId);
  const existing = tasks.find((task) => task.title === title);

  if (existing) {
    return existing;
  }

  return createTaskViaApi(request, projectId, {
    sprintId,
    title,
    promptMarkdown: options.promptMarkdown ?? 'Use this draft task as deterministic E2E fixture data.',
    status: 'pending',
    priority: 'medium',
    executorType: 'auto',
    ...options.input,
  });
}

export async function updateSprintFields(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
  input: UpdateSprintInput,
): Promise<SprintRecord> {
  return updateSprintViaApi(request, sprintId, { ...input, projectId });
}

export async function updateTaskFields(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskRecord> {
  return updateTaskViaApi(request, taskId, { ...input, projectId });
}

export async function deleteTask(request: APIRequestContext, projectId: string, taskId: string): Promise<void> {
  await deleteTaskViaApi(request, taskId, projectId);
}

export async function deleteSprint(request: APIRequestContext, projectId: string, sprintId: string): Promise<void> {
  await deleteSprintViaApi(request, sprintId, projectId);
}

export async function cleanupSprintFixture(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
): Promise<void> {
  const tasks = await fetchTasksViaApi(request, projectId, sprintId);
  await Promise.all(tasks.map((task) => deleteTask(request, projectId, task.id)));
  await deleteSprint(request, projectId, sprintId);
}

export async function createE2EAgentPreset(
  request: APIRequestContext,
  projectId: string,
  options: { name?: string } = {},
): Promise<{ id: string; name: string }> {
  const name = options.name ?? `E2E Avatar Agent ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(`/api/projects/${projectId}/agent-presets`, {
    data: {
      name,
      description: 'E2E avatar rendering fixture',
      instructionMarkdown: '',
      labels: ['e2e'],
      avatarConfig: {
        chassis: 'classic',
        eyes: 'smile',
        antenna: 'jewel',
        wings: 'none',
        headphones: 'bumper',
        accent: 'jade',
        baseColor: 'pearl',
      },
    },
  });

  if (!created.ok()) {
    throw new Error(`Failed to create E2E agent preset: ${created.status()} ${await created.text()}`);
  }

  const body = (await created.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}
