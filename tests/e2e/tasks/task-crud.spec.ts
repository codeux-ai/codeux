import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  createTaskInSprint,
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

async function activateButtonWithKeyboard(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await page.keyboard.press('Enter');
}

async function expectTaskInProject(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
): Promise<TaskRecord | undefined> {
  const tasks = await fetchTasksViaApi(request, projectId);
  return tasks.find((task) => task.id === taskId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('task CRUD from the Tasks page', () => {
  let project: ProjectSummary | null = null;
  let sprint: SprintRecord | null = null;
  let taskIdsForCleanup = new Set<string>();

  test.beforeEach(async ({ page, request }, testInfo) => {
    const fixture = await prepareTaskCrudApp(page, request, testInfo);
    project = fixture.project;
    sprint = fixture.sprint;
    taskIdsForCleanup = new Set<string>();
  });

  test.afterEach(async ({ request }) => {
    if (!project || !sprint) {
      return;
    }

    for (const taskId of taskIdsForCleanup) {
      await deleteTask(request, project.id, taskId);
    }
    taskIdsForCleanup.clear();

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
    await expect(page.getByRole('heading', { level: 1, name: 'Task Board' })).toBeVisible();

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
    taskIdsForCleanup.add(createdTask.id);

    await expect(page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${title}` })).toBeVisible();
    await expect.poll(() => expectTaskInProject(request, project!.id, createdTask.id)).toMatchObject({
      id: createdTask.id,
      sprintId: sprint.id,
      title,
      promptMarkdown,
    });

    await activateButtonWithKeyboard(page, page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${title}` }));
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

    await expect(page.getByRole('button', { name: `Delete task ${createdTask.taskKey}: ${title}` })).toHaveCount(0);
    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project!.id);
      return tasks.some((task) => task.id === createdTask.id);
    }).toBe(false);
    taskIdsForCleanup.delete(createdTask.id);
  });

  test('creates, reloads, and edits long task content while preserving dependencies', async ({ page, request }, testInfo) => {
    if (!project || !sprint) {
      throw new Error('Task CRUD fixture was not initialized.');
    }

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'task-crud-long-edit' });
    const dependencyTask = await createTaskInSprint(request, project.id, sprint.id, {
      title: `${prefix} dependency anchor`,
      promptMarkdown: 'Dependency anchor for task composer preservation.',
      input: {
        description: 'A deterministic prerequisite task.',
        priority: 'high',
      },
    });
    taskIdsForCleanup.add(dependencyTask.id);

    const longTitle = `${prefix} task with long editable content ${'alpha '.repeat(8).trim()}`;
    const longDescription = [
      'This description intentionally spans multiple clauses so the composer stores and reloads non-trivial task text.',
      'It verifies the dashboard does not truncate saved copy or drop dependencies when the task is later edited.',
    ].join(' ');
    const longPrompt = [
      '# Worker Instructions',
      '',
      '- Preserve dependency metadata.',
      '- Keep this prompt deterministic across reloads.',
      `- Fixture marker: ${prefix}.`,
      '',
      '```txt',
      'Long markdown prompts should round-trip without invoking providers.',
      '```',
    ].join('\n');

    await page.goto(`/tasks?projectId=${encodeURIComponent(project.id)}&sprintId=${encodeURIComponent(sprint.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Task Board' })).toBeVisible();

    await page.getByRole('button', { name: 'New Task' }).click();
    const composer = page.getByRole('region', { name: 'New task editor' });
    await expect(composer).toBeVisible();
    await expect(composer.getByRole('button', { name: 'Create Task' })).toBeDisabled();

    await page.getByPlaceholder('Fix navigation layout shift').fill(longTitle);
    await page.getByPlaceholder('Summarize the intent and outcome.').fill(longDescription);
    await page.getByPlaceholder('Detailed markdown instructions for the worker agent.').fill(longPrompt);

    const dependencyChoice = composer.getByRole('button', {
      name: new RegExp(`${escapeRegExp(dependencyTask.taskKey)}[\\s\\S]*${escapeRegExp(dependencyTask.title)}`),
    });
    await expect(dependencyChoice).toHaveAttribute('aria-pressed', 'false');
    await dependencyChoice.click();
    await expect(dependencyChoice).toHaveAttribute('aria-pressed', 'true');

    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/projects/${encodeURIComponent(project!.id)}/tasks`)
        && response.status() === 201
      )),
      composer.getByRole('button', { name: 'Create Task' }).click(),
    ]);
    const createdTask = await createResponse.json() as TaskRecord;
    taskIdsForCleanup.add(createdTask.id);

    await expect.poll(() => expectTaskInProject(request, project!.id, createdTask.id)).toMatchObject({
      id: createdTask.id,
      title: longTitle,
      promptMarkdown: longPrompt,
      dependsOnTaskIds: [dependencyTask.id],
    });

    await page.reload();
    const editTaskButton = page.getByRole('button', { name: `Edit task ${createdTask.taskKey}: ${longTitle}` });
    await expect(editTaskButton).toBeVisible();

    await activateButtonWithKeyboard(page, editTaskButton);
    const editComposer = page.getByRole('region', { name: 'Edit task editor' });
    await expect(editComposer).toBeVisible();
    await expect(page.getByPlaceholder('Fix navigation layout shift')).toHaveValue(longTitle);
    await expect(editComposer.getByRole('button', {
      name: new RegExp(`${escapeRegExp(dependencyTask.taskKey)}[\\s\\S]*${escapeRegExp(dependencyTask.title)}`),
    })).toHaveAttribute('aria-pressed', 'true');

    const updatedTitle = `${prefix} edited task title`;
    const updatedDescription = `${longDescription} Updated through the edit composer after a reload.`;
    const updatedPrompt = `${longPrompt}\n\n## Edit\nThe task was updated without changing dependency edges.`;

    await page.getByPlaceholder('Fix navigation layout shift').fill(updatedTitle);
    await page.getByPlaceholder('Summarize the intent and outcome.').fill(updatedDescription);
    await page.getByPlaceholder('Detailed markdown instructions for the worker agent.').fill(updatedPrompt);

    await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && response.url().includes(`/api/tasks/${encodeURIComponent(createdTask.id)}`)
        && response.status() === 200
      )),
      editComposer.getByRole('button', { name: 'Save Task' }).click(),
    ]);

    await expect.poll(() => expectTaskInProject(request, project!.id, createdTask.id)).toMatchObject({
      id: createdTask.id,
      title: updatedTitle,
      description: updatedDescription,
      promptMarkdown: updatedPrompt,
      dependsOnTaskIds: [dependencyTask.id],
    });

    await page.reload();
    const reloadedEditButton = page.getByRole('button', { name: `Edit task ${createdTask.taskKey}: ${updatedTitle}` });
    await expect(reloadedEditButton).toBeVisible();
    await activateButtonWithKeyboard(page, reloadedEditButton);
    await expect(page.getByRole('region', { name: 'Edit task editor' }).getByRole('button', {
      name: new RegExp(`${escapeRegExp(dependencyTask.taskKey)}[\\s\\S]*${escapeRegExp(dependencyTask.title)}`),
    })).toHaveAttribute('aria-pressed', 'true');
  });
});
