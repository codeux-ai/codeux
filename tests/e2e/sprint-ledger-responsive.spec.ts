import { test, expect } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

async function ensureProjectSelected(page) {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();
  const text = await projectButton.innerText();
  if (text.includes('Select Project') || text.includes('Loading...')) {
    await projectButton.click();
    const firstOption = page.locator('[role="listbox"] [role="option"]').first();
    await firstOption.waitFor({ state: 'visible' });
    await firstOption.click();
  }
}

test.describe('Sprint Ledger Responsive Layout E2E Tests', () => {
  test.beforeEach(async ({ request }) => {
    await completeOnboarding(request);
    await ensureSelectedProject(request);
  });

  test('adapts layout and displays correct labels on mobile vs desktop', async ({ page }) => {
    // 1. Navigate to sprints page
    await page.goto('/sprints');

    // 2. Make sure a project is selected so the sprints and compose buttons are loaded
    await ensureProjectSelected(page);

    // 3. Create a draft sprint if there are no sprints in the ledger
    const ledgerEmptyState = page.locator('text=No sprints yet');
    const newSprintBtn = page.getByRole('button', { name: 'New Sprint', exact: true });

    if (await ledgerEmptyState.isVisible() || await newSprintBtn.isVisible()) {
      await newSprintBtn.click();

      // Fill out Sprint Composer
      const sprintNameInput = page.locator('input[placeholder="Runtime hardening"]');
      await sprintNameInput.fill('Responsive Test Sprint');

      const sprintPromptTextarea = page.locator('textarea[placeholder^="Describe the outcome"]');
      await sprintPromptTextarea.fill('Verify that sprint ledger remains readable on narrow viewports.');

      // Select "Save Draft" mode so we do not trigger AI planning or Docker worker provisioning
      const saveDraftModeBtn = page.getByRole('button', { name: 'Save Draft' });
      await saveDraftModeBtn.click();

      // Click the submit button (which now reads "Save Draft")
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toHaveText('Save Draft');
      await submitBtn.click();

      // Wait for composer to close and sprint to be created
      await expect(page.locator('text=Responsive Test Sprint').first()).toBeVisible();
    }

    // 4. Test Mobile Viewport Layout (width 375px)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500); // Allow layout transition

    // On mobile, the field labels (e.g. "Sprint ID", "Completion", "Controls") should be visible
    const mobileIdLabels = page.locator('span:has-text("Sprint ID")');
    const mobileCompletionLabels = page.locator('span:has-text("Completion")');
    const mobileControlsLabels = page.locator('span:has-text("Controls")');

    // Assert that at least one of each mobile label is visible in the list
    await expect(mobileIdLabels.first()).toBeVisible();
    await expect(mobileCompletionLabels.first()).toBeVisible();
    await expect(mobileControlsLabels.first()).toBeVisible();

    // 5. Test Desktop Viewport Layout (width 1280px)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500); // Allow layout transition

    // On desktop, the mobile field labels should be hidden
    await expect(mobileIdLabels.first()).not.toBeVisible();
    await expect(mobileCompletionLabels.first()).not.toBeVisible();
    await expect(mobileControlsLabels.first()).not.toBeVisible();
  });
});
