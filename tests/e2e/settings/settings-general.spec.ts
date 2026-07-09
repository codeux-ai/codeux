import { expect, test, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';
import {
  chooseRadio,
  expectRowNumberValue,
  expectUnsavedIndicator,
  expectValidationMessage,
  fetchSystemSettings,
  fillRowNumber,
  openSettingsCategory,
  saveSettings,
  settingsRow,
} from './settings-test-helpers';

type ConsoleLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

const consoleLogLevelLabels: Record<ConsoleLogLevel, RegExp> = {
  debug: /Debug Everything/i,
  info: /Info Normal activity/i,
  warn: /Warn Warnings and errors/i,
  error: /Error Errors only/i,
  off: /Off Silence console logging/i,
};

async function openGeneral(page: Page): Promise<void> {
  await openSettingsCategory(page, 'general', /General Scope, runtime, and automation posture/i);
}

test.describe('settings general panel', () => {
  let project: ProjectSummary;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'settings-general' });
    await suppressDashboardTour(page);
  });

  test('persists a system runtime value across reload and the system settings endpoint', async ({ page, request }) => {
    expect(project.id).toBeTruthy();
    const currentLevel = (await fetchSystemSettings(request)).runtime.consoleLogLevel;
    const nextLevel: ConsoleLogLevel = currentLevel === 'debug' ? 'warn' : 'debug';

    await openGeneral(page);

    await chooseRadio(page, consoleLogLevelLabels[nextLevel]);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).runtime.consoleLogLevel).toBe(nextLevel);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
    await openGeneral(page);
    await expect(settingsRow(page, 'Console log level').getByRole('radio', { name: consoleLogLevelLabels[nextLevel] }))
      .toHaveAttribute('aria-checked', 'true');
  });

  test('rejects an invalid dashboard port before saving', async ({ page, request }) => {
    const originalPort = (await fetchSystemSettings(request)).runtime.dashboardPort;
    await openGeneral(page);

    await fillRowNumber(page, 'Dashboard port', 70000);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(settingsRowForPort(page)).toHaveAttribute('aria-invalid', 'true');
    await expectValidationMessage(page, 'Use a value no greater than 65535.');
    expect((await fetchSystemSettings(request)).runtime.dashboardPort).toBe(originalPort);
  });

  test('persists a database retention value after reload', async ({ page, request }) => {
    await openGeneral(page);

    const pruningToggle = page.getByText('Automatic pruning', { exact: true })
      .locator('xpath=ancestor::div[contains(@class, "md:flex-row")][1]')
      .getByRole('switch');
    if (await pruningToggle.getAttribute('aria-checked') !== 'true') {
      await pruningToggle.click();
    }

    await fillRowNumber(page, 'Log retention period (days)', 33);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).runtime.dbRetentionDays).toBe(33);

    await page.reload();
    await openGeneral(page);
    await expectRowNumberValue(page, 'Log retention period (days)', 33);
  });
});

function settingsRowForPort(page: Page) {
  return page.getByText('Dashboard port', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "md:flex-row")][1]')
    .getByRole('spinbutton');
}
