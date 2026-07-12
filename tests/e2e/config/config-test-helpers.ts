import { expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import type { SystemSettings } from '../../../src/contracts/settings-scope-types.js';
import {
  completeOnboarding,
  ensureSelectedProject,
  suppressDashboardTour,
} from '../helpers/prepare-app';

export async function prepareConfigPage(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<ProjectSummary> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  return ensureSelectedProject(request, { testInfo, fixtureKey });
}

export async function fetchSystemSettings(request: APIRequestContext): Promise<SystemSettings> {
  const response = await request.get('/api/system-settings');
  expect(response.status(), await response.text()).toBe(200);
  return await response.json() as SystemSettings;
}

export async function openConfigPage(page: Page): Promise<void> {
  await page.goto('/config');
  await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Settings category panel' })).toBeVisible();
}

export async function openSettingsCategory(page: Page, name: string, panelText: string | RegExp): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name, exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Settings category panel' });
  await expect(panel).toContainText(panelText);
}

export async function openSettingsSection(page: Page, title: string): Promise<void> {
  const panel = settingsPanel(page);
  await panel.getByRole('button', { name: `Configure ${title}`, exact: true }).click();
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Back to category overview', exact: true })).toBeVisible();
}

export async function returnToSettingsCategoryOverview(page: Page): Promise<void> {
  const panel = settingsPanel(page);
  await panel.getByRole('button', { name: 'Back to category overview', exact: true }).click();
  await expect(panel.getByRole('button', { name: /^Configure / }).first()).toBeVisible();
}

export function settingsPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Settings category panel' });
}

export function settingRow(page: Page, label: string): Locator {
  return settingsPanel(page)
    .getByText(label, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "group")][1]');
}

export async function setRowSwitch(page: Page, label: string, value: boolean): Promise<void> {
  const row = settingRow(page, label);
  const toggle = row.getByRole('switch').first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== String(value)) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', String(value));
}

export async function expectRowSwitch(page: Page, label: string, value: boolean): Promise<void> {
  await expect(settingRow(page, label).getByRole('switch').first()).toHaveAttribute('aria-checked', String(value));
}

export async function chooseRowRadio(page: Page, label: string, optionName: RegExp): Promise<void> {
  const option = settingRow(page, label).getByRole('radio', { name: optionName });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
}

export function saveButton(page: Page): Locator {
  return page
    .locator('[data-settings-sticky="settings-command-status"]')
    .getByRole('button', { name: /Save Changes/i });
}

export async function saveSettings(page: Page): Promise<void> {
  const button = saveButton(page);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(settingsPanel(page)).toContainText(/Changes saved\.|settings saved\./i);
}
