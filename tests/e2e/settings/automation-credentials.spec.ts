import { expect, request as playwrightRequest, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { AutomationCredentialMetadata } from '../../../src/contracts/automation-credential-types.js';
import { updateAutomationCredentialViaApi } from '../helpers/e2e-api';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';
import { startUnavailableCredentialDashboardRuntime } from '../helpers/prepare-app';
import { openSettingsCategory } from './settings-test-helpers';

const SECRET_CANARY = 'BROWSER_CREDENTIAL_CANARY_8d74f02c1a';

let fixture: SeededCodeUxProject | null = null;

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

test('manages a write-only credential with durable feedback, keyboard focus, and responsive controls', async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'automation-credentials');
  const project = fixture!.project;
  await openSettingsCategory(page, 'integrations', 'Integrations');

  const card = page.locator('[data-integration-card="automation-credentials"]');
  await expect(card).toBeVisible();
  expect(await card.locator('xpath=preceding-sibling::*').count()).toBe(0);
  await expect(card).toContainText('Ready, not configured.');
  const manage = card.getByRole('button', { name: 'Manage' });
  await manage.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Automation credential management', exact: true })).toBeVisible();
  await expect(page.getByText('Secure storage ready')).toBeVisible();
  await expect(page.locator('strong').filter({ hasText: 'Ready, not configured.' })).toBeVisible();

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

test('shows safe metadata and prevents custody-dependent submissions when the explicit provider is unavailable', async ({ browser }, testInfo) => {
  const runtime = await startUnavailableCredentialDashboardRuntime();
  const isolatedRequest = await playwrightRequest.newContext({ baseURL: runtime.baseUrl });
  const context = await browser.newContext({ baseURL: runtime.baseUrl });
  const page = await context.newPage();
  let isolatedFixture: SeededCodeUxProject | null = null;

  try {
    isolatedFixture = await prepareSelectedLocalGitProject(
      page,
      isolatedRequest,
      testInfo,
      'automation-credentials-unavailable',
    );
    const project = isolatedFixture.project;
    const credentialId = randomUUID();
    const now = new Date().toISOString();
    const database = new DatabaseSync(runtime.dbPath);
    try {
      database.prepare(`
        INSERT INTO automation_credentials (
          id, name, kind, scope, project_id, management_project_id,
          allowed_project_ids_json, capabilities_json, status, key_id,
          key_version, version, last_validated_at, validation_status,
          created_at, updated_at
        ) VALUES (?, ?, 'http', 'project', ?, ?, '[]', '["read"]', 'active', ?, 1, 1, NULL, 'untested', ?, ?)
      `).run(
        credentialId,
        'Unavailable provider metadata',
        project.id,
        project.id,
        'missing-mounted-key',
        now,
        now,
      );
    } finally {
      database.close();
    }

    await openSettingsCategory(page, 'integrations', 'Integrations');
    const card = page.locator('[data-integration-card="automation-credentials"]');
    await expect(card).toContainText('Not available');
    await card.getByRole('button', { name: 'Manage' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Secure credential storage is unavailable' });
    await expect(alert).toContainText('No mounted credential key file is configured.');
    await expect(alert).toContainText('Restore the configured secure key provider, then refresh this page.');

    const metadata = page.getByText('Unavailable provider metadata', { exact: true }).locator('xpath=ancestor::li[1]');
    await expect(metadata).toContainText('http · Project-owned · metadata version 1');
    await expect(metadata).toContainText('Read');
    await expect(metadata).toContainText('Owning project only');
    await expect(page.getByText('No credential metadata is visible to this project.')).toHaveCount(0);

    await expect(page.getByLabel('Credential name')).toBeDisabled();
    await expect(page.getByLabel('Credential kind')).toBeDisabled();
    await expect(page.getByLabel('Secret value')).toBeDisabled();
    await expect(metadata.getByLabel('New secret for Unavailable provider metadata')).toBeDisabled();

    const guardedActions = [
      page.getByRole('button', { name: 'Store credential' }),
      metadata.getByRole('button', { name: 'Test' }),
      metadata.getByRole('button', { name: 'Rotate' }),
      metadata.getByRole('button', { name: 'Replace' }),
      metadata.getByRole('button', { name: 'Promote credential' }),
      metadata.getByRole('button', { name: 'Revoke' }),
    ];
    for (const action of guardedActions) {
      await expect(action).toBeDisabled();
    }

    const mutationRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/credentials')) {
        mutationRequests.push(`${request.method()} ${request.url()}`);
      }
    });
    for (const action of guardedActions) {
      await action.evaluate((button: HTMLButtonElement) => button.click());
    }
    await page.waitForTimeout(100);
    expect(mutationRequests).toEqual([]);

    const healthResponse = await isolatedRequest.get('/api/credentials/health');
    expect(healthResponse.ok(), await healthResponse.text()).toBe(true);
    expect(await healthResponse.json()).toMatchObject({
      available: false,
      secure: true,
      provider: 'mounted-key-file',
      keyId: null,
      keyVersion: null,
    });
    const listResponse = await isolatedRequest.get(`/api/projects/${encodeURIComponent(project.id)}/credentials`);
    expect(listResponse.ok(), await listResponse.text()).toBe(true);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: credentialId,
        name: 'Unavailable provider metadata',
        kind: 'http',
        configured: false,
        status: 'active',
      }),
    ]);
    await expect(page.locator('body')).not.toContainText(SECRET_CANARY);
  } finally {
    await isolatedFixture?.cleanup();
    await isolatedRequest.dispose();
    await context.close();
    await runtime.stop();
  }
});
