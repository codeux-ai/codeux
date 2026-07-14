import { expect, type APIRequestContext, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  ensureSelectedProject,
  suppressDashboardTour,
} from '../helpers/prepare-app';

async function prepareComposerValidationApp(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
): Promise<{ project: ProjectSummary; sprint: SprintRecord }> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'composer-validation' });
  const sprint = await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'composer-validation',
    goal: 'Provide sprint scope for task composer validation coverage.',
  });
  return { project, sprint };
}

test.describe('task composer validation', () => {
  let project: ProjectSummary | null = null;
  let sprint: SprintRecord | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    const fixture = await prepareComposerValidationApp(page, request, testInfo);
    project = fixture.project;
    sprint = fixture.sprint;
  });

  test.afterEach(async ({ request }) => {
    if (project && sprint) {
      await cleanupSprintFixture(request, project.id, sprint.id);
    }

    project = null;
    sprint = null;
  });

  test('shows required task title alert and inline motion feedback', async ({ page }) => {
    if (!project || !sprint) {
      throw new Error('Composer validation fixture was not initialized.');
    }

    await page.goto(`/tasks?projectId=${encodeURIComponent(project.id)}&sprintId=${encodeURIComponent(sprint.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();

    await page.getByRole('button', { name: 'New Task' }).click();
    const titleInput = page.getByPlaceholder('Fix navigation layout shift');
    await expect(titleInput).toBeVisible();

    await titleInput.fill('Temporary title');
    await titleInput.fill('');
    await page.keyboard.press('Tab');

    const alert = page.locator('[role="alert"]').filter({ hasText: 'Task title is required.' });
    await expect(alert).toBeVisible();
    await expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Create Task' })).toBeDisabled();

    const validationWrapper = titleInput.locator('xpath=ancestor::div[contains(@class, "relative rounded-md")][1]');
    await expect(validationWrapper).toHaveClass(/ring-status-red/);
  });
});
