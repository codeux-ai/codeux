import { test, expect } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

test.beforeEach(async ({ page, request }) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request);

  await page.addInitScript(() => {
    localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
  });
});

test('loads the local Code UX shell from a prepared app state', async ({ page, request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual(expect.objectContaining({ status: 'UP' }));

  await page.goto('/');

  await expect(page).toHaveTitle('Code UX', { timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: /Primary navigation/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-label="Dashboard Overview"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Project/i })).toBeVisible({ timeout: 15_000 });
});
