import { test, expect } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

test.beforeEach(async ({ request }, testInfo) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request, { testInfo, fixtureKey: 'app-smoke' });
});

test('loads the Code UX dashboard shell', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Code UX/i);
  await expect(page.getByRole('navigation', { name: /Workspace navigation/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Project/i })).toBeVisible();
});

test('opens the sprint ledger inside the local app', async ({ page }) => {
  await page.goto('/sprints');

  await expect(page).toHaveURL(/\/sprints$/);
  await expect(page.getByRole('region', { name: 'Sprint Ledger' })).toBeVisible();
});
