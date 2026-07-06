import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  deleteSprint,
  deleteTask,
  ensureSelectedProject,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  selectSprintViaApi,
} from './helpers/prepare-app';

const DASHBOARD_TOUR_STORAGE_KEY = 'codeux:dashboard-tour-hidden:v1';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function hideDashboardTour(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, 'true');
  }, DASHBOARD_TOUR_STORAGE_KEY);
}

async function prepareApp(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<ProjectSummary> {
  await completeOnboarding(request);
  await hideDashboardTour(page);
  return ensureSelectedProject(request, { testInfo, fixtureKey });
}

async function expectProjectSelected(page: Page, projectName: string): Promise<void> {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();

  const selectedProjectText = await projectButton.innerText();
  if (selectedProjectText.includes(projectName)) {
    return;
  }

  await projectButton.click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(projectName)) }).first().click();
  await expect(projectButton).toContainText(projectName);
}

async function getSprintByName(page: Page, projectId: string, name: string): Promise<SprintRecord> {
  let matchingSprint: SprintRecord | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/sprints`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { sprints: SprintRecord[] };
    matchingSprint = body.sprints.find((sprint) => sprint.name === name) ?? null;
    return matchingSprint !== null;
  }).toBe(true);

  return matchingSprint;
}

async function getTaskByTitle(page: Page, projectId: string, title: string, sprintId?: string): Promise<TaskRecord> {
  let matchingTask: TaskRecord | null = null;
  await expect.poll(async () => {
    const query = sprintId ? `?sprintId=${encodeURIComponent(sprintId)}` : '';
    const response = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/tasks${query}`);
    expect(response.ok()).toBeTruthy();
    const tasks = await response.json() as TaskRecord[];
    matchingTask = tasks.find((task) => task.title === title) ?? null;
    return matchingTask !== null;
  }).toBe(true);

  return matchingTask;
}

async function expectSprintAbsent(page: Page, projectId: string, sprintId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/sprints`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { sprints: SprintRecord[] };
    return body.sprints.some((sprint) => sprint.id === sprintId);
  }).toBe(false);
}

async function expectTaskAbsent(page: Page, projectId: string, taskId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${encodeURIComponent(projectId)}/tasks`);
    expect(response.ok()).toBeTruthy();
    const tasks = await response.json() as TaskRecord[];
    return tasks.some((task) => task.id === taskId);
  }).toBe(false);
}

async function holdToConfirm(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) {
    throw new Error('Confirmation button was not visible.');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1250);
  await page.mouse.up();
}

async function activateButtonWithKeyboard(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await page.keyboard.press('Enter');
}

async function clickSprintMenuAction(page: Page, sprintName: string, action: 'Edit' | 'Delete'): Promise<void> {
  const menuButton = page.getByRole('button', { name: `Open actions menu for sprint ${sprintName}` }).last();
  const actionName = `${action} sprint ${sprintName}`;
  const actionLocator = page
    .getByRole('menuitem', { name: actionName })
    .or(page.getByRole('button', { name: actionName }))
    .last();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(actionLocator).toBeVisible({ timeout: 5_000 });

    try {
      await actionLocator.click({ timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }
}

test.describe('sprint and task lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: string | null = null;
  let sprintIdsForCleanup: string[] = [];
  let taskIdsForCleanup: string[] = [];

  test.beforeEach(() => {
    projectId = null;
    sprintIdsForCleanup = [];
    taskIdsForCleanup = [];
  });

  test.afterEach(async ({ request }) => {
    if (!projectId) {
      return;
    }

    for (const taskId of [...taskIdsForCleanup].reverse()) {
      await deleteTask(request, projectId, taskId);
    }

    for (const sprintId of [...sprintIdsForCleanup].reverse()) {
      await cleanupSprintFixture(request, projectId, sprintId);
    }
  });

  test('creates, edits, verifies, and deletes a draft sprint from the Sprints page', async ({ page, request }, testInfo) => {
    const project = await prepareApp(page, request, testInfo, 'sprint-lifecycle');
    projectId = project.id;

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'sprint-lifecycle' });
    const sprintName = `${prefix} draft sprint`;
    const editedSprintName = `${sprintName} edited`;
    const sprintGoal = 'Keep runtime state changes deterministic while exercising the draft composer.';

    await page.goto('/sprints');
    await expectProjectSelected(page, project.name);
    await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();

    await page.getByRole('button', { name: 'New Sprint' }).first().click();
    const composer = page.getByRole('form', { name: 'Sprint composer' });
    await expect(composer).toBeVisible();
    await composer.getByPlaceholder('Runtime hardening').fill(sprintName);
    await composer.getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.').fill(sprintGoal);
    await composer.getByRole('button', { name: /^Save Draft\b/ }).first().click();
    await activateButtonWithKeyboard(page, composer.getByRole('button', { name: 'Save Draft', exact: true }));

    const createdSprint = await getSprintByName(page, project.id, sprintName);
    sprintIdsForCleanup.push(createdSprint.id);
    expect(createdSprint.status).toBe('idle');
    expect(createdSprint.goal).toContain('deterministic');
    await expect(page.getByText(sprintName).first()).toBeVisible();

    await page.getByPlaceholder('Search sprints…').fill(sprintName);
    await clickSprintMenuAction(page, sprintName, 'Edit');
    await expect(composer).toBeVisible();
    await composer.getByPlaceholder('Runtime hardening').fill(editedSprintName);
    await composer.getByRole('button', { name: /^Save Changes\b/ }).first().click();
    await activateButtonWithKeyboard(page, composer.getByRole('button', { name: 'Save Changes', exact: true }));

    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project.id);
      return sprints.find((sprint) => sprint.id === createdSprint.id)?.name;
    }).toBe(editedSprintName);
    await page.getByPlaceholder('Search sprints…').fill(editedSprintName);
    await expect(page.getByText(editedSprintName).first()).toBeVisible();

    await clickSprintMenuAction(page, editedSprintName, 'Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete Sprint?' });
    await expect(dialog).toBeVisible();
    await holdToConfirm(page, dialog.getByRole('button', { name: 'Hold to Delete Sprint' }));

    await expectSprintAbsent(page, project.id, createdSprint.id);
    await expect(page.getByText(editedSprintName).first()).toBeHidden();
    sprintIdsForCleanup = sprintIdsForCleanup.filter((sprintId) => sprintId !== createdSprint.id);
  });

  test('creates, edits, verifies, and deletes an implementation task from the Tasks page', async ({ page, request }, testInfo) => {
    const project = await prepareApp(page, request, testInfo, 'task-lifecycle');
    projectId = project.id;
    const sprint = await createDraftSprint(request, project.id, {
      testInfo,
      fixtureKey: 'task-lifecycle',
      goal: 'Provide a draft sprint scope for task lifecycle browser coverage.',
    });
    sprintIdsForCleanup.push(sprint.id);
    await selectSprintViaApi(request, project.id, sprint.id);

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'task-lifecycle' });
    const taskTitle = `${prefix} implementation task`;
    const editedTaskTitle = `${taskTitle} edited`;
    const description = 'Exercise task metadata through the normal dashboard composer.';
    const promptMarkdown = 'Implement a deterministic UI-only task lifecycle path for E2E coverage.';

    await page.goto(`/tasks?sprintId=${encodeURIComponent(sprint.id)}`);
    await expectProjectSelected(page, project.name);
    await expect(page.getByRole('heading', { level: 1, name: 'Task Board' })).toBeVisible();

    await page.getByRole('button', { name: 'New Task' }).click();
    await expect(page.getByText('Task Composer')).toBeVisible();
    await page.getByPlaceholder('Fix navigation layout shift').fill(taskTitle);
    await page.getByPlaceholder('Summarize the intent and outcome.').fill(description);
    await page.getByPlaceholder('Detailed markdown instructions for the agent.').fill(promptMarkdown);
    await page.getByRole('button', { name: 'Create Task' }).click();

    const createdTask = await getTaskByTitle(page, project.id, taskTitle, sprint.id);
    taskIdsForCleanup.push(createdTask.id);
    await expect(page.getByRole('button', { name: `Edit task ${createdTask.taskKey}: ${taskTitle}` })).toBeVisible();
    expect(createdTask.promptMarkdown).toContain('deterministic');
    expect(createdTask.priority).toBe('medium');

    await activateButtonWithKeyboard(page, page.getByRole('button', { name: `Edit task ${createdTask.taskKey}: ${taskTitle}` }));
    await expect(page.getByText('Edit Task')).toBeVisible();
    await page.getByPlaceholder('Fix navigation layout shift').fill(editedTaskTitle);
    await page.getByRole('button', { name: 'high' }).click();
    await page.getByRole('button', { name: 'Save Task' }).click();

    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project.id, sprint.id);
      return tasks.find((task) => task.id === createdTask.id);
    }).toMatchObject({ title: editedTaskTitle, priority: 'high' });
    await expect(page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${editedTaskTitle}` })).toBeVisible();

    await activateButtonWithKeyboard(page, page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${editedTaskTitle}` }));
    const dialog = page.getByRole('dialog', { name: 'Delete Task' });
    await expect(dialog).toBeVisible();
    await holdToConfirm(page, dialog.getByRole('button', { name: 'Hold to Delete Task' }));

    await expectTaskAbsent(page, project.id, createdTask.id);
    await expect(page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${editedTaskTitle}` })).toHaveCount(0);
    taskIdsForCleanup = taskIdsForCleanup.filter((taskId) => taskId !== createdTask.id);
    await deleteSprint(request, project.id, sprint.id);
    sprintIdsForCleanup = sprintIdsForCleanup.filter((sprintId) => sprintId !== sprint.id);
  });
});
