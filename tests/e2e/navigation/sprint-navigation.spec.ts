import { expect, type APIRequestContext, type Page, test, type TestInfo } from '@playwright/test';
import type { ProjectSummary, SprintRecord, TaskRecord } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createDraftSprint,
  createE2eFixturePrefix,
  createOrFindIsolatedLocalProject,
  createTaskInSprint,
  fetchProjectsViaApi,
  fetchSprintsViaApi,
  selectProjectViaApi,
  selectSprintViaApi,
} from '../helpers/prepare-app';

const DASHBOARD_TOUR_STORAGE_KEY = 'codeux:dashboard-tour-hidden:v1';

async function hideDashboardTour(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, 'true');
  }, DASHBOARD_TOUR_STORAGE_KEY);
}

async function seedProjectSprintAndTask(
  request: APIRequestContext,
  testInfo: TestInfo,
  fixtureKey: string,
): Promise<{ project: ProjectSummary; sprint: SprintRecord; task: TaskRecord }> {
  const prefix = createE2eFixturePrefix({ testInfo, fixtureKey });
  const project = await createOrFindIsolatedLocalProject(request, {
    testInfo,
    fixtureKey,
    name: `${prefix} navigation project`,
  });
  const sprint = await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey,
    name: `${prefix} navigation sprint`,
    goal: 'Verify project-aware sprint navigation across dashboard pages.',
    select: true,
  });
  const task = await createTaskInSprint(request, project.id, sprint.id, {
    testInfo,
    fixtureKey,
    title: `${prefix} navigation task`,
    promptMarkdown: 'Deterministic fixture task for sprint navigation regression coverage.',
  });
  return { project, sprint, task };
}

async function expectSelectedProjectAndSprint(
  request: APIRequestContext,
  projectId: string,
  sprintId: string,
): Promise<void> {
  await expect.poll(async () => {
    const projects = await fetchProjectsViaApi(request);
    return projects.selectedProjectId;
  }).toBe(projectId);

  await expect.poll(async () => {
    const sprints = await fetchSprintsViaApi(request, projectId);
    return sprints.selectedSprintId;
  }).toBe(sprintId);
}

async function loadSprintPageForProject(page: Page, project: ProjectSummary, sprint: SprintRecord): Promise<void> {
  await page.goto('/sprints');
  await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(project.name, { timeout: 15_000 });
  await expect(page.getByRole('row', { name: new RegExp(sprint.name) })).toBeVisible({ timeout: 15_000 });
}

async function selectProjectFromTopNav(page: Page, project: ProjectSummary): Promise<void> {
  await page.locator('[data-tour-id="project-selector"]').click();
  await page.locator(`[id="project-option-${project.id}"]`).click();
  await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(project.name);
}

test.describe('sprint page project-aware navigation', () => {
  test('opens Tasks and Live for the clicked sprint project even when another project is selected', async ({ page, request }, testInfo) => {
    await completeOnboarding(request);
    await hideDashboardTour(page);

    const first = await seedProjectSprintAndTask(request, testInfo, 'sprint-nav-a');
    const second = await seedProjectSprintAndTask(request, testInfo, 'sprint-nav-b');

    await selectProjectViaApi(request, first.project.id);
    await selectSprintViaApi(request, first.project.id, first.sprint.id);
    await page.goto('/sprints');
    await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(first.project.name);

    await selectProjectViaApi(request, second.project.id);
    await selectSprintViaApi(request, second.project.id, second.sprint.id);
    await loadSprintPageForProject(page, second.project, second.sprint);

    await page
      .getByRole('row', { name: new RegExp(second.sprint.name) })
      .getByRole('link', { name: `Open tasks for sprint ${second.sprint.name}` })
      .click();

    await expect(page).toHaveURL(new RegExp(`/tasks\\?projectId=${encodeURIComponent(second.project.id)}&sprintId=${encodeURIComponent(second.sprint.id)}`));
    await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(second.project.name);
    await expect(page.getByRole('button', { name: new RegExp(`Task sprint scope: .*${second.sprint.name}`) })).toBeVisible();
    await expect(page.getByText(second.task.title).first()).toBeVisible();
    await expect(page.getByText(first.task.title).first()).toBeHidden();
    await expectSelectedProjectAndSprint(request, second.project.id, second.sprint.id);

    await selectProjectFromTopNav(page, first.project);
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).toBe(first.project.id);
    await expect.poll(() => new URL(page.url()).searchParams.get('sprintId')).toBeNull();
    await expectSelectedProjectAndSprint(request, first.project.id, first.sprint.id);

    await selectProjectViaApi(request, first.project.id);
    await selectSprintViaApi(request, first.project.id, first.sprint.id);
    await page.goto('/sprints');
    await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(first.project.name);

    await selectProjectViaApi(request, second.project.id);
    await selectSprintViaApi(request, second.project.id, second.sprint.id);
    await loadSprintPageForProject(page, second.project, second.sprint);

    await page
      .getByRole('row', { name: new RegExp(second.sprint.name) })
      .getByRole('link', { name: `Open live session for sprint ${second.sprint.name}` })
      .click();

    await expect(page).toHaveURL(new RegExp(`/live\\?projectId=${encodeURIComponent(second.project.id)}&sprintId=${encodeURIComponent(second.sprint.id)}`));
    await expect(page.locator('[data-tour-id="project-selector"]')).toContainText(second.project.name);
    await expect(page.getByRole('button', { name: new RegExp(`Sprint selector, selected sprint: .*${second.sprint.name}`) })).toBeVisible();
    await expectSelectedProjectAndSprint(request, second.project.id, second.sprint.id);

    await selectProjectFromTopNav(page, first.project);
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).toBe(first.project.id);
    await expect.poll(() => new URL(page.url()).searchParams.get('sprintId')).toBeNull();
    await expectSelectedProjectAndSprint(request, first.project.id, first.sprint.id);
  });
});
