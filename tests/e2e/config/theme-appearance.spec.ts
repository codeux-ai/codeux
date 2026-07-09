import { expect, test } from '@playwright/test';
import {
  chooseRowRadio,
  fetchSystemSettings,
  openConfigPage,
  openSettingsCategory,
  prepareConfigPage,
  saveButton,
  saveSettings,
  settingRow,
} from './config-test-helpers';

test.describe('theme and appearance persistence', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await prepareConfigPage(page, request, testInfo, 'theme-appearance');
  });

  test('applies the selected theme to the document and survives reload', async ({ page, request }) => {
    const initialTheme = (await fetchSystemSettings(request)).defaults.appearance.theme;
    const targetTheme = initialTheme === 'DARK' ? 'LIGHT' : 'DARK';
    const targetThemeLabel = targetTheme === 'DARK' ? /Dark/i : /Light/i;

    await openConfigPage(page);
    await openSettingsCategory(page, /Appearance Dashboard layout and theme preferences/i, 'Display Settings');

    await chooseRowRadio(page, 'Theme', targetThemeLabel);
    if (targetTheme === 'DARK') {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }

    if (await saveButton(page).isEnabled()) {
      await saveSettings(page);
    }

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.appearance.theme).toBe(targetTheme);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
    await openSettingsCategory(page, /Appearance Dashboard layout and theme preferences/i, 'Display Settings');

    await expect(settingRow(page, 'Theme').getByRole('radio', { name: targetThemeLabel })).toHaveAttribute('aria-checked', 'true');
    if (targetTheme === 'DARK') {
      await expect(page.locator('html')).toHaveClass(/dark/);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    }
  });
});
