import { expect, test } from '@playwright/test';
import { TOOL_DEFINITIONS } from '../../../src/contracts/mcp-tool-definitions.js';
import type { McpToolToggle } from '../../../src/contracts/app-types.js';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
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
import {
  deleteProjectSettingsOverride,
  expectRowNumberValue,
  expectRowTextValue,
  fetchEffectiveProjectSettings,
  fetchProjectSettings,
  fillRowNumber,
  fillRowText,
  openSettingsCategory as openScopedSettingsCategory,
  saveSettings as saveScopedSettings,
  settingsRow,
} from '../settings/settings-test-helpers';

const advancedToolNames = TOOL_DEFINITIONS
  .filter((definition) => definition.category === 'advanced')
  .map((definition) => definition.name);

function areAdvancedMcpToolsEnabled(tools: McpToolToggle[]): boolean {
  const enabledByName = new Map(tools.map((tool) => [tool.name, tool.enabled]));
  return advancedToolNames.every((name) => enabledByName.get(name) ?? true);
}

test.describe('advanced configuration persistence', () => {
  let project: ProjectSummary | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    project = await prepareConfigPage(page, request, testInfo, 'advanced-config');
  });

  test.afterEach(async ({ request }) => {
    if (project) {
      await deleteProjectSettingsOverride(request, project.id);
      project = null;
    }
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

  test('persists project runtime overrides, inherited defaults, invalid inputs, and disabled provider controls', async ({ page, request }, testInfo) => {
    if (!project) {
      throw new Error('Advanced config project fixture was not initialized.');
    }

    const initialEffective = await fetchEffectiveProjectSettings(request, project.id);
    expect(initialEffective.sources['cliWorkflow.containerImage']).toBe('system');
    expect(initialEffective.sources['workers.maxConcurrency']).toBe('system');

    const prefix = testInfo.title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const containerImage = `node:22-e2e-${prefix.slice(0, 20)}`;
    const maxConcurrency = 7;

    await openScopedSettingsCategory(page, 'general', /General Scope, runtime, and automation posture/i, 'Project');
    await fillRowText(page, 'Container image', containerImage);
    await expectRowTextValue(page, 'Container image', containerImage);
    await saveScopedSettings(page);

    await expect.poll(async () => {
      const effective = await fetchEffectiveProjectSettings(request, project.id);
      return {
        value: effective.settings.cliWorkflow.containerImage,
        source: effective.sources['cliWorkflow.containerImage'],
      };
    }).toEqual({ value: containerImage, source: 'project' });

    await openScopedSettingsCategory(page, 'models', /AI Models Provider routing, models, and weighting/i, 'Project');
    const globalModelControl = settingsRow(page, 'Global default model').getByRole('button').first();
    await expect(globalModelControl).toBeDisabled();

    await fillRowNumber(page, 'Max concurrency', 0);
    await expect(page.getByText('Use a value of at least 1.')).toBeVisible();
    await fillRowNumber(page, 'Max concurrency', maxConcurrency);
    await expectRowNumberValue(page, 'Max concurrency', maxConcurrency);
    await saveScopedSettings(page);

    await expect.poll(async () => {
      const effective = await fetchEffectiveProjectSettings(request, project.id);
      return {
        value: effective.settings.workers.maxConcurrency,
        source: effective.sources['workers.maxConcurrency'],
      };
    }).toEqual({ value: maxConcurrency, source: 'project' });

    const savedProjectSettings = await fetchProjectSettings(request, project.id);
    expect(savedProjectSettings.cliWorkflow?.containerImage).toBe(containerImage);
    expect(savedProjectSettings.workers?.maxConcurrency).toBe(maxConcurrency);

    await page.reload();
    await openScopedSettingsCategory(page, 'general', /General Scope, runtime, and automation posture/i, 'Project');
    await expectRowTextValue(page, 'Container image', containerImage);
    await openScopedSettingsCategory(page, 'models', /AI Models Provider routing, models, and weighting/i, 'Project');
    await expectRowNumberValue(page, 'Max concurrency', maxConcurrency);
  });
});
