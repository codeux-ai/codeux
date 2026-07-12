import { expect, test, type Page } from '@playwright/test';
import { TOOL_DEFINITIONS } from '../../../src/contracts/mcp-tool-definitions.js';
import type { McpToolToggle } from '../../../src/contracts/app-types.js';
import {
  expectRowSwitch,
  fetchSystemSettings,
  openConfigPage,
  openSettingsCategory,
  openSettingsSection,
  prepareConfigPage,
  saveSettings,
  setRowSwitch,
  settingsPanel,
} from './config-test-helpers';

const advancedToolNames = TOOL_DEFINITIONS
  .filter((definition) => definition.category === 'advanced')
  .map((definition) => definition.name);

function areAdvancedMcpToolsEnabled(tools: McpToolToggle[]): boolean {
  const enabledByName = new Map(tools.map((tool) => [tool.name, tool.enabled]));
  return advancedToolNames.every((name) => enabledByName.get(name) ?? true);
}

async function openAdvancedMcpTools(page: Page): Promise<void> {
  await openSettingsCategory(page, 'MCP', 'MCP Servers');
  await settingsPanel(page)
    .getByText('Code UX (built-in)', { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="Configure"]][1]')
    .getByRole('button', { name: 'Configure', exact: true })
    .click();
  await expect(settingsPanel(page).getByRole('heading', { name: 'Built-in MCP (Code UX)', exact: true })).toBeVisible();
  await openSettingsSection(page, 'Advanced');
}

test.describe('advanced configuration persistence', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await prepareConfigPage(page, request, testInfo, 'advanced-config');
  });

  test('persists MCP, integrations, memory, and automation settings across reloads', async ({ page, request }) => {
    const initialSettings = await fetchSystemSettings(request);
    const targetMcpAdvancedEnabled = !areAdvancedMcpToolsEnabled(initialSettings.mcpTools);
    const targetJiraAutoClose = !initialSettings.integrations.jira.autoCloseLinkedIssues;
    const targetMemoryEnabled = !initialSettings.defaults.memory.enabled;
    const targetAutoResumePaused = !initialSettings.defaults.automationInterventions.autoResumePaused;

    await openConfigPage(page);

    await openAdvancedMcpTools(page);
    await setRowSwitch(page, 'Enable all advanced tools', targetMcpAdvancedEnabled);
    await saveSettings(page);
    await expect.poll(async () => areAdvancedMcpToolsEnabled((await fetchSystemSettings(request)).mcpTools)).toBe(targetMcpAdvancedEnabled);

    await openSettingsCategory(page, 'Integrations', 'Integrations');
    await settingsPanel(page)
      .getByText('Jira', { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Manage"]][1]')
      .getByRole('button', { name: 'Manage' })
      .click();
    await expect(page.getByText('Jira Configuration')).toBeVisible();
    await setRowSwitch(page, 'Auto-close Jira issues', targetJiraAutoClose);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).integrations.jira.autoCloseLinkedIssues).toBe(targetJiraAutoClose);

    await openSettingsCategory(page, 'Memory', 'Memory System');
    await openSettingsSection(page, 'Memory System');
    await setRowSwitch(page, 'Enable memory', targetMemoryEnabled);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.memory.enabled).toBe(targetMemoryEnabled);

    await openSettingsCategory(page, 'General', 'Automation');
    await openSettingsSection(page, 'Automation');
    await setRowSwitch(page, 'Auto-resume paused runs', targetAutoResumePaused);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.automationInterventions.autoResumePaused).toBe(targetAutoResumePaused);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();

    await openAdvancedMcpTools(page);
    await expectRowSwitch(page, 'Enable all advanced tools', targetMcpAdvancedEnabled);

    await openSettingsCategory(page, 'Integrations', 'Integrations');
    await settingsPanel(page)
      .getByText('Jira', { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Manage"]][1]')
      .getByRole('button', { name: 'Manage' })
      .click();
    await expectRowSwitch(page, 'Auto-close Jira issues', targetJiraAutoClose);

    await openSettingsCategory(page, 'Memory', 'Memory System');
    await openSettingsSection(page, 'Memory System');
    await expectRowSwitch(page, 'Enable memory', targetMemoryEnabled);

    await openSettingsCategory(page, 'General', 'Automation');
    await openSettingsSection(page, 'Automation');
    await expectRowSwitch(page, 'Auto-resume paused runs', targetAutoResumePaused);
  });
});
