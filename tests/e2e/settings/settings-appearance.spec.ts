import { expect, test, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';
import {
  chooseRadio,
  expectUnsavedIndicator,
  expectValidationMessage,
  fetchSystemSettings,
  fillRowNumber,
  openSettingsCategory,
  openSettingsSection,
  saveSettings,
  settingsRow,
} from './settings-test-helpers';

async function openAppearance(page: Page): Promise<void> {
  await openSettingsCategory(page, 'appearance', 'Appearance');
  await openSettingsSection(page, 'Display Settings');
}

async function openIntegrations(page: Page): Promise<void> {
  await openSettingsCategory(page, 'integrations', 'Integrations');
}

async function openMcp(page: Page): Promise<void> {
  await openSettingsCategory(page, 'mcp', 'MCP');
}

function integrationCard(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "min-h-[156px]")][1]');
}

test.describe('settings appearance integrations and mcp panels', () => {
  let project: ProjectSummary;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'settings-appearance' });
    await suppressDashboardTour(page);
  });

  test('persists appearance navigation mode across reload and the system settings endpoint', async ({ page, request }) => {
    expect(project.id).toBeTruthy();
    await openAppearance(page);

    const currentMode = (await fetchSystemSettings(request)).defaults.appearance.navigationMode;
    const nextMode = currentMode === 'SIDEBAR' ? 'DOCK' : 'SIDEBAR';
    await chooseRadio(page, nextMode === 'SIDEBAR' ? /Sidebar/i : /Dock/i);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.appearance.navigationMode).toBe(nextMode);

    await page.reload();
    await openAppearance(page);
    await expect(page.getByRole('radio', { name: nextMode === 'SIDEBAR' ? /Sidebar/i : /Dock/i })).toHaveAttribute('aria-checked', 'true');
  });

  test('persists Notion importer settings across reload and the system settings endpoint', async ({ page, request }) => {
    await openIntegrations(page);
    await integrationCard(page, 'Notion').getByRole('button', { name: 'Manage' }).click();
    await expect(page.getByRole('heading', { name: 'Notion Configuration' })).toBeVisible();

    await fillRowNumber(page, 'Search limit', 42);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => (await fetchSystemSettings(request)).integrations.notion.defaultSearchLimit).toBe(42);

    await page.reload();
    await openIntegrations(page);
    await integrationCard(page, 'Notion').getByRole('button', { name: 'Manage' }).click();
    await expect(settingsRow(page, 'Search limit').getByRole('spinbutton')).toHaveValue('42');
  });

  test('rejects invalid importer search limits before saving', async ({ page, request }) => {
    const originalLimit = (await fetchSystemSettings(request)).integrations.notion.defaultSearchLimit;
    await openIntegrations(page);
    await integrationCard(page, 'Notion').getByRole('button', { name: 'Manage' }).click();

    await fillRowNumber(page, 'Search limit', 0);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expectValidationMessage(page, 'Use a value of at least 1.');
    expect((await fetchSystemSettings(request)).integrations.notion.defaultSearchLimit).toBe(originalLimit);
  });

  test('persists custom MCP server settings across reload and the system settings endpoint', async ({ page, request }, testInfo) => {
    const serverKey = `e2e_mcp_${testInfo.workerIndex}_${testInfo.retry}`;
    const serverLabel = `E2E MCP ${testInfo.workerIndex}-${testInfo.retry}`;
    await openMcp(page);

    await page.getByRole('button', { name: 'Add MCP server' }).click();
    await expect(page.getByRole('heading', { name: 'MCP server' })).toBeVisible();
    await openSettingsSection(page, 'MCP server');
    await settingsRow(page, 'Display name').getByRole('textbox').fill(serverLabel);
    await settingsRow(page, 'Server key').getByRole('textbox').fill(serverKey);
    await settingsRow(page, 'Server URL').getByRole('textbox').fill('https://example.test/mcp');
    await settingsRow(page, 'Description').getByRole('textbox').fill('E2E settings persistence server');
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => {
      const settings = await fetchSystemSettings(request);
      return settings.customMcpServers.find((server) => server.name === serverKey)?.label ?? null;
    }).toBe(serverLabel);

    await page.reload();
    await openMcp(page);
    await expect(page.getByText(serverLabel)).toBeVisible();
  });
});
