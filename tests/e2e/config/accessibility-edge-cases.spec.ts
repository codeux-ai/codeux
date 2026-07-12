import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProjectSummary, SprintRecord } from '../../../src/contracts/project-management-types.js';
import {
  cleanupSprintFixture,
  createDraftSprint,
} from '../helpers/prepare-app';
import {
  openConfigPage,
  openSettingsCategory,
  openSettingsSection,
  prepareConfigPage,
  returnToSettingsCategoryOverview,
  saveButton,
  settingRow,
  setRowSwitch,
  fetchSystemSettings,
  settingsPanel,
} from './config-test-helpers';

let project: ProjectSummary | null = null;
let sprint: SprintRecord | null = null;

async function expectFocusInside(page: Page, container: Locator): Promise<void> {
  const handle = await container.elementHandle();
  expect(handle).not.toBeNull();
  await expect.poll(async () => page.evaluate((element) => (
    element instanceof HTMLElement && element.contains(document.activeElement)
  ), handle)).toBe(true);
}

test.describe('configuration accessibility edge cases', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    project = await prepareConfigPage(page, request, testInfo, 'accessibility-edge-cases');
    sprint = await createDraftSprint(request, project.id, {
      testInfo,
      fixtureKey: 'accessibility-edge-cases',
      goal: 'Provide a selected sprint for configuration accessibility coverage.',
    });
  });

  test.afterEach(async ({ request }) => {
    if (project && sprint) {
      await cleanupSprintFixture(request, project.id, sprint.id);
    }
    project = null;
    sprint = null;
  });

  test('search dialog exposes dialog semantics, traps focus, and restores focus on close', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    const searchTrigger = page.getByRole('button', { name: /Search workspace|Open search/i }).first();
    await expect(searchTrigger).toBeVisible();
    await expect(searchTrigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(searchTrigger).toHaveAccessibleName(/Search workspace|Open search/i);

    await searchTrigger.focus();
    await expect(searchTrigger).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(searchTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(searchTrigger).toHaveAttribute('aria-controls', 'global-search-overlay');

    const input = dialog.getByRole('combobox', { name: 'Global search' });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-controls', 'search-results-list');

    await page.keyboard.press('Shift+Tab');
    await expectFocusInside(page, dialog);
    await page.keyboard.press('Tab');
    await expectFocusInside(page, dialog);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(searchTrigger).toBeFocused();
  });

  test('settings dialogs and validation status keep accessible roles and focus boundaries', async ({ page, request }) => {
    const initialThreshold = (await fetchSystemSettings(request)).defaults.memory.promotionThreshold;
    const dirtyThreshold = initialThreshold === 0.75 ? '0.7' : '0.75';

    await openConfigPage(page);
    await expect(page.getByRole('radiogroup', { name: 'Settings scope' })).toBeVisible();
    await expect(page.getByLabel('Search settings categories')).toHaveAccessibleName('Search settings categories');
    await expect(saveButton(page)).toHaveAccessibleName(/Save Changes/i);

    await openSettingsCategory(page, 'Memory', 'Memory System');
    await openSettingsSection(page, 'Memory System');
    await setRowSwitch(page, 'Enable memory', true);
    await expect(settingsPanel(page).getByRole('switch', { name: 'Toggle setting' }).first()).toHaveAccessibleName('Toggle setting');
    await returnToSettingsCategoryOverview(page);
    await openSettingsSection(page, 'Limits');
    const promotionThreshold = settingRow(page, 'Promotion threshold').getByRole('spinbutton');
    await promotionThreshold.fill('2');
    await saveButton(page).click();

    const validationStatus = settingsPanel(page).getByRole('status').filter({ hasText: /no greater than 1|fix the highlighted setting/i }).first();
    await expect(validationStatus).toBeVisible();
    await expect(validationStatus).toHaveAttribute('aria-live', 'polite');
    await expect(promotionThreshold).toHaveAttribute('aria-invalid', 'true');

    await promotionThreshold.fill(dirtyThreshold);
    await returnToSettingsCategoryOverview(page);
    await openSettingsSection(page, 'Memory System');
    await setRowSwitch(page, 'Enable memory', false);
    await page.getByRole('link', { name: /Overview/i }).click();

    const unsavedDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(unsavedDialog).toBeVisible();
    await expect(unsavedDialog).toHaveAttribute('aria-modal', 'true');
    await expect(unsavedDialog.getByRole('button', { name: 'Keep editing' })).toHaveAccessibleName('Keep editing');
    await page.keyboard.press('Tab');
    await expectFocusInside(page, unsavedDialog);
    await page.keyboard.press('Shift+Tab');
    await expectFocusInside(page, unsavedDialog);
    await page.keyboard.press('Escape');
    await expect(unsavedDialog).toBeHidden();
    await expect(page).toHaveURL(/\/config/);
  });

  test('task composer form errors are announced and controls remain named', async ({ page }) => {
    expect(project).not.toBeNull();
    expect(sprint).not.toBeNull();

    await page.goto(`/tasks?projectId=${encodeURIComponent(project!.id)}&sprintId=${encodeURIComponent(sprint!.id)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Task Board' })).toBeVisible();

    const newTaskButton = page.getByRole('button', { name: 'New Task' });
    await expect(newTaskButton).toHaveAccessibleName('New Task');
    await newTaskButton.click();

    const titleInput = page.getByPlaceholder('Fix navigation layout shift');
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveAccessibleName(/Task Title/i);
    await expect(page.getByRole('button', { name: 'Close task composer' })).toHaveAccessibleName('Close task composer');
    await expect(page.getByRole('button', { name: 'Create Task' })).toHaveAccessibleName(/Create Task/i);

    await titleInput.fill('A');
    await titleInput.fill('');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });

    const titleError = page.getByRole('alert').filter({ hasText: 'Task title is required.' });
    await expect(titleError).toBeVisible();
    await expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    await expect(titleInput).toHaveAttribute('aria-errormessage', /-error$/);
  });
});
