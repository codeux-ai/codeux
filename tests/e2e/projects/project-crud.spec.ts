import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createE2eFixturePrefix,
  fetchProjectsViaApi,
  suppressDashboardTour,
} from '../helpers/prepare-app';
import { deleteProjectViaApi } from '../helpers/e2e-api';

async function prepareProjectsPage(page: Page, request: APIRequestContext): Promise<void> {
  await completeOnboarding(request);
  await suppressDashboardTour(page);
  await page.addInitScript(() => {
    localStorage.setItem('codeux:sidebar:minimized', 'false');
    localStorage.setItem('codeux.dashboard.locale.v1', 'de');
  });
}

async function hideDashboardAssistant(page: Page): Promise<void> {
  await page.addStyleTag({
    content: 'aside[aria-label="Dashboard assistant"]{display:none!important;pointer-events:none!important;}',
  });
}

async function findProjectByName(request: APIRequestContext, projectName: string): Promise<ProjectSummary> {
  let project: ProjectSummary | null = null;

  await expect.poll(async () => {
    const projects = await fetchProjectsViaApi(request);
    project = projects.projects.find((candidate) => candidate.name === projectName) ?? null;
    return project !== null;
  }).toBe(true);

  return project;
}

function projectCard(page: Page, projectName: string): Locator {
  return page.getByRole('article', { name: `Projekt: ${projectName}`, exact: true });
}

async function selectProjectCard(page: Page, projectName: string): Promise<void> {
  const card = projectCard(page, projectName);
  const selectedButton = card.getByRole('button', { name: `Ausgewähltes Projekt: ${projectName}`, exact: true });
  if (await selectedButton.isVisible()) {
    await selectedButton.click();
    return;
  }

  await card.getByRole('button', { name: `Projekt auswählen: ${projectName}`, exact: true }).click();
  await expect(selectedButton).toBeVisible();
}

test.describe('project CRUD lifecycle', () => {
  let createdProjectId: string | null = null;

  test.beforeEach(async ({ page, request }) => {
    await prepareProjectsPage(page, request);
  });

  test.afterEach(async ({ request }) => {
    if (createdProjectId) {
      await deleteProjectViaApi(request, createdProjectId);
      createdProjectId = null;
    }
  });

  test('creates, selects, and deletes a local project through the German Projects UI', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'project-crud' });
    const projectName = `${prefix} local checkout`;
    const checkoutPath = process.cwd();

    await page.goto('/projects');
    await hideDashboardAssistant(page);
    await expect(page.getByRole('heading', { name: 'Projekte verwalten' })).toBeVisible();

    await page.getByRole('button', { name: 'Projekt hinzufügen' }).last().click();
    const dialog = page.getByRole('dialog', { name: /Projekt hinzufügen/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Projektname/).fill(projectName);
    await dialog.getByRole('button', { name: 'Lokales Projekt' }).click();
    await dialog.getByLabel(/Verzeichnispfad/).fill(checkoutPath);

    const setupCheckbox = dialog.getByLabel(/Mit Projekteinrichtungs-Agent initialisieren/);
    await expect(setupCheckbox).toBeChecked();
    await dialog.getByText('Mit Projekteinrichtungs-Agent initialisieren').click();
    await expect(setupCheckbox).not.toBeChecked();

    await dialog.getByRole('button', { name: 'Projekt hinzufügen' }).click();
    await expect(dialog).toBeHidden();

    const createdProject = await findProjectByName(request, projectName);
    createdProjectId = createdProject.id;
    expect(createdProject).toMatchObject({
      name: projectName,
      sourceType: 'local',
      sourceRef: checkoutPath,
    });

    await expect(projectCard(page, projectName)).toHaveCount(1);
    await expect(page.getByText(projectName).first()).toBeVisible();

    await selectProjectCard(page, projectName);
    await expect.poll(async () => {
      const projects = await fetchProjectsViaApi(request);
      return projects.selectedProjectId;
    }).toBe(createdProject.id);

    await projectCard(page, projectName).getByRole('button', { name: 'Projekt löschen' }).click();
    const deleteDialog = page.getByRole('dialog', { name: `${projectName} löschen?`, exact: true });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Projekt löschen' }).click();
    await expect(projectCard(page, projectName)).toHaveCount(0);

    await expect.poll(async () => {
      const projects = await fetchProjectsViaApi(request);
      return !projects.projects.some((candidate) => candidate.id === createdProject.id)
        && projects.selectedProjectId !== createdProject.id;
    }).toBe(true);

    createdProjectId = null;
  });
});
