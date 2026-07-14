import { expect, test } from '@playwright/test';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'error-states');
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

test('invalid dashboard routes render the deliberate not-found state', async ({ page }) => {
  await page.goto('/route-that-does-not-exist', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go Home' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Main content' })).toBeVisible();
});

test('routes with no sprint data render an intentional empty state', async ({ page }) => {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a sprint to unlock tasks.' })).toBeVisible();
  await expect(page.getByText('Tasks are organized inside sprint scope.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Task' })).toBeDisabled();
});
