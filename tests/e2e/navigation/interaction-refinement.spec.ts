import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import type { NodeFlowGraph } from '../../../src/contracts/node-flow-types.js';
import type { CreateSchedulerEntryInput, SchedulerEntryRecord } from '../../../src/contracts/scheduler-types.js';
import { createNodeFlowDraftViaApi } from '../helpers/e2e-api';
import {
  createE2EAgentPreset,
  prepareSelectedLocalGitProject,
  type SeededCodeUxProject,
} from '../helpers/e2e-fixtures';

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'interaction-refinement');
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('interaction-fixture-diagnostics', {
      body: JSON.stringify({
        fixture: 'approved-isolated-local-project',
        projectId: fixture?.project.id ?? null,
        test: testInfo.title,
      }, null, 2),
      contentType: 'application/json',
    });
  }
  await fixture?.cleanup();
  fixture = null;
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function seedNodeFlow(request: APIRequestContext): Promise<{ flowId: string; nodeTitle: string }> {
  const nodeTitle = 'Acceptance input';
  const graph: NodeFlowGraph = {
    schemaVersion: 2,
    nodes: [{
      id: 'acceptance-input',
      type: 'input',
      title: nodeTitle,
      definition: { type: 'input', version: 1 },
      position: { x: 40, y: 40 },
    }],
    edges: [],
  };
  const review = await createNodeFlowDraftViaApi(request, fixture!.project.id, {
    title: 'Interaction acceptance flow',
    description: 'Generic isolated fixture for interaction acceptance coverage.',
    graph,
  });
  return { flowId: review.flowId, nodeTitle };
}

async function seedSchedulerEntry(
  request: APIRequestContext,
  input: CreateSchedulerEntryInput,
): Promise<SchedulerEntryRecord> {
  const response = await request.post(
    `/api/projects/${encodeURIComponent(fixture!.project.id)}/scheduler`,
    { data: input },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as SchedulerEntryRecord;
}

async function expectFocusWithin(page: Page, selector: string): Promise<void> {
  await expect.poll(async () => page.locator(selector).evaluate(
    (element) => element.contains(document.activeElement),
  )).toBe(true);
}

test('protects a dirty agent editor through cancellation and explicit continuation', async ({ page, request }) => {
  const agent = await createE2EAgentPreset(request, fixture!.project.id, {
    name: 'Interaction refinement agent',
  });

  await page.goto('/agents', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: new RegExp(escapeRegExp(agent.name)) }).click();
  await page.getByRole('button', { name: 'Edit' }).click();

  const editor = page.getByRole('form', { name: `Edit ${agent.name}` });
  const nameField = editor.getByLabel('Agent name');
  await nameField.fill('Interaction refinement agent revised');
  await expect(editor.getByText('Unsaved', { exact: true })).toBeVisible();

  const scheduleLink = page.getByRole('link', { name: 'Schedule', exact: true });
  await scheduleLink.click();
  const dirtyDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(dirtyDialog).toBeVisible();
  await expectFocusWithin(page, '[role="dialog"][aria-labelledby="unsaved-modal-title"]');

  await page.keyboard.press('Escape');
  await expect(dirtyDialog).toBeHidden();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(nameField).toHaveValue('Interaction refinement agent revised');

  await scheduleLink.click();
  await expect(dirtyDialog).toBeVisible();
  await dirtyDialog.getByRole('button', { name: 'Discard without saving' }).click();
  await expect(page).toHaveURL(/\/scheduler$/);
  await expect(page.getByTestId('scheduler-page-root')).toBeVisible();
});

test('contains confirmation focus, cancels with Escape, and restores the destructive trigger', async ({ page, request }) => {
  await seedNodeFlow(request);
  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });

  const deleteTrigger = page.getByRole('button', { name: 'Delete node flow Interaction acceptance flow' });
  await deleteTrigger.focus();
  await deleteTrigger.click();

  const dialog = page.getByRole('dialog', { name: /Interaction acceptance flow/ });
  await expect(dialog).toBeVisible();
  await expectFocusWithin(page, '[role="dialog"][aria-labelledby="confirm-dialog-title"]');
  await page.keyboard.press('Tab');
  await expectFocusWithin(page, '[role="dialog"][aria-labelledby="confirm-dialog-title"]');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await expect(deleteTrigger).not.toHaveAttribute('aria-busy');
});

test('suppresses duplicate deletion, exposes retry feedback, and focuses the next scheduler row', async ({ page, request }) => {
  const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
  const first = await seedSchedulerEntry(request, {
    title: 'Acceptance schedule first',
    targetType: 'chat',
    scheduledFor,
    timezone: 'UTC',
    recurrence: { frequency: 'none', interval: 1, endMode: 'never' },
    chatTarget: { bodyMarkdown: 'Generic deterministic acceptance message.' },
  });
  const second = await seedSchedulerEntry(request, {
    title: 'Acceptance schedule second',
    targetType: 'chat',
    scheduledFor: new Date(Date.parse(scheduledFor) + 60_000).toISOString(),
    timezone: 'UTC',
    recurrence: { frequency: 'none', interval: 1, endMode: 'never' },
    chatTarget: { bodyMarkdown: 'Generic deterministic sibling fixture.' },
  });

  let deleteRequests = 0;
  let releaseFailure = (): void => undefined;
  let releaseSuccess = (): void => undefined;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const successGate = new Promise<void>((resolve) => { releaseSuccess = resolve; });
  await page.route(`**/api/scheduler/${first.id}`, async (route) => {
    deleteRequests += 1;
    if (deleteRequests === 1) {
      await failureGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary isolated fixture failure.' }),
      });
      return;
    }
    const response = await route.fetch();
    await successGate;
    await route.fulfill({ response });
  });

  await page.goto('/scheduler', { waitUntil: 'domcontentloaded' });
  const firstRow = page.getByTestId(`scheduler-entry-${first.id}`);
  const secondRow = page.getByTestId(`scheduler-entry-${second.id}`);
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();

  const deleteTrigger = firstRow.getByRole('button', { name: 'Delete schedule entry' });
  await deleteTrigger.click();
  const dialog = page.getByRole('dialog', { name: /Acceptance schedule first/ });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  expect(deleteRequests).toBe(0);

  await deleteTrigger.click();
  const confirm = dialog.getByRole('button', { name: 'Delete' });
  await confirm.click();
  await expect.poll(() => deleteRequests).toBe(1);
  const pendingConfirm = dialog.locator('button[aria-busy="true"]');
  await expect(pendingConfirm).toBeDisabled();
  await expect(deleteTrigger).toBeDisabled();
  await pendingConfirm.evaluate((button) => button.click());
  expect(deleteRequests).toBe(1);
  releaseFailure();

  const feedback = firstRow.getByTestId(`scheduler-entry-feedback-${first.id}`);
  await expect(feedback).toHaveRole('alert');
  const retry = feedback.getByRole('button', { name: 'Retry' });
  await retry.click();
  await expect.poll(() => deleteRequests).toBe(2);
  await expect(deleteTrigger).toBeDisabled();
  await expect(deleteTrigger).toHaveAttribute('aria-busy', 'true');
  expect(deleteRequests).toBe(2);
  releaseSuccess();

  await expect(firstRow).toBeHidden();
  await expect(secondRow.locator('button').first()).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Schedule entry deleted.' }).first()).toBeVisible();
});

test('keeps keyboard node movement visible and announced with reduced motion', async ({ page, request }) => {
  const { nodeTitle } = await seedNodeFlow(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });

  const canvas = page.getByRole('region', { name: 'Node flow canvas' });
  const node = canvas.getByRole('button', { name: `Select node ${nodeTitle}` });
  await node.focus();
  await page.keyboard.press('ArrowRight');

  await expect(node).toHaveAttribute('aria-pressed', 'true');
  await expect(node).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 48, 40)');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const transitionDurationMs = await node.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000
  ));
  expect(transitionDurationMs).toBeLessThanOrEqual(0.01);
  const announcement = canvas.getByRole('status');
  await expect(announcement).not.toBeEmpty();
  await expect(announcement).toContainText(nodeTitle);
});
