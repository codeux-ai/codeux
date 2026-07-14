import { expect, test, type APIRequestContext } from '@playwright/test';
import type { CustomDashboardRecord } from '../../../src/contracts/custom-dashboard-types.js';
import {
  createAutomationCredentialViaApi,
  createCustomDashboardViaApi,
} from '../helpers/e2e-api';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

const SECRET_CANARY = 'CUSTOM_DASHBOARD_BROWSER_CANARY_b7a460d1';

type BindingReview = {
  credentialBindingRevision: number;
  valid: boolean;
};

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'custom-dashboard-credentials');
  await page.addInitScript(() => {
    (window as Window & { __credentialIframeMessages?: unknown[] }).__credentialIframeMessages = [];
    window.addEventListener('message', (event) => {
      (window as Window & { __credentialIframeMessages: unknown[] }).__credentialIframeMessages.push(event.data);
    });
  });
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function putBinding(
  request: APIRequestContext,
  projectId: string,
  dashboardId: string,
  input: { slotId: string; credentialId: string; expectedBindingRevision: number },
): Promise<BindingReview> {
  const response = await request.put(
    `/api/projects/${encodeURIComponent(projectId)}/custom-dashboards/${encodeURIComponent(dashboardId)}/credential-bindings`,
    { headers: { 'Content-Type': 'application/json' }, data: input },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as BindingReview;
}

test('binds declared build and runtime slots, recovers from conflict, blocks invalid publication, and preserves legacy dashboards', async ({ page, request }) => {
  const project = fixture!.project;
  const primary = await createAutomationCredentialViaApi(request, project.id, {
    name: 'Primary metrics credential',
    kind: 'http.token',
    value: SECRET_CANARY,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: ['metrics.read'],
  });
  const replacement = await createAutomationCredentialViaApi(request, project.id, {
    name: 'Replacement metrics credential',
    kind: 'http.token',
    value: `${SECRET_CANARY}_REPLACEMENT`,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: ['metrics.read'],
  });

  const dashboard = await createCustomDashboardViaApi(request, project.id, {
    title: 'Credential slots dashboard',
    description: 'Browser fixture for declared build and runtime credentials.',
    manifest: {
      schemaVersion: 1,
      title: 'Credential slots dashboard',
      entryFile: 'src/dashboard.tsx',
      filePaths: ['src/dashboard.tsx'],
      credentialSlots: [
        {
          slotId: 'build_metrics',
          label: 'Build metrics API',
          phase: 'build',
          required: true,
          allowedKinds: ['http.token'],
          requiredCapabilities: ['metrics.read'],
        },
        {
          slotId: 'runtime_metrics',
          label: 'Runtime metrics API',
          phase: 'runtime',
          required: false,
          allowedKinds: ['http.token'],
          requiredCapabilities: ['metrics.read'],
        },
      ],
    },
    fileBundle: {
      files: [{
        path: 'src/dashboard.tsx',
        content: 'export default function Dashboard() { return null; }',
        contentType: 'text/typescript-jsx',
      }],
    },
  });
  const legacy = await createCustomDashboardViaApi(request, project.id, {
    title: 'Legacy no-slot dashboard',
    manifest: {
      schemaVersion: 1,
      title: 'Legacy no-slot dashboard',
      entryFile: 'src/dashboard.tsx',
      filePaths: ['src/dashboard.tsx'],
    },
    fileBundle: {
      files: [{ path: 'src/dashboard.tsx', content: 'export default null;', contentType: 'text/typescript-jsx' }],
    },
  });

  await page.goto('/custom-dashboards');
  await expect(page.getByRole('heading', { name: 'Dashboard Workspace' })).toBeVisible();
  const library = page.getByRole('region', { name: 'Custom dashboards' });
  await library.getByRole('button', { name: /Credential slots dashboard/ }).click();
  const credentialsTab = page.getByRole('tab', { name: 'Credentials' });
  await expect(credentialsTab).toBeVisible();
  await credentialsTab.click();

  const panel = page.getByRole('region', { name: 'Dashboard credential slots' });
  await expect(panel.getByText('Credential declarations need attention before the next revision is publication-ready.')).toBeVisible();
  const buildSelect = panel.getByLabel('Compatible credential for Build metrics API');
  await buildSelect.selectOption(primary.id);
  const buildBind = panel.getByRole('button', { name: 'Bind credential for Build metrics API', exact: true });
  await buildBind.click();
  await expect(panel.getByText('Compatible binding').first()).toBeVisible();
  await expect(panel.getByText('Credential declarations are ready to be included in the next revision.')).toBeVisible();
  await expect(buildSelect).toBeFocused();

  const externallyBound = await putBinding(request, project.id, dashboard.id, {
    slotId: 'runtime_metrics',
    credentialId: primary.id,
    expectedBindingRevision: 2,
  });
  expect(externallyBound.credentialBindingRevision).toBe(3);

  await buildSelect.selectOption(replacement.id);
  await panel.getByRole('button', { name: 'Replace binding for Build metrics API', exact: true }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'Bindings changed in another session.' })).toBeVisible();
  await buildSelect.selectOption(replacement.id);
  const replaceButton = panel.getByRole('button', { name: 'Replace binding for Build metrics API', exact: true });
  await replaceButton.click();
  await expect(panel.getByText('Replacement metrics credential', { exact: true }).first()).toBeVisible();
  await expect(buildSelect).toBeFocused();

  await panel.getByRole('button', { name: 'Unbind credential for Build metrics API', exact: true }).click();
  await expect(panel.getByText('Credential declarations need attention before the next revision is publication-ready.')).toBeVisible();
  await expect(panel.getByRole('alert').filter({ hasText: /requires a binding/i })).toBeVisible();

  const revisionResponse = await request.post(`/api/custom-dashboards/${encodeURIComponent(dashboard.id)}/revisions`, {
    headers: { 'Content-Type': 'application/json' },
    data: {},
  });
  expect(revisionResponse.status()).toBe(201);
  const revision = await revisionResponse.json() as { id: string };
  const blockedPublication = await request.post(
    `/api/custom-dashboards/${encodeURIComponent(dashboard.id)}/revisions/${encodeURIComponent(revision.id)}/publish`,
    { headers: { 'Content-Type': 'application/json' }, data: {} },
  );
  expect(blockedPublication.status()).toBe(400);
  const blockedBody = await blockedPublication.text();
  expect(blockedBody).toMatch(/requires a binding/i);
  expect(blockedBody).not.toContain(SECRET_CANARY);

  await buildSelect.selectOption(primary.id);
  await panel.getByRole('button', { name: 'Bind credential for Build metrics API', exact: true }).click();
  await expect(panel.getByText('Credential declarations are ready to be included in the next revision.')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel('Compatible credential for Runtime metrics API')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  const legacyDashboardButton = library.getByRole('button', { name: /Legacy no-slot dashboard/ });
  await legacyDashboardButton.focus();
  await expect(legacyDashboardButton).toBeFocused();
  await legacyDashboardButton.press('Enter');
  await expect(page.getByRole('tab', { name: 'Manifest' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Credentials' })).toHaveCount(0);

  const genericResponses: CustomDashboardRecord[] = [];
  for (const target of [dashboard, legacy]) {
    const response = await request.get(`/api/custom-dashboards/${encodeURIComponent(target.id)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as { dashboard: CustomDashboardRecord };
    genericResponses.push(body.dashboard);
  }
  const iframeMessages = await page.evaluate(() => (
    (window as Window & { __credentialIframeMessages?: unknown[] }).__credentialIframeMessages ?? []
  ));
  expect(JSON.stringify({ genericResponses, iframeMessages })).not.toContain(SECRET_CANARY);
  await expect(page.locator('body')).not.toContainText(SECRET_CANARY);
});
