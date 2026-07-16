import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type {
  EffectiveSettingsResponse,
  ProjectSettingsOverride,
  SystemSettings,
} from '../../../src/contracts/settings-scope-types.js';

export async function openSettingsCategory(
  page: Page,
  categoryId: string,
  categoryName: string,
  scope: 'System' | 'Project' = 'System',
): Promise<void> {
  await page.goto('/config');
  await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
  await selectSettingsScope(page, scope);
  const activeCategory = page.locator(`[data-active-category="${categoryId}"]`);
  if (await activeCategory.isVisible()) {
    return;
  }
  const categoryButton = page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: categoryName });
  await expect(categoryButton).toBeVisible();
  await categoryButton.click();
  await expect(activeCategory).toBeVisible();
}

export async function openSettingsSection(
  page: Page,
  title: string,
  configureName = `Configure ${title}`,
): Promise<void> {
  const panel = page.getByRole('region', { name: 'Settings category panel' });
  const heading = panel.getByRole('heading', { name: title, exact: true });
  const backButton = panel.getByRole('button', { name: 'Back to category overview', exact: true });

  if (await heading.isVisible() && await backButton.isVisible()) {
    return;
  }

  if (await backButton.isVisible()) {
    await backButton.click();
  }

  const configureButton = panel.getByRole('button', { name: configureName, exact: true });
  await expect(configureButton).toBeVisible();
  await configureButton.click();
  await expect(heading).toBeVisible();
  await expect(backButton).toBeVisible();
}

export async function selectSettingsScope(page: Page, scope: 'System' | 'Project'): Promise<void> {
  const scopeGroup = page.getByRole('radiogroup', { name: 'Settings scope' });
  const scopeRadio = scopeGroup.getByRole('radio', { name: scope, exact: true });
  if (await scopeRadio.getAttribute('aria-checked') !== 'true') {
    await scopeRadio.click();
  }
  await expect(scopeRadio).toHaveAttribute('aria-checked', 'true');
}

export function settingsRow(page: Page, label: string): Locator {
  return page
    .getByText(label, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "md:flex-row")][1]');
}

export async function fillRowText(page: Page, label: string, value: string): Promise<void> {
  const row = settingsRow(page, label);
  await row.getByRole('textbox').first().fill(value);
}

export async function expectRowTextValue(page: Page, label: string, value: string): Promise<void> {
  const row = settingsRow(page, label);
  await expect(row.getByRole('textbox').first()).toHaveValue(value);
}

export async function fillRowNumber(page: Page, label: string, value: number): Promise<void> {
  const row = settingsRow(page, label);
  await row.getByRole('spinbutton').first().fill(String(value));
}

export async function expectRowNumberValue(page: Page, label: string, value: number): Promise<void> {
  const row = settingsRow(page, label);
  await expect(row.getByRole('spinbutton').first()).toHaveValue(String(value));
}

export async function toggleRowSwitch(page: Page, label: string): Promise<boolean> {
  const toggle = settingsRow(page, label).getByRole('switch').first();
  const nextValue = (await toggle.getAttribute('aria-checked')) !== 'true';
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(nextValue));
  return nextValue;
}

export async function selectRowOption(page: Page, label: string, optionName: RegExp): Promise<void> {
  const row = settingsRow(page, label);
  await row.getByRole('button').first().click();
  await page.getByRole('option', { name: optionName }).click();
}

export async function chooseRadio(page: Page, name: RegExp): Promise<void> {
  const radio = page.getByRole('radio', { name }).first();
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

export async function expectUnsavedIndicator(page: Page): Promise<void> {
  await expect(page.getByText('Unsaved edits').first()).toBeVisible();
}

export async function expectValidationMessage(page: Page, message: string): Promise<void> {
  await expect(page.getByRole('alert').filter({ hasText: message }).first()).toBeVisible();
}

export async function saveSettings(page: Page): Promise<void> {
  const saveButton = page.getByRole('button', { name: 'Save Changes' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<void> {
  expect(response.ok(), await response.text()).toBe(true);
}

export async function fetchSystemSettings(request: APIRequestContext): Promise<SystemSettings> {
  const response = await request.get('/api/system-settings');
  await expectOk(response);
  return await response.json() as SystemSettings;
}

export async function fetchProjectSettings(
  request: APIRequestContext,
  projectId: string,
): Promise<ProjectSettingsOverride> {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/settings`);
  await expectOk(response);
  return await response.json() as ProjectSettingsOverride;
}

export async function saveProjectSettingsOverride(
  request: APIRequestContext,
  projectId: string,
  settings: ProjectSettingsOverride,
): Promise<ProjectSettingsOverride> {
  const response = await request.put(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    headers: { 'Content-Type': 'application/json' },
    data: settings,
  });
  await expectOk(response);
  return await response.json() as ProjectSettingsOverride;
}

export async function deleteProjectSettingsOverride(
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  const response = await request.delete(`/api/projects/${encodeURIComponent(projectId)}/settings`);
  await expectOk(response);
}

export async function fetchEffectiveProjectSettings(
  request: APIRequestContext,
  projectId: string,
): Promise<EffectiveSettingsResponse> {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/settings/effective`);
  await expectOk(response);
  return await response.json() as EffectiveSettingsResponse;
}

export function valueAtPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}
