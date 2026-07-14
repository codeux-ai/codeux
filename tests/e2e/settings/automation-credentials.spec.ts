import { expect, test } from '@playwright/test';
import type { AutomationCredentialMetadata } from '../../../src/contracts/automation-credential-types.js';
import { updateAutomationCredentialViaApi } from '../helpers/e2e-api';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';
import { openSettingsCategory } from './settings-test-helpers';

const SECRET_CANARY = 'BROWSER_CREDENTIAL_CANARY_8d74f02c1a';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'automation-credentials');
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

test('manages a write-only credential with durable feedback, keyboard focus, and responsive controls', async ({ page, request }) => {
  const project = fixture!.project;
  await openSettingsCategory(page, 'integrations', 'Integrations');

  const card = page.locator('[data-integration-card="automation-credentials"]');
  await expect(card).toBeVisible();
  expect(await card.locator('xpath=preceding-sibling::*').count()).toBe(0);
  await expect(card).toContainText('Ready · not configured');
  const manage = card.getByRole('button', { name: 'Manage' });
  await manage.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Automation Credentials', exact: true })).toBeVisible();
  await expect(page.getByText('Secure storage ready')).toBeVisible();
  await expect(page.getByText(/Ready, not configured/)).toBeVisible();

  await page.getByLabel('Credential name').fill('Browser jobs credential');
  await page.getByLabel('Credential kind').fill('http');
  await page.getByLabel('Secret value').fill(SECRET_CANARY);
  await page.getByRole('checkbox', { name: /^Read/ }).check();
  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(`/api/projects/${encodeURIComponent(project.id)}/credentials`)
    && response.status() === 201
  ));
  await page.getByRole('button', { name: 'Store credential' }).click();
  const created = await (await createResponsePromise).json() as AutomationCredentialMetadata;

  await expect(page.getByText('Credential stored. Its secret value is no longer present in this page.')).toBeVisible();
  await expect(page.getByLabel('Secret value')).toHaveValue('');
  await expect(page.getByText(/Configured\. 1 active credential is ready/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET_CANARY);

  const externallyUpdated = await updateAutomationCredentialViaApi(request, project.id, created.id, {
    name: 'Externally refreshed credential',
    expectedVersion: created.version,
  });
  expect(externallyUpdated.version).toBe(created.version + 1);

  let item = page.getByText('Browser jobs credential', { exact: true }).locator('xpath=ancestor::li[1]');
  await item.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'changed in another session' })).toBeVisible();
  item = page.getByText('Externally refreshed credential', { exact: true }).locator('xpath=ancestor::li[1]');
  await item.getByRole('button', { name: 'Test' }).click();
  await expect(item.getByRole('status')).toContainText('Credential test passed.');

  const rotatedValue = `${SECRET_CANARY}_ROTATED`;
  const secretInput = item.getByLabel('New secret for Externally refreshed credential');
  await secretInput.fill(rotatedValue);
  const rotate = item.getByRole('button', { name: 'Rotate' });
  await rotate.focus();
  await rotate.click();
  const dialog = page.getByRole('dialog', { name: 'Rotate Externally refreshed credential?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Rotate value' }).click();
  await expect(item.getByRole('status')).toContainText('Credential value rotated and cleared from this page.');
  await expect(secretInput).toHaveValue('');
  await expect.poll(async () => item.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Automation credential management' })).toBeVisible();
  await expect(page.getByLabel('Rename Externally refreshed credential')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  const listed = await request.get(`/api/projects/${encodeURIComponent(project.id)}/credentials`);
  expect(listed.ok(), await listed.text()).toBe(true);
  const publicText = JSON.stringify(await listed.json());
  expect(publicText).not.toContain(SECRET_CANARY);
  await expect(page.locator('body')).not.toContainText(SECRET_CANARY);
});
