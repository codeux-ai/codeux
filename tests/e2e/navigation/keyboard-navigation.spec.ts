import { expect, type Page, test } from '@playwright/test';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'keyboard-navigation');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function openGlobalSearchWithKeyboard(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /Search workspace|Open search/i }).first();
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
}

test('skip link is the first keyboard stop and moves focus to main content', async ({ page }) => {
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeAttached();

  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('main', { name: 'Main content' })).toBeFocused();
});

test('global search opens and closes from the keyboard while keeping focus inside the dialog', async ({ page }) => {
  await openGlobalSearchWithKeyboard(page);

  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole('combobox', { name: 'Global search' });
  await expect(input).toBeFocused();
  await input.fill('agent');
  await expect(input).toHaveValue('agent');

  await page.keyboard.press('Tab');
  await expect.poll(async () => (
    await dialog.evaluate((element) => element.contains(document.activeElement))
  )).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Search workspace|Open search/i }).first()).toBeFocused();
});

test('project selector is reachable and operable by keyboard', async ({ page }) => {
  const projectSelector = page.getByRole('button', { name: /Project selector, selected project:/i });
  await expect(projectSelector).toBeVisible();
  await expect(projectSelector).toContainText(fixture?.project.name ?? '');

  await projectSelector.focus();
  await expect(projectSelector).toBeFocused();

  await page.keyboard.press('ArrowDown');
  const projectList = page.getByRole('listbox', { name: 'Project list' });
  await expect(projectList).toBeVisible();

  const selectedProjectOption = page.getByRole('option', { name: new RegExp(fixture?.project.name ?? '') });
  await expect(selectedProjectOption).toBeFocused();
  await expect(selectedProjectOption).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(projectList).toBeHidden();
  await expect(projectSelector).toBeFocused();
});
