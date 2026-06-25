import { test, expect } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

test.beforeEach(async ({ page, request }) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request);

  await page.addInitScript(() => {
    localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
  });
});

test('Dashboard accessibility smoke test', async ({ page }) => {
  await page.goto('/');

  // 1. Skip link
  const skipLink = page.locator('a[href="#main-content"]');
  await expect(skipLink).toHaveAttribute('class', /sr-only/);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();

  // 2. Primary Navigation
  const nav = page.getByRole('navigation', { name: /Dock navigation/i });
  await expect(nav).toBeVisible();

  // 3. Global Search
  const searchTrigger = page.getByRole('button', { name: 'Search' });
  await expect(searchTrigger).toBeVisible();

  // 4. Notification trigger
  const notificationTrigger = page.getByRole('button', { name: 'Notifications' });
  await expect(notificationTrigger).toBeVisible();

  // 5. Project Selector
  const projectSelector = page.getByRole('button', { name: /Project/i });
  await expect(projectSelector).toBeVisible();

  // 6. Stats Chart (if visible)
  const statsChart = page.getByRole('region', { name: /Statistics|Chart/i }).first();
  if (await statsChart.isVisible()) {
    await expect(statsChart).toBeVisible();
  }

  // 7. Open Dialog
  await searchTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  const searchInput = dialog.getByPlaceholder('Search sprints, tasks, agents...');
  await expect(searchInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 8. Sprint Ledger
  await page.goto('/sprints');
  await page.waitForURL('**/sprints');

  // Wait for loading indicator to be hidden if it exists
  const loadingElement = page.getByText(/loading/i).first();
  if (await loadingElement.isVisible()) {
    await expect(loadingElement).toBeHidden();
  }

  const sprintLedger = page.getByRole('region', { name: 'Sprint Ledger' });
  await expect(sprintLedger).toBeVisible();
});
