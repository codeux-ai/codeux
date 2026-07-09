import { expect, test } from '@playwright/test';
import {
  cleanupSprintFixture,
  completeOnboarding,
  createDraftSprint,
  ensureSelectedProject,
  suppressDashboardTour,
} from '../helpers/prepare-app';

test('Composer visual feedback works correctly', async ({ page, request }, testInfo) => {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  const project = await ensureSelectedProject(request, {
    testInfo,
    fixtureKey: 'visual-feedback',
  });
  const sprint = await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'visual-feedback',
    goal: 'Provide sprint scope for task composer visual feedback coverage.',
  });

  try {
    await page.goto(`/tasks?projectId=${encodeURIComponent(project.id)}&sprintId=${encodeURIComponent(sprint.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Task Board' })).toBeVisible();
    const newTaskButton = page.getByRole('button', { name: 'New Task' });
    await expect(newTaskButton).toBeEnabled();
    await newTaskButton.click();

    const taskTitleInput = page.getByPlaceholder('Fix navigation layout shift');
    await expect(taskTitleInput).toBeVisible();

    await taskTitleInput.click();
    await taskTitleInput.type('T', { delay: 50 });
    await expect(taskTitleInput).toHaveValue('T');

    // Wait for debounce and test that error appears in aria-live
    await taskTitleInput.fill('');
    await page.evaluate(() => document.activeElement?.blur());

    // Specific check for aria-live regions used for validation
    const ariaLiveRegion = page.locator('[aria-live="polite"]');
    await expect(ariaLiveRegion.first()).toBeAttached();
    // Wait condition that confirms the GSAP transition has completed before asserting layout positions
    await page.waitForTimeout(600); // GSAP transition is usually 400ms

    const alertContainer = page.locator('[role="alert"]').filter({ hasText: 'Task title is required.' });
    await expect(alertContainer).toBeVisible({ timeout: 2000 });
  } finally {
    await cleanupSprintFixture(request, project.id, sprint.id);
  }
});
