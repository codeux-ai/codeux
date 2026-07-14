import { expect, test } from '@playwright/test';
import type { NodeFlowGraph } from '../../../src/contracts/node-flow-types.js';
import {
  createAutomationCredentialViaApi,
  createNodeFlowDraftViaApi,
} from '../helpers/e2e-api';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

const SECRET_CANARY = 'NODE_BINDING_CANARY_52b1f493ce';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'node-credential-bindings');
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

test('replaces and removes a node credential, refreshes review, publishes, and executes the governed flow', async ({ page, request }) => {
  const project = fixture!.project;
  const primary = await createAutomationCredentialViaApi(request, project.id, {
    name: 'Primary provider credential',
    kind: 'provider',
    value: SECRET_CANARY,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: ['read'],
  });
  const replacement = await createAutomationCredentialViaApi(request, project.id, {
    name: 'Replacement provider credential',
    kind: 'provider',
    value: `${SECRET_CANARY}_REPLACEMENT`,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: ['read'],
  });
  await createAutomationCredentialViaApi(request, project.id, {
    name: 'Wrong kind credential',
    kind: 'http',
    value: `${SECRET_CANARY}_WRONG_KIND`,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: ['read'],
  });
  await createAutomationCredentialViaApi(request, project.id, {
    name: 'Insufficient capability credential',
    kind: 'provider',
    value: `${SECRET_CANARY}_INSUFFICIENT`,
    scope: 'project',
    allowedProjectIds: [],
    capabilities: [],
  });

  const graph: NodeFlowGraph = {
    nodes: [{
      id: 'provider-step',
      type: 'provider_prompt',
      title: 'Credentialed provider step',
      definition: { type: 'provider_prompt', version: 1 },
      data: { provider: 'codex', prompt: 'Return a deterministic local fixture response.' },
      credentialBindings: [{ slot: 'provider', credentialId: primary.id }],
    }],
    edges: [],
  };
  const draft = await createNodeFlowDraftViaApi(request, project.id, {
    title: 'Credential binding browser flow',
    description: 'Exercises metadata-only node credential selection.',
    graph,
  });
  expect(draft.valid).toBe(true);

  await page.goto('/nodes');
  await expect(page.getByRole('heading', { name: 'Automation workspace' })).toBeVisible();
  await expect(page.getByText('Credential binding browser flow', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select node Credentialed provider step' })).toBeVisible();

  const picker = page.getByRole('button', { name: 'Choose credential for Provider connection' });
  await picker.click();
  const menu = page.getByRole('menu', { name: 'Credential picker for Provider connection' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/Wrong kind credential · http/)).toBeVisible();
  await expect(menu.getByText(/Requires one of these kinds: provider/)).toBeVisible();
  await expect(menu.getByText(/Insufficient capability credential · provider/)).toBeVisible();
  await expect(menu.getByText(/Missing required access: read/)).toBeVisible();
  await menu.getByText('Replacement provider credential', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Credential binding saved and draft review refreshed.' })).toBeVisible();
  await expect(picker).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  const unbind = menu.getByRole('menuitem', { name: 'Remove Replacement provider credential binding' });
  await page.keyboard.press('End');
  await expect(unbind).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Credential binding removed and draft review refreshed.' })).toBeVisible();
  await expect(picker).toContainText('Bind credential');
  await expect(picker).toBeFocused();
  await picker.click();
  await menu.getByText('Primary provider credential', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Credential binding saved and draft review refreshed.' })).toBeVisible();

  const governance = page.getByRole('heading', { name: 'Validation, policy & publication' }).locator('xpath=ancestor::section[1]');
  await expect(governance.getByText('External side effects require publication review.')).toBeVisible();
  await governance.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft published after governed review.' })).toBeVisible();

  await page.getByRole('button', { name: 'Run published' }).click();
  const debuggerPanel = page.getByRole('heading', { name: 'Run debugger' }).locator('xpath=ancestor::section[1]');
  await expect(debuggerPanel.getByText(/succeeded · v/i)).toBeVisible({ timeout: 30_000 });

  const flowResponse = await request.get(`/api/node-flows/${encodeURIComponent(draft.flowId)}`);
  expect(flowResponse.ok(), await flowResponse.text()).toBe(true);
  expect(JSON.stringify(await flowResponse.json())).not.toContain(SECRET_CANARY);
  await expect(page.locator('body')).not.toContainText(SECRET_CANARY);
});
