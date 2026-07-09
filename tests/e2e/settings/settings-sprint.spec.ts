import { expect, test, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';
import {
  expectRowTextValue,
  expectUnsavedIndicator,
  expectValidationMessage,
  fetchSystemSettings,
  fillRowNumber,
  fillRowText,
  openSettingsCategory,
  saveSettings,
} from './settings-test-helpers';

async function openSprint(page: Page): Promise<void> {
  await openSettingsCategory(page, 'sprint', /Sprint & Git Git flow, branch naming, merge rules, and execution runtime/i);
}

async function openBrowser(page: Page): Promise<void> {
  await openSettingsCategory(page, 'browser', /Browser Preview Preview runtime, browser visibility, and container policy/i);
}

test.describe('settings sprint and browser panels', () => {
  let project: ProjectSummary;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'settings-sprint' });
    await suppressDashboardTour(page);
  });

  test('persists sprint git settings across reload and the system settings endpoint', async ({ page, request }, testInfo) => {
    expect(project.id).toBeTruthy();
    const prefix = `e2e/${testInfo.workerIndex}-${testInfo.retry}/`;
    await openSprint(page);

    await fillRowText(page, 'Feature branch prefix', prefix);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.git.featureBranchPrefix).toBe(prefix);

    await page.reload();
    await openSprint(page);
    await expectRowTextValue(page, 'Feature branch prefix', prefix);
  });

  test('rejects invalid watch loop intervals before saving', async ({ page, request }) => {
    const originalInterval = (await fetchSystemSettings(request)).defaults.sprintLoopSteps.watchLoopIntervalSeconds;
    await openSprint(page);

    await fillRowNumber(page, 'Watch loop interval', 0);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expectValidationMessage(page, 'Use a value of at least 1.');
    expect((await fetchSystemSettings(request)).defaults.sprintLoopSteps.watchLoopIntervalSeconds).toBe(originalInterval);
  });

  test('persists browser preview runtime settings across reload and the system settings endpoint', async ({ page, request }, testInfo) => {
    const scriptPath = `.code-ux/e2e-preview-${testInfo.workerIndex}-${testInfo.retry}.sh`;
    await openBrowser(page);

    await fillRowText(page, 'Startup script path', scriptPath);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.sprintPreview.startupScriptPath).toBe(scriptPath);

    await page.reload();
    await openBrowser(page);
    await expectRowTextValue(page, 'Startup script path', scriptPath);
  });
});
