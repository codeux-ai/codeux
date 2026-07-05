import { test, expect } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

test.beforeEach(async ({ request }) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request);
});

test('serves the local Code UX dashboard shell', async ({ page, request }) => {
  const health = await request.get('/health');
  await expect(health).toBeOK();

  await page.goto('/');

  await expect(page).toHaveTitle(/Code UX/);
  await expect(page.getByRole('navigation', { name: /Workspace navigation/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search workspace' })).toBeVisible();
});

test('navigates to the local sprint ledger', async ({ page }) => {
  await page.goto('/sprints');

  await expect(page).toHaveURL(/\/sprints$/);
  await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();

  const projectSelector = page.locator('[data-tour-id="project-selector"]');
  await expect(projectSelector).toBeVisible();
  await expect(projectSelector).not.toContainText(/Select Project|Loading/i);
});
