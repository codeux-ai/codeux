import { expect, test } from '@playwright/test';
import { TOOL_DEFINITIONS } from '../../../src/contracts/mcp-tool-definitions.js';
import type { McpToolToggle } from '../../../src/contracts/app-types.js';
import {
  expectRowSwitch,
  fetchSystemSettings,
  openConfigPage,
  openSettingsCategory,
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

    await openSettingsCategory(page, /MCP MCP servers injected into CLIs and built-in tool access/i, 'MCP Servers');
    await page.getByRole('button', { name: 'Configure' }).click();
    await expect(page.getByText('Built-in MCP (Code UX)')).toBeVisible();
    await setRowSwitch(page, 'Enable all advanced tools', targetMcpAdvancedEnabled);
    await saveSettings(page);
    await expect.poll(async () => areAdvancedMcpToolsEnabled((await fetchSystemSettings(request)).mcpTools)).toBe(targetMcpAdvancedEnabled);

    await openSettingsCategory(page, /Integrations Provider keys, Git hosts, and external connection policy/i, 'Integrations');
    await settingsPanel(page)
      .getByText('Jira', { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Manage"]][1]')
      .getByRole('button', { name: 'Manage' })
      .click();
    await expect(page.getByText('Jira Configuration')).toBeVisible();
    await setRowSwitch(page, 'Auto-close Jira issues', targetJiraAutoClose);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).integrations.jira.autoCloseLinkedIssues).toBe(targetJiraAutoClose);

    await openSettingsCategory(page, /Memory Embedding models, auto-capture, and promotion policy/i, 'Memory System');
    await setRowSwitch(page, 'Enable memory', targetMemoryEnabled);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.memory.enabled).toBe(targetMemoryEnabled);

    await openSettingsCategory(page, /General Scope, runtime, and automation posture/i, 'Automation');
    await setRowSwitch(page, 'Auto-resume paused runs', targetAutoResumePaused);
    await saveSettings(page);
    await expect.poll(async () => (await fetchSystemSettings(request)).defaults.automationInterventions.autoResumePaused).toBe(targetAutoResumePaused);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();

    await openSettingsCategory(page, /MCP MCP servers injected into CLIs and built-in tool access/i, 'MCP Servers');
    await page.getByRole('button', { name: 'Configure' }).click();
    await expectRowSwitch(page, 'Enable all advanced tools', targetMcpAdvancedEnabled);

    await openSettingsCategory(page, /Integrations Provider keys, Git hosts, and external connection policy/i, 'Integrations');
    await settingsPanel(page)
      .getByText('Jira', { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Manage"]][1]')
      .getByRole('button', { name: 'Manage' })
      .click();
    await expectRowSwitch(page, 'Auto-close Jira issues', targetJiraAutoClose);

    await openSettingsCategory(page, /Memory Embedding models, auto-capture, and promotion policy/i, 'Memory System');
    await expectRowSwitch(page, 'Enable memory', targetMemoryEnabled);

    await openSettingsCategory(page, /General Scope, runtime, and automation posture/i, 'Automation');
    await expectRowSwitch(page, 'Auto-resume paused runs', targetAutoResumePaused);
  });
});
