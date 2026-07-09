import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createTaskInSprint,
  createE2eFixturePrefix,
  ensureSelectedProject,
  fetchSprintsViaApi,
  fetchTasksViaApi,
  suppressDashboardTour,
  updateSprintFields,
} from '../helpers/prepare-app';

async function prepareSprintDraftCrudApp(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
): Promise<ProjectSummary> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  return ensureSelectedProject(request, { testInfo, fixtureKey: 'sprint-draft-crud' });
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
  const actionLocator = page
    .getByRole('menuitem', { name: `${action} sprint ${sprintName}` })
    .or(page.getByRole('button', { name: `${action} sprint ${sprintName}` }))
    .last();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(menuButton).toBeVisible();
    await activateButtonWithKeyboard(page, menuButton);
    await expect(actionLocator).toBeVisible({ timeout: 5_000 });

    try {
      await activateButtonWithKeyboard(page, actionLocator);
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }
}

test.describe('draft sprint CRUD from the Sprints page', () => {
  let project: ProjectSummary | null = null;
  let sprintIdForCleanup: string | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    project = await prepareSprintDraftCrudApp(page, request, testInfo);
    sprintIdForCleanup = null;
  });

  test.afterEach(async ({ request }) => {
    if (project && sprintIdForCleanup) {
      await cleanupSprintFixture(request, project.id, sprintIdForCleanup);
    }

    project = null;
    sprintIdForCleanup = null;
  });

  test('creates and deletes a draft sprint without planning or workers', async ({ page, request }, testInfo) => {
    if (!project) {
      throw new Error('Sprint draft CRUD fixture was not initialized.');
    }

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'sprint-draft-crud' });
    const sprintName = `${prefix} draft sprint`;
    const sprintGoal = 'Save a draft sprint through the UI without triggering planning or worker dispatch.';

    await page.goto('/sprints');
    await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();
    await page.getByRole('button', { name: 'New Sprint' }).first().click();

    const composer = page.getByRole('form', { name: 'Sprint composer' });
    await expect(composer).toBeVisible();
    await composer.getByPlaceholder('Runtime hardening').fill(sprintName);
    await composer
      .getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.')
      .fill(sprintGoal);

    await composer.locator('button[type="button"]').filter({ hasText: /^Save Draft/ }).first().click();
    const submitButton = composer.locator('button[type="submit"]').filter({ hasText: 'Save Draft' });
    await expect(submitButton).toBeVisible();

    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/projects/${encodeURIComponent(project!.id)}/sprints`)
        && response.status() === 201
      )),
      submitButton.click(),
    ]);
    const createdSprint = await createResponse.json() as SprintRecord;
    sprintIdForCleanup = createdSprint.id;

    await expect(page.getByText(sprintName).first()).toBeVisible();
    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project!.id);
      return sprints.find((sprint) => sprint.id === createdSprint.id);
    }).toMatchObject({
      id: createdSprint.id,
      name: sprintName,
      status: 'idle',
      tasksCount: 0,
    });

    await page.getByPlaceholder('Search sprints…').fill(sprintName);
    await clickSprintMenuAction(page, sprintName, 'Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete Sprint?' });
    await expect(dialog).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'DELETE'
        && response.url().includes(`/api/sprints/${encodeURIComponent(createdSprint.id)}`)
        && response.status() === 200
      )),
      holdToConfirm(page, dialog.getByRole('button', { name: 'Hold to Delete Sprint' })),
    ]);

    await expect(page.getByText(sprintName).first()).toHaveCount(0);
    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project!.id);
      return sprints.some((sprint) => sprint.id === createdSprint.id);
    }).toBe(false);
    sprintIdForCleanup = null;
  });

  test('validates empty drafts, reloads edits, and preserves existing task dependencies', async ({ page, request }, testInfo) => {
    if (!project) {
      throw new Error('Sprint draft CRUD fixture was not initialized.');
    }

    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'sprint-draft-edit' });
    const sprintName = `${prefix} draft with long goal`;
    const sprintGoal = [
      'Save a long draft sprint through the visible composer.',
      'The goal text should reload intact and editing the sprint must not disturb existing tasks.',
      `Fixture marker: ${prefix}.`,
    ].join(' ');

    await page.goto('/sprints');
    await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();
    await page.getByRole('button', { name: 'New Sprint' }).first().click();

    const composer = page.getByRole('form', { name: 'Sprint composer' });
    await expect(composer).toBeVisible();
    await composer.locator('button[type="button"]').filter({ hasText: /^Save Draft/ }).first().click();
    const submitDraftButton = composer.locator('button[type="submit"]').filter({ hasText: 'Save Draft' });
    await submitDraftButton.click();
    await expect(composer.getByText('Sprint name is required')).toBeVisible();

    await composer.getByPlaceholder('Runtime hardening').fill(sprintName);
    await composer
      .getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.')
      .fill(sprintGoal);

    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/projects/${encodeURIComponent(project!.id)}/sprints`)
        && response.status() === 201
      )),
      submitDraftButton.click(),
    ]);
    const createdSprint = await createResponse.json() as SprintRecord;
    sprintIdForCleanup = createdSprint.id;

    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project!.id);
      return sprints.find((sprint) => sprint.id === createdSprint.id);
    }).toMatchObject({
      id: createdSprint.id,
      name: sprintName,
      goal: sprintGoal,
      tasksCount: 0,
    });

    await page.reload();
    await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();
    await page.getByPlaceholder('Search sprints…').fill(sprintName);
    await clickSprintMenuAction(page, sprintName, 'Edit');
    const editComposer = page.getByRole('form', { name: 'Sprint composer' });
    await expect(editComposer.getByText(/Edit (Draft|Planned) Sprint/)).toBeVisible();
    await expect(editComposer.getByPlaceholder('Runtime hardening')).toHaveValue(sprintName);
    await expect(editComposer.getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.')).toHaveValue(sprintGoal);

    const updatedName = `${prefix} edited draft`;
    const updatedGoal = `${sprintGoal} Edited after reload while keeping task dependency edges intact.`;
    await editComposer.getByPlaceholder('Runtime hardening').fill(updatedName);
    await editComposer
      .getByPlaceholder('Describe the outcome, affected systems, and what done looks like when this sprint lands.')
      .fill(updatedGoal);
    await editComposer.getByRole('button', { name: /^Save Changes\s+Update the sprint definition/ }).click();
    const saveChangesButton = editComposer.getByRole('button', { name: 'Save Changes', exact: true });
    await expect(saveChangesButton).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && response.url().includes(`/api/sprints/${encodeURIComponent(createdSprint.id)}`)
        && response.status() === 200
      )),
      saveChangesButton.click(),
    ]);

    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project!.id);
      return sprints.find((sprint) => sprint.id === createdSprint.id);
    }).toMatchObject({
      id: createdSprint.id,
      name: updatedName,
      goal: updatedGoal,
      tasksCount: 0,
    });

    const dependencyTask = await createTaskInSprint(request, project.id, createdSprint.id, {
      title: `${prefix} sprint dependency anchor`,
      promptMarkdown: 'Sprint edit dependency anchor.',
    });
    const dependentTask = await createTaskInSprint(request, project.id, createdSprint.id, {
      title: `${prefix} sprint dependent task`,
      promptMarkdown: 'Sprint edit dependent task.',
      input: { dependsOnTaskIds: [dependencyTask.id] },
    });
    const refreshedGoal = `${updatedGoal} Metadata refreshed after tasks were added.`;
    await updateSprintFields(request, project.id, createdSprint.id, { goal: refreshedGoal });

    await expect.poll(async () => {
      const { sprints } = await fetchSprintsViaApi(request, project!.id);
      return sprints.find((sprint) => sprint.id === createdSprint.id);
    }).toMatchObject({
      id: createdSprint.id,
      name: updatedName,
      goal: refreshedGoal,
      tasksCount: 2,
    });

    await expect.poll(async () => {
      const tasks = await fetchTasksViaApi(request, project!.id, createdSprint.id);
      return tasks.find((task) => task.id === dependentTask.id);
    }).toMatchObject({
      id: dependentTask.id,
      dependsOnTaskIds: [dependencyTask.id],
    });
  });
});
