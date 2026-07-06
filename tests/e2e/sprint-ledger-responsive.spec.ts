import { test, expect, type Page } from '@playwright/test';
import { completeOnboarding, createDraftSprint, ensureSelectedProject } from './helpers/prepare-app';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureProjectSelected(page: Page, projectName: string): Promise<void> {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();
  const text = await projectButton.innerText();
  if (text.includes(projectName)) {
    return;
  }

  await projectButton.click();
  const option = page.getByRole('option', { name: new RegExp(escapeRegExp(projectName)) }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  await expect(projectButton).toContainText(projectName);
}

test.describe('Sprint Ledger Responsive Layout E2E Tests', () => {
  let projectName: string;
  let sprintName: string;

  test.beforeEach(async ({ request }, testInfo) => {
    await completeOnboarding(request);
    const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'responsive' });
    const sprint = await createDraftSprint(request, project.id, {
      testInfo,
      fixtureKey: 'responsive',
      goal: 'Verify that sprint ledger remains readable on narrow viewports.',
    });
    projectName = project.name;
    sprintName = sprint.name;
  });

  test('adapts layout and displays correct labels on mobile vs desktop', async ({ page }) => {
    // 1. Navigate to sprints page
    await page.goto('/sprints');

    // 2. Make sure a project is selected so the sprints and compose buttons are loaded
    await ensureProjectSelected(page, projectName);

    // 3. The sprint fixture is created through the app API before page load.
    await expect(page.getByText(sprintName).first()).toBeVisible();

    // 4. Test Mobile Viewport Layout (width 375px)
    await page.setViewportSize({ width: 375, height: 812 });
    // On mobile, the field labels (e.g. "Sprint ID", "Completion", "Controls") should be visible
    const mobileLabels = page.locator('td span.lg\\:hidden');
    const mobileIdLabels = mobileLabels.filter({ hasText: 'Sprint ID' });
    const mobileCompletionLabels = mobileLabels.filter({ hasText: 'Completion' });
    const mobileControlsLabels = mobileLabels.filter({ hasText: 'Controls' });

    // Assert that at least one of each mobile label is visible in the list
    await expect(mobileIdLabels.first()).toBeVisible();
    await expect(mobileCompletionLabels.first()).toBeVisible();
    await expect(mobileControlsLabels.first()).toBeVisible();

    // 5. Test Desktop Viewport Layout (width 1280px)
    await page.setViewportSize({ width: 1280, height: 800 });
    // On desktop, the mobile field labels should be hidden
    await expect(mobileIdLabels.first()).not.toBeVisible();
    await expect(mobileCompletionLabels.first()).not.toBeVisible();
    await expect(mobileControlsLabels.first()).not.toBeVisible();
  });
});
