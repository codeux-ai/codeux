import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FileBrowserSession,
  FileBrowserTree,
  FileBrowserTreeNode,
} from '../../../src/contracts/app-types.js';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createE2eFixturePrefix,
  createProjectViaApi,
  selectProjectViaApi,
  suppressDashboardTour,
} from '../helpers/prepare-app';
import { deleteProjectViaApi } from '../helpers/e2e-api';

async function prepareApp(page: Page, request: APIRequestContext): Promise<void> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  await page.addInitScript(() => {
    localStorage.setItem('codeux:sidebar:minimized', 'false');
  });
}

async function createSelectedFileBrowserProject(
  request: APIRequestContext,
  projectName: string,
): Promise<ProjectSummary> {
  const project = await createProjectViaApi(request, {
    name: projectName,
    sourceType: 'local',
    sourceRef: process.cwd(),
    status: 'idle',
    initMode: 'existing',
  });
  await selectProjectViaApi(request, project.id);
  return project;
}

function makeSession(project: ProjectSummary): FileBrowserSession {
  const now = new Date().toISOString();
  return {
    id: `fb-${project.id}`,
    projectId: project.id,
    sprintId: `sprint-${project.id}`,
    projectName: project.name,
    sprintName: 'E2E filesystem snapshot',
    sprintNumber: null,
    status: 'running',
    containerId: 'mocked-no-container',
    containerName: 'mocked-no-container',
    workspacePath: process.cwd(),
    featureBranch: 'e2e/file-browser',
    defaultBranch: 'main',
    lastCompletedTaskCount: 0,
    lastSeenSprintStatus: null,
    lastError: null,
    lastBuildAt: now,
    lastStartedAt: now,
    lastStoppedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function buildRepositoryTree(sessionId: string): Promise<FileBrowserTree> {
  const root = process.cwd();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const preferredEntries = ['package.json', 'src', 'dashboard']
    .map((entryName) => entries.find((entry) => entry.name === entryName))
    .filter((entry): entry is Awaited<ReturnType<typeof fs.readdir>>[number] => Boolean(entry));

  const nodes: FileBrowserTreeNode[] = preferredEntries.map((entry) => ({
    id: entry.name,
    name: entry.name,
    path: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
  }));
  nodes.push(
    { id: 'assets/logo.bin', name: 'logo.bin', path: 'assets/logo.bin', type: 'file' },
    { id: 'src/a/very/long/path/example.ts', name: 'example.ts', path: 'src/a/very/long/path/example.ts', type: 'file' },
  );

  return {
    sessionId,
    root: nodes,
    fileCount: nodes.filter((node) => node.type === 'file').length,
    truncated: false,
  };
}

async function mockFileBrowserSessionRoutes(
  page: Page,
  project: ProjectSummary,
  options: { treeStatus?: number } = {},
): Promise<{ session: FileBrowserSession; startRequests: () => number }> {
  const session = makeSession(project);
  const tree = await buildRepositoryTree(session.id);
  let startRequestCount = 0;

  await page.route(new RegExp(`/api/projects/${project.id}/file-browser/sessions$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([session]),
    });
  });

  await page.route(/\/api\/projects\/[^/]+\/sprints\/[^/]+\/file-browser\/start$/, async (route) => {
    startRequestCount += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'E2E test must not start file browser containers.' }),
    });
  });

  await page.route(new RegExp(`/api/file-browser/sessions/${session.id}/tree$`), async (route) => {
    if (options.treeStatus && options.treeStatus >= 400) {
      await route.fulfill({
        status: options.treeStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'E2E file tree unavailable' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tree),
    });
  });

  await page.route(new RegExp(`/api/file-browser/sessions/${session.id}/file\\?`), async (route) => {
    const filePath = new URL(route.request().url()).searchParams.get('path') ?? '';
    const binary = filePath === 'assets/logo.bin';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: filePath,
        content: binary ? '' : "export const repositoryText = 'unverändert';",
        encoding: binary ? 'binary' : 'utf8',
        size: binary ? 4096 : 47,
        truncated: false,
        binary,
        language: binary ? null : 'typescript',
      }),
    });
  });

  await page.route(new RegExp(`/api/file-browser/sessions/${session.id}/changes$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: session.id,
        available: true,
        files: [
          { path: 'src/modified.ts', oldPath: null, status: 'modified', additions: 4, deletions: 1 },
          { path: 'src/added.ts', oldPath: null, status: 'added', additions: 7, deletions: 0 },
          { path: 'src/deleted.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 3 },
        ],
        featureBranch: session.featureBranch,
        defaultBranch: session.defaultBranch,
        reason: null,
      }),
    });
  });

  await page.route(new RegExp(`/api/file-browser/sessions/${session.id}/diff\\?`), async (route) => {
    const filePath = new URL(route.request().url()).searchParams.get('path') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: filePath,
        oldPath: null,
        status: 'modified',
        original: "export const state = 'before';",
        modified: "export const state = 'after';",
        binary: false,
        language: 'typescript',
      }),
    });
  });

  return { session, startRequests: () => startRequestCount };
}

async function mockEmptyProjects(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [], selectedProjectId: null }),
    });
  });
}

test.describe('file browser page', () => {
  let createdProjectId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await prepareApp(page, request);
  });

  test.afterEach(async ({ request }) => {
    if (createdProjectId) {
      await deleteProjectViaApi(request, createdProjectId);
      createdProjectId = null;
    }
  });

  test('shows a clear empty state when no project is selected', async ({ page }) => {
    await mockEmptyProjects(page);

    await page.goto('/files');

    await expect(page.getByText(/Select a project to open the sprint file browser/)).toBeVisible();
  });

  test('renders real repository entries for the selected project without starting a container', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'file-browser' });
    const project = await createSelectedFileBrowserProject(request, `${prefix} files project`);
    createdProjectId = project.id;
    const routes = await mockFileBrowserSessionRoutes(page, project);

    await page.goto('/files');

    await expect(page.getByRole('heading', { name: 'Browse & Diff the Sprint Branch' })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Sprint file tree' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /File package\.json/ }).first()).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /Folder src/ }).first()).toBeVisible();
    await expect(page.getByTestId('file-browser-main-tool-panel').getByText(/\d+ files? in snapshot/)).toBeVisible();
    expect(routes.startRequests()).toBe(0);
  });

  test('surfaces file-tree load failures deliberately', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'file-browser-error' });
    const project = await createSelectedFileBrowserProject(request, `${prefix} files error project`);
    createdProjectId = project.id;
    const routes = await mockFileBrowserSessionRoutes(page, project, { treeStatus: 500 });

    await page.goto('/files');

    await expect(page.getByRole('alert').filter({ hasText: 'Failed to load file tree.' })).toBeVisible();
    await expect(page.getByText('Use Refresh or Rebuild to try again.')).toBeVisible();
    expect(routes.startRequests()).toBe(0);
  });

  test('localizes German file, binary, and change review chrome without changing repository data', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'file-browser-de' });
    const project = await createSelectedFileBrowserProject(request, `${prefix} files project`);
    createdProjectId = project.id;
    const routes = await mockFileBrowserSessionRoutes(page, project);
    await page.addInitScript(() => {
      localStorage.setItem('codeux.dashboard.locale.v1', 'de');
    });

    await page.goto('/files');

    await expect(page.getByRole('heading', { name: 'Sprint-Branch durchsuchen und vergleichen' })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Sprint-Dateibaum' })).toBeVisible();
    await page.getByRole('treeitem', { name: /Datei src\/a\/very\/long\/path\/example\.ts/ }).click();
    await expect(page.getByText("export const repositoryText = 'unverändert';")).toBeVisible();

    await page.getByRole('treeitem', { name: /Datei assets\/logo\.bin/ }).click();
    await expect(page.getByText('Binärdatei erkannt')).toBeVisible();

    await page.getByRole('tab', { name: /Änderungen/ }).click();
    const changedFiles = page.getByRole('listbox', { name: 'Geänderte Dateien' });
    await expect(changedFiles.getByRole('option', { name: /Geändert: Datei src\/modified\.ts/ })).toBeVisible();
    await expect(changedFiles.getByRole('option', { name: /Hinzugefügt: Datei src\/added\.ts/ })).toBeVisible();
    await expect(changedFiles.getByRole('option', { name: /Gelöscht: Datei src\/deleted\.ts/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Vergleich für src/modified.ts' })).toBeVisible();
    await expect(page.getByText('e2e/file-browser')).toBeVisible();
    expect(routes.startRequests()).toBe(0);
  });
});
