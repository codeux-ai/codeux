import { test, expect } from '@playwright/test';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'accessibility');
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

test('Dashboard accessibility smoke test', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('dialog', { name: /make the runtime ready/i })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /projects|sprints|tasks|settings/i })).toHaveCount(0);

  // 1. Skip link
  const skipLink = page.locator('a[href="#main-content"]');
  await expect(skipLink).toHaveAttribute('class', /sr-only/);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();

  // 2. Primary Navigation
  const nav = page.getByRole('navigation', { name: /Workspace navigation/i });
  await expect(nav).toBeVisible();

  // 3. Global Search
  const searchTrigger = page.getByRole('button', { name: /Search workspace|Search/i });
  await expect(searchTrigger).toBeVisible();

  // 4. Notification trigger
  const notificationTrigger = page.getByRole('button', { name: /Notifications/ });
  await expect(notificationTrigger).toBeVisible();

  // 5. Project Selector
  const projectSelector = page.getByRole('button', { name: /Project/i });
  await expect(projectSelector).toBeVisible();
  await expect(projectSelector).toContainText(fixture?.project.name ?? '');

  // 6. Stats Chart (if visible)
  const statsChart = page.getByRole('region', { name: /Statistics|Chart/i }).first();
  if (await statsChart.isVisible()) {
    await expect(statsChart).toBeVisible();
  }

  // 7. Open Dialog
  await searchTrigger.focus();
  await expect(searchTrigger).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  const searchInput = dialog.getByPlaceholder('Find sprints, tasks, agents, previews...');
  await expect(searchInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 8. Sprint Ledger
  await page.goto('/sprints');
  await page.waitForURL('**/sprints');

  const sprintLedger = page.getByRole('region', { name: 'Sprint Ledger' });
  await expect(sprintLedger).toBeVisible();
  await expect(projectSelector).toContainText(fixture?.project.name ?? '');
});
