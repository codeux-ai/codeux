import { expect, type Locator, type Page, test } from '@playwright/test';
import type { ProjectSummary, SprintRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  createTaskInSprint,
  ensureSelectedProject,
  fetchTasksViaApi,
  suppressDashboardTour,
  updateTaskFields,
} from '../helpers/prepare-app';

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ documentFits: true, bodyFits: true });
}

async function expectMenuInsideViewport(page: Page, menu: Locator): Promise<void> {
  await expect(menu).toBeInViewport();
  await expect.poll(() => menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left >= 0,
      top: rect.top >= 0,
      right: rect.right <= window.innerWidth,
      bottom: rect.bottom <= window.innerHeight,
    };
  })).toEqual({ left: true, top: true, right: true, bottom: true });
}

async function openTaskMenuWithKeyboard(
  page: Page,
  taskKey: string,
  title: string,
): Promise<{ trigger: Locator; menu: Locator }> {
  const trigger = page.getByRole('button', { name: `Open task actions for task ${taskKey}: ${title}`, exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: `Actions for task ${taskKey}: ${title}`, exact: true });
  await expect(menu).toBeVisible();
  return { trigger, menu };
}

test.describe('Tasks page redesign acceptance', () => {
  let project: ProjectSummary | null = null;
  let sprint: SprintRecord | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    await suppressDashboardTour(page);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'tasks-redesign' });
    sprint = await createDraftSprint(request, project.id, {
      testInfo,
      fixtureKey: 'tasks-redesign',
      goal: 'Exercise the integrated Tasks board and card acceptance contract.',
    });
  });

  test.afterEach(async ({ request }) => {
    if (project && sprint) {
      await cleanupSprintFixture(request, project.id, sprint.id);
    }
    project = null;
    sprint = null;
  });

  test('keeps board, menus, mutations, realtime refresh, and overflow stable on desktop and mobile', async ({ page, request }, testInfo) => {
    if (!project || !sprint) {
      throw new Error('Tasks redesign fixture was not initialized.');
    }

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'tasks-redesign' });
    const dependencyTitle = `${prefix} dependency ready for QA`;
    const targetTitle = `${prefix} integrated menu target`;
    const completedTitle = `${prefix} ${'overflow-safe-segment-'.repeat(9)}completed`;
    const editedTitle = `${targetTitle} edited`;
    const realtimeTitle = `${editedTitle} realtime`;

    const dependency = await createTaskInSprint(request, project.id, sprint.id, {
      testInfo,
      fixtureKey: 'tasks-redesign-dependency',
      title: dependencyTitle,
      input: { status: 'coding_completed', priority: 'high' },
    });
    const target = await createTaskInSprint(request, project.id, sprint.id, {
      testInfo,
      fixtureKey: 'tasks-redesign-target',
      title: targetTitle,
      input: {
        description: 'Target-labelled menu fixture with an explicit dependency.',
        status: 'pending',
        priority: 'critical',
        dependsOnTaskIds: [dependency.id],
      },
    });
    await createTaskInSprint(request, project.id, sprint.id, {
      testInfo,
      fixtureKey: 'tasks-redesign-completed',
      title: completedTitle,
      input: { status: 'completed', priority: 'low' },
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/tasks?projectId=${encodeURIComponent(project.id)}&sprintId=${encodeURIComponent(sprint.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();

    const queuedLane = page.getByRole('region', { name: /Queued lane/i });
    const progressLane = page.getByRole('region', { name: /In Progress lane/i });
    const completedLane = page.getByRole('region', { name: /Completed lane/i });
    await expect(queuedLane).toHaveAccessibleDescription(/Queued lane contains 1 task/i);
    await expect(progressLane).toHaveAccessibleDescription(/In Progress lane contains 1 task/i);
    await expect(completedLane).toHaveAccessibleDescription(/Completed lane contains 1 task/i);

    const desktopLaneBoxes = await Promise.all([
      queuedLane.boundingBox(),
      progressLane.boundingBox(),
      completedLane.boundingBox(),
    ]);
    expect(desktopLaneBoxes.every(Boolean)).toBe(true);
    expect(desktopLaneBoxes[0]!.x).toBeLessThan(desktopLaneBoxes[1]!.x);
    expect(desktopLaneBoxes[1]!.x).toBeLessThan(desktopLaneBoxes[2]!.x);
    await expectNoDocumentOverflow(page);

    const targetCard = page.getByLabel(new RegExp(`^Task ${target.taskKey}:`));
    const dependencyRow = targetCard.getByRole('listitem', {
      name: new RegExp(`Depends on task ${dependency.taskKey}, ready for qa\\. Blocking dependency\\.`, 'i'),
    });
    await expect(dependencyRow).toContainText(dependency.taskKey);
    await expect(dependencyRow).toContainText('Ready for QA');
    await expect(dependencyRow.locator('span[aria-hidden="true"]')).toHaveText([dependency.taskKey, 'Ready for QA']);
    await expect(dependencyRow).toHaveAccessibleName(new RegExp(`Title: ${dependencyTitle}$`));

    let { trigger, menu } = await openTaskMenuWithKeyboard(page, target.taskKey, targetTitle);
    await expect(menu.getByRole('menuitem', { name: `Open sprint preview for task ${target.taskKey}: ${targetTitle}` })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: `Rerun task ${target.taskKey}: ${targetTitle}` })).toHaveAccessibleDescription(`Open Live to rerun task ${target.taskKey}.`);
    await expectMenuInsideViewport(page, menu);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(menu).toBeHidden();

    await page.getByRole('tab', { name: 'Show completed tasks' }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    const pendingFilterState = await page.evaluate((taskKey) => ({
      pending: Array.from(document.querySelectorAll('[role="status"]')).some((element) => (
        element.textContent?.includes('Updating task board filters. Current cards remain visible until results settle.')
      )),
      previousCardVisible: document.querySelector(`[aria-label^="Task ${taskKey}:"]`) !== null,
    }), target.taskKey);
    expect(pendingFilterState).toEqual({ pending: true, previousCardVisible: true });
    await expect(page.getByText(completedTitle)).toBeVisible();
    await expect(targetCard).toBeHidden();
    await page.getByRole('tab', { name: 'Show all task statuses' }).click();
    await expect(targetCard).toBeVisible();

    ({ trigger, menu } = await openTaskMenuWithKeyboard(page, target.taskKey, targetTitle));
    let pageMutationCount = 0;
    page.on('request', (outgoingRequest) => {
      if (outgoingRequest.method() === 'PATCH' && outgoingRequest.url().includes(`/api/tasks/${encodeURIComponent(target.id)}`)) {
        pageMutationCount += 1;
      }
    });
    await menu.getByRole('menuitem', { name: `Edit task ${target.taskKey}: ${targetTitle}` }).click();
    await expect(page.getByRole('region', { name: 'Edit task editor' })).toBeVisible();
    await page.getByPlaceholder('Fix navigation layout shift').fill(editedTitle);
    await page.getByRole('button', { name: 'Save Task' }).click();
    await expect(page.getByRole('button', { name: `Open task actions for task ${target.taskKey}: ${editedTitle}` })).toBeVisible();
    expect(pageMutationCount).toBe(1);
    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project!.id, sprint!.id);
      return tasks.find((task) => task.id === target.id)?.title;
    }).toBe(editedTitle);

    const optimisticTitle = `${prefix} optimistic create`;
    let releaseCreate = (): void => {};
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let createMutationCount = 0;
    await page.route(`**/api/projects/${encodeURIComponent(project.id)}/tasks`, async (route) => {
      if (route.request().method() === 'POST') {
        createMutationCount += 1;
        await createGate;
      }
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'New Task' }).click();
      await page.getByPlaceholder('Fix navigation layout shift').fill(optimisticTitle);
      await page.getByPlaceholder('Summarize the intent and outcome.').fill('Verify a delayed create renders exactly one optimistic card.');
      await page.getByPlaceholder('Detailed markdown instructions for the worker agent.').fill('Create fixture work locally.');
      const createResponse = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/projects/${encodeURIComponent(project!.id)}/tasks`)
        && response.status() === 201
      ));
      await page.getByRole('button', { name: 'Create Task' }).click();
      const optimisticCard = page.getByLabel(/Task OPT-\.\.\.:/).filter({ hasText: optimisticTitle });
      await expect(optimisticCard).toBeVisible();
      await expect(optimisticCard).toContainText('Saving task changes');
      await expect(optimisticCard.getByRole('button', { name: /Open task actions for task OPT-\.\.\./ })).toHaveAttribute('aria-busy', 'true');
      releaseCreate();
      await createResponse;
      await expect(optimisticCard).toHaveCount(0);
      expect(createMutationCount).toBe(1);
    } finally {
      releaseCreate();
      await page.unroute(`**/api/projects/${encodeURIComponent(project.id)}/tasks`);
    }

    await updateTaskFields(request, project.id, target.id, { title: realtimeTitle });
    await updateTaskFields(request, project.id, target.id, { title: realtimeTitle });
    const realtimeTrigger = page.getByRole('button', { name: `Open task actions for task ${target.taskKey}: ${realtimeTitle}`, exact: true });
    await expect(realtimeTrigger).toHaveCount(1);
    await expect(realtimeTrigger).toBeVisible();
    await expect(page.getByRole('button', { name: `Open task actions for task ${target.taskKey}: ${editedTitle}`, exact: true })).toHaveCount(0);

    ({ trigger, menu } = await openTaskMenuWithKeyboard(page, target.taskKey, realtimeTitle));
    await menu.getByRole('menuitem', { name: `Delete task ${target.taskKey}: ${realtimeTitle}` }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete Task' });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(trigger).toBeFocused();
    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project!.id, sprint!.id);
      return tasks.filter((task) => task.id === target.id).length;
    }).toBe(1);
    expect(pageMutationCount).toBe(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoDocumentOverflow(page);
    const mobileLaneBoxes = await Promise.all([
      queuedLane.boundingBox(),
      progressLane.boundingBox(),
      completedLane.boundingBox(),
    ]);
    expect(mobileLaneBoxes.every(Boolean)).toBe(true);
    expect(mobileLaneBoxes[0]!.y).toBeLessThan(mobileLaneBoxes[1]!.y);
    expect(mobileLaneBoxes[1]!.y).toBeLessThan(mobileLaneBoxes[2]!.y);

    ({ trigger, menu } = await openTaskMenuWithKeyboard(page, target.taskKey, realtimeTitle));
    await expectMenuInsideViewport(page, menu);
    await expect(menu.getByRole('menuitem', { name: `Open sprint preview for task ${target.taskKey}: ${realtimeTitle}` })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expectNoDocumentOverflow(page);
  });
});
