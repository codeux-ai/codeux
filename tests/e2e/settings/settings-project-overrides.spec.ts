import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';
import {
  chooseRadio,
  deleteProjectSettingsOverride,
  expectUnsavedIndicator,
  fetchEffectiveProjectSettings,
  fetchProjectSettings,
  openSettingsCategory,
  saveProjectSettingsOverride,
  saveSettings,
} from './settings-test-helpers';

async function openGeneral(page: Page, scope: 'System' | 'Project' = 'System'): Promise<void> {
  await openSettingsCategory(page, 'general', /General Scope, runtime, and automation posture/i, scope);
}

async function openDanger(page: Page, scope: 'System' | 'Project' = 'System'): Promise<void> {
  await openSettingsCategory(page, 'danger', /Danger Zone Reset project overrides only when needed/i, scope);
}

test.describe('settings project overrides and danger panel', () => {
  let project: ProjectSummary;

  test.beforeEach(async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'settings-project-overrides' });
    await suppressDashboardTour(page);
  });

  test('persists a project override, exposes it in effective settings, then clears it through the delete path', async ({ page, request }) => {
    const inheritedBeforeOverride = await fetchEffectiveProjectSettings(request, project.id);
    const overrideAutomationLevel = inheritedBeforeOverride.settings.automationLevel === 'ALWAYS_ASK' ? 'FULL' : 'ALWAYS_ASK';
    const overrideRadio = overrideAutomationLevel === 'ALWAYS_ASK'
      ? /Always ask Requires a decision/i
      : /Full Moves without confirmation gates/i;

    await openGeneral(page, 'Project');
    await expect(page.locator('#settings-scope-context')).toContainText('Editing overrides for');

    await chooseRadio(page, overrideRadio);
    await expectUnsavedIndicator(page);
    await saveSettings(page);

    await expect.poll(async () => {
      const effective = await fetchEffectiveProjectSettings(request, project.id);
      return {
        value: effective.settings.automationLevel,
        source: effective.sources.automationLevel,
      };
    }).toEqual({ value: overrideAutomationLevel, source: 'project' });

    await page.reload();
    await openGeneral(page, 'Project');
    await expect(page.getByRole('radio', { name: overrideRadio })).toHaveAttribute('aria-checked', 'true');
    expect((await fetchProjectSettings(request, project.id)).automationLevel).toBe(overrideAutomationLevel);

    await deleteProjectSettingsOverride(request, project.id);
    const effectiveAfterDelete = await fetchEffectiveProjectSettings(request, project.id);
    expect(effectiveAfterDelete.sources.automationLevel).toBe('system');
    expect(effectiveAfterDelete.settings.automationLevel).toBe(inheritedBeforeOverride.settings.automationLevel);
  });

  test('resets project overrides from the danger panel without destructive database actions', async ({ page, request }) => {
    await saveProjectSettingsOverride(request, project.id, { automationLevel: 'ALWAYS_ASK' });
    await expect.poll(async () => (await fetchEffectiveProjectSettings(request, project.id)).sources.automationLevel).toBe('project');

    await openDanger(page, 'Project');
    await expect(page.getByRole('button', { name: 'Reset Project' }).first()).toBeEnabled();
    await page.getByRole('button', { name: 'Reset Project' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Reset Project Overrides' });
    await expect(dialog).toBeVisible();
    await holdToConfirm(page, dialog.getByRole('button', { name: 'Hold to Reset Project' }));

    await expect.poll(async () => (await fetchEffectiveProjectSettings(request, project.id)).sources.automationLevel).toBe('system');

    await page.reload();
    await openDanger(page, 'Project');
    await expect(page.locator('div:not(.sr-only)', { hasText: /0 overridden settings/i }).first()).toBeVisible();
  });

  test('cancels a danger confirmation without deleting the selected project', async ({ page, request }) => {
    await openDanger(page);

    await page.getByRole('button', { name: 'Delete Project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Delete Project' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Cancel|Keep/i }).click();

    const effective = await fetchEffectiveProjectSettings(request, project.id);
    expect(effective.settings).toBeTruthy();
  });
});

async function holdToConfirm(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) {
    throw new Error('Confirmation button was not visible.');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_250);
  await page.mouse.up();
}
