import { test, expect, type Page } from '@playwright/test';
import {
  createSprintWithTasks,
  prepareSelectedLocalGitProject,
  type SeededCodeUxProject,
} from './helpers/e2e-fixtures';

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
  let fixture: SeededCodeUxProject | null = null;
  let projectName: string;
  let sprintName: string;

  test.beforeEach(async ({ page, request }, testInfo) => {
    fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'responsive');
    const { sprint } = await createSprintWithTasks(request, fixture.project.id, {
      sprint: {
        name: `${fixture.project.name} responsive ledger sprint`,
        goal: 'Verify that sprint ledger remains readable on narrow viewports.',
      },
    });
    projectName = fixture.project.name;
    sprintName = sprint.name;
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fixture = null;
  });

  test('adapts layout and displays correct labels on mobile vs desktop', async ({ page, request }) => {
    const health = await request.get('/health');
    await expect(health).toBeOK();

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

    // Desktop headers remain visible, so this test distinguishes them from the
    // responsive row labels above instead of matching by text alone.
    await expect(page.getByRole('columnheader', { name: /Sprint ID/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Completion/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Controls/i })).toBeVisible();
  });
});
