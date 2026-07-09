import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createE2eFixturePrefix,
  createProjectViaApi,
  fetchProjectsViaApi,
  selectProjectViaApi,
  suppressDashboardTour,
} from '../helpers/prepare-app';
import { deleteProjectViaApi } from '../helpers/e2e-api';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function prepareApp(page: Page, request: APIRequestContext): Promise<void> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  await page.addInitScript(() => {
    localStorage.setItem('codeux:sidebar:minimized', 'false');
  });
}

async function createSelectorProject(
  request: APIRequestContext,
  name: string,
): Promise<ProjectSummary> {
  return createProjectViaApi(request, {
    name,
    sourceType: 'local',
    sourceRef: process.cwd(),
    status: 'idle',
    initMode: 'existing',
  });
}

test.describe('global project selection', () => {
  const createdProjectIds: string[] = [];

  test.beforeEach(async ({ page, request }) => {
    await prepareApp(page, request);
  });

  test.afterEach(async ({ request }) => {
    while (createdProjectIds.length > 0) {
      const projectId = createdProjectIds.pop();
      if (projectId) {
        await deleteProjectViaApi(request, projectId);
      }
    }
  });

  test('lists created projects in the selector and persists the selected project', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'project-selection' });
    const firstProject = await createSelectorProject(request, `${prefix} selector alpha`);
    const secondProject = await createSelectorProject(request, `${prefix} selector beta`);
    createdProjectIds.push(firstProject.id, secondProject.id);

    await selectProjectViaApi(request, firstProject.id);

    await page.goto('/projects');
    const selector = page.locator('[data-tour-id="project-selector"]');
    await expect(selector).toContainText(firstProject.name);

    await selector.click();
    await expect(page.getByRole('option', { name: new RegExp(escapeRegExp(firstProject.name)) })).toBeVisible();
    const secondOption = page.getByRole('option', { name: new RegExp(escapeRegExp(secondProject.name)) });
    await expect(secondOption).toBeVisible();

    await secondOption.click();
    await expect(selector).toContainText(secondProject.name);

    await expect.poll(async () => {
      const projects = await fetchProjectsViaApi(request);
      return projects.selectedProjectId;
    }).toBe(secondProject.id);
  });
});
