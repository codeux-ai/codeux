import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../src/contracts/project-management-types.js';
import {
  createE2eFixturePrefix,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  prepareSelectedLocalGitProject,
  type SeededCodeUxProject,
} from './helpers/e2e-fixtures';

type RouteCase = {
  path: string;
  landmark: (page: Page) => Locator;
};

const routeCases: RouteCase[] = [
  { path: '/', landmark: (page) => page.getByRole('heading', { name: 'Overview' }) },
  { path: '/projects', landmark: (page) => page.getByRole('heading', { name: 'Manage Projects' }) },
  { path: '/sprints', landmark: (page) => page.getByRole('region', { name: 'Sprint Ledger' }) },
  { path: '/tasks', landmark: (page) => page.getByRole('heading', { name: 'Task Board', exact: true }) },
  { path: '/agents', landmark: (page) => page.getByRole('region', { name: 'Agents' }) },
  { path: '/stats', landmark: (page) => page.getByRole('region', { name: 'Statistics' }) },
  { path: '/scheduler', landmark: (page) => page.getByTestId('scheduler-page-root') },
  { path: '/config', landmark: (page) => page.getByRole('heading', { name: 'Settings & Integration' }) },
  { path: '/memory', landmark: (page) => page.getByRole('heading', { name: 'Memory Map' }) },
  { path: '/browser', landmark: (page) => page.getByTestId('browser-page-root') },
  { path: '/files', landmark: (page) => page.getByTestId('file-browser-page-root') },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function installPageErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function expectNoPageErrors(errors: string[]): Promise<void> {
  expect(errors, errors.join('\n')).toEqual([]);
}

async function expectNoPersistentLoading(page: Page): Promise<void> {
  await expect(page.getByText(/loading dashboard|loading workspace|loading projects/i)).toHaveCount(0);
}

async function prepareWorkflowProject(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<SeededCodeUxProject> {
  return prepareSelectedLocalGitProject(page, request, testInfo, fixtureKey);
}

async function selectProjectFromDashboard(page: Page, project: ProjectSummary): Promise<void> {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();
  await projectButton.click();

  const projectList = page.getByRole('listbox', { name: 'Project list' });
  await expect(projectList).toBeVisible();
  await page.getByLabel('Filter projects').fill(project.name);

  const option = page.getByRole('option', { name: new RegExp(escapeRegExp(project.name)) });
  await expect(option).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes(`/api/projects/${encodeURIComponent(project.id)}/select`)
      && response.status() === 200
    )),
    option.click(),
  ]);

  await expect(projectButton).toContainText(project.name);
}

async function createDraftSprintFromUi(
  page: Page,
  project: ProjectSummary,
  name: string,
  goal: string,
): Promise<SprintRecord> {
  await page.goto('/sprints');
  await selectProjectFromDashboard(page, project);
  await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();
  await page.getByRole('button', { name: 'New Sprint' }).first().click();

  const composer = page.getByRole('form', { name: 'Sprint composer' });
  await expect(composer).toBeVisible();
  await composer.getByPlaceholder('Runtime hardening').fill(name);
  await composer
    .getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.')
    .fill(goal);
  const draftModeButton = composer
    .locator('button[type="button"]')
    .filter({ hasText: /^Save Draft/ })
    .first();
  await draftModeButton.click();
  const submitButton = composer.locator('button[type="submit"]').filter({ hasText: 'Save Draft' });
  await expect(submitButton).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && candidate.url().includes(`/api/projects/${encodeURIComponent(project.id)}/sprints`)
      && candidate.status() === 201
    )),
    submitButton.click(),
  ]);

  const sprint = await response.json() as SprintRecord;
  await expect(page.getByText(name).first()).toBeVisible();
  return sprint;
}

async function createTaskFromUi(
  page: Page,
  project: ProjectSummary,
  sprintId: string,
  input: {
    title: string;
    description: string;
    promptMarkdown: string;
    dependsOnTitle?: string;
  },
): Promise<TaskRecord> {
  await page.goto(`/tasks?sprintId=${encodeURIComponent(sprintId)}`);
  await selectProjectFromDashboard(page, project);
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Task' }).click();

  const composer = page.locator('form').filter({ hasText: /Task Composer|Create task/i });
  await expect(composer).toBeVisible();
  await composer.getByPlaceholder('Fix navigation layout shift').fill(input.title);
  await composer.getByPlaceholder('Summarize the intent and outcome.').fill(input.description);
  await composer.getByPlaceholder(/Detailed markdown instructions for the .*agent\./).fill(input.promptMarkdown);

  if (input.dependsOnTitle) {
    const dependencyButton = composer.getByRole('button', { name: new RegExp(escapeRegExp(input.dependsOnTitle)) });
    await expect(dependencyButton).toBeVisible();
    await dependencyButton.click();
    await expect(dependencyButton).toHaveAttribute('aria-pressed', 'true');
  }

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && candidate.url().includes(`/api/projects/${encodeURIComponent(project.id)}/tasks`)
      && candidate.status() === 201
    )),
    composer.getByRole('button', { name: 'Create Task' }).click(),
  ]);

  return await response.json() as TaskRecord;
}

test.describe('dashboard workflows before orchestration', () => {
  let fixture: SeededCodeUxProject | null = null;

  test.afterEach(async () => {
    await fixture?.cleanup();
    fixture = null;
  });

  test('selects an isolated project, creates a draft sprint, and creates dependent tasks', async ({ page, request }, testInfo) => {
    const errors = installPageErrorCapture(page);
    fixture = await prepareWorkflowProject(page, request, testInfo, 'dashboard-workflow');
    const { project } = fixture;
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'dashboard-workflow' });
    const sprintName = `${prefix} dashboard draft sprint`;
    const sprintGoal = 'Validate pre-orchestration dashboard workflow coverage without planning or provider execution.';
    const firstTaskTitle = `${prefix} foundation task`;
    const secondTaskTitle = `${prefix} dependent task`;

    await page.goto('/');
    await selectProjectFromDashboard(page, project);

    const sprint = await createDraftSprintFromUi(page, project, sprintName, sprintGoal);
    expect(sprint.status).toBe('idle');
    expect(sprint.goal).toContain('pre-orchestration');

    const firstTask = await createTaskFromUi(page, project, sprint.id, {
      title: firstTaskTitle,
      description: 'Create deterministic setup coverage for the workflow.',
      promptMarkdown: 'Keep this task in draft/pending state for dashboard workflow E2E coverage.',
    });
    const secondTask = await createTaskFromUi(page, project, sprint.id, {
      title: secondTaskTitle,
      description: 'Depend on the foundation task while staying pending.',
      promptMarkdown: 'Verify visible dependency controls without launching provider execution.',
      dependsOnTitle: firstTaskTitle,
    });

    await expect(page.getByRole('region', { name: /Queued 2 tasks/i })).toBeVisible();
    await expect(page.getByLabel(new RegExp(`Task ${escapeRegExp(firstTask.taskKey)}: ${escapeRegExp(firstTaskTitle)}\\. Status queued`, 'i'))).toBeVisible();
    await expect(page.getByLabel(new RegExp(`Task ${escapeRegExp(secondTask.taskKey)}: ${escapeRegExp(secondTaskTitle)}\\. Status queued`, 'i'))).toBeVisible();
    await expect(page.getByText(/1 dependency blocker/i).first()).toBeVisible();

    const { sprints } = await fetchSprintsViaApi(request, project.id);
    expect(sprints.find((candidate) => candidate.id === sprint.id)).toMatchObject({
      name: sprintName,
      status: 'idle',
    });

    const tasks = await fetchTasksViaApi(request, project.id, sprint.id);
    expect(tasks.find((candidate) => candidate.id === firstTask.id)).toMatchObject({
      title: firstTaskTitle,
      status: 'pending',
      dependsOnTaskIds: [],
    });
    expect(tasks.find((candidate) => candidate.id === secondTask.id)).toMatchObject({
      title: secondTaskTitle,
      status: 'pending',
      dependsOnTaskIds: [firstTask.id],
    });
    await expectNoPageErrors(errors);
  });

  test('core routes render stable landmarks without unhandled page errors', async ({ page, request }, testInfo) => {
    const errors = installPageErrorCapture(page);
    fixture = await prepareWorkflowProject(page, request, testInfo, 'dashboard-routes');

    for (const route of routeCases) {
      await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/$' : `${escapeRegExp(route.path)}$`}`));
      await selectProjectFromDashboard(page, fixture.project);
      await expect(route.landmark(page)).toBeVisible();
      await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(fixture.project.name);
      await expectNoPersistentLoading(page);
      await expectNoPageErrors(errors);
    }
  });
});
