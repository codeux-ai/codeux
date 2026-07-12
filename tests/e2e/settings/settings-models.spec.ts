import { expect, test, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';
import {
  expectRowNumberValue,
  expectUnsavedIndicator,
  expectValidationMessage,
  fetchSystemSettings,
  fillRowNumber,
  openSettingsCategory,
  openSettingsSection,
  saveSettings,
  settingsRow,
  toggleRowSwitch,
} from './settings-test-helpers';

async function openModels(page: Page): Promise<void> {
  await openSettingsCategory(page, 'models', 'AI Models');
  await openSettingsSection(page, 'Default Routing Anchors');
}

async function openAgents(page: Page): Promise<void> {
  await openSettingsCategory(page, 'agents', 'Agents');
  await openSettingsSection(page, 'Project Markdown Mirror', 'Configure file sync Project Markdown Mirror');
}

async function openMemory(page: Page): Promise<void> {
  await openSettingsCategory(page, 'memory', 'Memory');
  await openSettingsSection(page, 'Limits');
}

test.describe('settings models agents and memory panels', () => {
  let project: ProjectSummary;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'settings-models' });
    await suppressDashboardTour(page);
  });

  test('persists model worker concurrency across reload and the system settings endpoint', async ({ page, request }) => {
    expect(project.id).toBeTruthy();
    await openModels(page);

    await fillRowNumber(page, 'Max concurrency', 7);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.workers.maxConcurrency).toBe(7);

    await page.reload();
    await openModels(page);
    await expectRowNumberValue(page, 'Max concurrency', 7);
  });

  test('rejects invalid model dispatch timeout before saving', async ({ page, request }) => {
    const originalTimeout = (await fetchSystemSettings(request)).defaults.workers.timeoutSeconds;
    await openModels(page);

    await fillRowNumber(page, 'Dispatch timeout', 30);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expectValidationMessage(page, 'Use a value of at least 60.');
    expect((await fetchSystemSettings(request)).defaults.workers.timeoutSeconds).toBe(originalTimeout);
  });

  test('persists agent markdown mirror settings across reload and the system settings endpoint', async ({ page, request }) => {
    await openAgents(page);

    const savedValue = await toggleRowSwitch(page, 'Save agent markdown to project directory');
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.agents.saveToProjectDirectory).toBe(savedValue);

    await page.reload();
    await openAgents(page);
    await expect(settingsRow(page, 'Save agent markdown to project directory').getByRole('switch')).toHaveAttribute('aria-checked', String(savedValue));
  });

  test('persists memory limits across reload and the system settings endpoint', async ({ page, request }) => {
    const currentLimit = (await fetchSystemSettings(request)).defaults.memory.maxProjectMemories;
    const nextLimit = currentLimit === 1_060 ? 1_110 : 1_060;
    await openMemory(page);

    await fillRowNumber(page, 'Max project memories', nextLimit);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.memory.maxProjectMemories).toBe(nextLimit);

    await page.reload();
    await openMemory(page);
    await expectRowNumberValue(page, 'Max project memories', nextLimit);
  });
});
