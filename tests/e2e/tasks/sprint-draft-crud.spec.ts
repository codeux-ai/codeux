import { expect, type APIRequestContext, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createE2eFixturePrefix,
  deleteSprint,
  ensureSelectedProject,
  fetchSprintsViaApi,
  suppressDashboardTour,
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

async function clickSprintMenuAction(page: Page, sprintName: string, action: 'Delete'): Promise<void> {
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
      await deleteSprint(request, project.id, sprintIdForCleanup);
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
});
