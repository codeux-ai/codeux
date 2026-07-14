import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  deleteTask,
  ensureSelectedProject,
  fetchTasksViaApi,
  suppressDashboardTour,
} from '../helpers/prepare-app';

async function prepareTaskCrudApp(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
): Promise<{ project: ProjectSummary; sprint: SprintRecord }> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'task-crud' });
  const sprint = await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'task-crud',
    goal: 'Provide sprint scope for task CRUD browser coverage.',
  });
  return { project, sprint };
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

async function openTaskActionMenu(page: Page, taskKey: string, title: string): Promise<Locator> {
  const trigger = page.getByRole('button', { name: `Open task actions for task ${taskKey}: ${title}` });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: `Actions for task ${taskKey}: ${title}` });
  await expect(menu).toBeVisible();
  return menu;
}

async function expectTaskInProject(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
): Promise<TaskRecord | undefined> {
  const tasks = await fetchTasksViaApi(request, projectId);
  return tasks.find((task) => task.id === taskId);
}

test.describe('task CRUD from the Tasks page', () => {
  let project: ProjectSummary | null = null;
  let sprint: SprintRecord | null = null;
  let taskIdForCleanup: string | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    const fixture = await prepareTaskCrudApp(page, request, testInfo);
    project = fixture.project;
    sprint = fixture.sprint;
    taskIdForCleanup = null;
  });

  test.afterEach(async ({ request }) => {
    if (!project || !sprint) {
      return;
    }

    if (taskIdForCleanup) {
      await deleteTask(request, project.id, taskIdForCleanup);
      taskIdForCleanup = null;
    }

    await cleanupSprintFixture(request, project.id, sprint.id);
    project = null;
    sprint = null;
  });

  test('adds and deletes a task through the board composer and REST collection', async ({ page, request }, testInfo) => {
    if (!project || !sprint) {
      throw new Error('Task CRUD fixture was not initialized.');
    }

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'task-crud' });
    const title = `${prefix} board task`;
    const description = 'Create a deterministic task through the task board composer.';
    const promptMarkdown = 'Verify task CRUD without dispatching AI planning or Docker workers.';

    await page.goto(`/tasks?projectId=${encodeURIComponent(project.id)}&sprintId=${encodeURIComponent(sprint.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();

    await page.getByRole('button', { name: 'New Task' }).click();
    await expect(page.getByText('Task Composer')).toBeVisible();
    await page.getByPlaceholder('Fix navigation layout shift').fill(title);
    await page.getByPlaceholder('Summarize the intent and outcome.').fill(description);
    await page.getByPlaceholder('Detailed markdown instructions for the worker agent.').fill(promptMarkdown);

    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/projects/${encodeURIComponent(project!.id)}/tasks`)
        && response.status() === 201
      )),
      page.getByRole('button', { name: 'Create Task' }).click(),
    ]);
    const createdTask = await createResponse.json() as TaskRecord;
    taskIdForCleanup = createdTask.id;

    const actionTrigger = page.getByRole('button', { name: `Open task actions for task ${createdTask.taskKey}: ${title}` });
    await expect(actionTrigger).toBeVisible();
    await expect.poll(() => expectTaskInProject(request, project!.id, createdTask.id)).toMatchObject({
      id: createdTask.id,
      sprintId: sprint.id,
      title,
      promptMarkdown,
    });

    const taskMenu = await openTaskActionMenu(page, createdTask.taskKey, title);
    const deleteAction = taskMenu.getByRole('menuitem', { name: `Delete task ${createdTask.taskKey}: ${title}` });
    await deleteAction.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete Task' });
    await expect(dialog).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes(`/api/tasks/${encodeURIComponent(createdTask.id)}`)
        && response.status() === 200
      )),
      holdToConfirm(page, dialog.getByRole('button', { name: 'Hold to Delete Task' })),
    ]);

    await expect(actionTrigger).toHaveCount(0);
    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project!.id);
      return tasks.some((task) => task.id === createdTask.id);
    }).toBe(false);
    taskIdForCleanup = null;
  });
});
