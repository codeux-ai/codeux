import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectSummary } from '../../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createProjectViaApi,
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
  return page.locator('.project-card-entry').filter({ hasText: projectName });
}

async function selectProjectCard(page: Page, projectName: string): Promise<void> {
  const selectedButton = page.getByRole('button', { name: `${projectName} is selected` });
  if (await selectedButton.isVisible()) {
    await selectedButton.click();
    return;
  }

  await page.getByRole('button', { name: `Select ${projectName}` }).click();
  await expect(selectedButton).toBeVisible();
}

test.describe('project CRUD lifecycle', () => {
  let createdProjectIds = new Set<string>();
  let temporaryDirectories = new Set<string>();

  test.beforeEach(async ({ page, request }) => {
    await prepareProjectsPage(page, request);
    createdProjectIds = new Set<string>();
    temporaryDirectories = new Set<string>();
  });

  test.afterEach(async ({ request }) => {
    for (const projectId of createdProjectIds) {
      await deleteProjectViaApi(request, projectId);
    }
    createdProjectIds.clear();

    for (const directory of temporaryDirectories) {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
    temporaryDirectories.clear();
  });

  test('creates, selects, and deletes a local project through the Projects UI', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'project-crud' });
    const projectName = `${prefix} local checkout`;
    const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codeux-e2e-project-crud-ui-'));
    temporaryDirectories.add(checkoutPath);

    await page.goto('/projects');
    await hideDashboardAssistant(page);
    await expect(page.getByRole('heading', { name: 'Manage Projects' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Project' }).last().click();
    const dialog = page.getByRole('dialog', { name: /Add Project/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Project Name/).fill(projectName);
    await dialog.getByRole('button', { name: 'Local Project' }).click();
    await dialog.getByLabel(/Directory Path/).fill(checkoutPath);

    const setupCheckbox = dialog.getByLabel(/Initialize with Project Setup Agent/);
    await expect(setupCheckbox).toBeChecked();
    await dialog.getByText('Initialize with Project Setup Agent').click();
    await expect(setupCheckbox).not.toBeChecked();

    await dialog.getByRole('button', { name: 'Add Project' }).click();
    await expect(dialog).toBeHidden();

    const createdProject = await findProjectByName(request, projectName);
    createdProjectIds.add(createdProject.id);
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

    await projectCard(page, projectName).getByRole('button', { name: 'Delete project' }).click();
    await expect(projectCard(page, projectName)).toHaveCount(0);

    await expect.poll(async () => {
      const projects = await fetchProjectsViaApi(request);
      return !projects.projects.some((candidate) => candidate.id === createdProject.id)
        && projects.selectedProjectId !== createdProject.id;
    }).toBe(true);

    createdProjectIds.delete(createdProject.id);
  });

  test('handles selection changes, duplicate paths, invalid input, and missing filesystem targets safely', async ({ page, request }, testInfo) => {
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'project-crud-edge' });
    const sharedPath = await fs.mkdtemp(path.join(os.tmpdir(), 'codeux-e2e-project-crud-edge-'));
    temporaryDirectories.add(sharedPath);
    const missingPath = path.join(sharedPath, 'missing', 'target');

    const invalidResponse = await request.post('/api/projects', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: `${prefix} invalid path`,
        sourceType: 'local',
        sourceRef: '',
        status: 'idle',
        initMode: 'existing',
      },
    });
    expect(invalidResponse.status()).toBe(400);
    const invalidBody = await invalidResponse.json() as unknown;
    const serializedInvalidBody = JSON.stringify(invalidBody);
    expect(serializedInvalidBody).toContain('sourceRef');
    expect(serializedInvalidBody).not.toContain(' at ');
    expect(serializedInvalidBody).not.toContain('node:');

    const firstProject = await createProjectViaApi(request, {
      name: `${prefix} duplicate path one`,
      sourceType: 'local',
      sourceRef: sharedPath,
      status: 'idle',
      initMode: 'existing',
    });
    const secondProject = await createProjectViaApi(request, {
      name: `${prefix} duplicate path two`,
      sourceType: 'local',
      sourceRef: sharedPath,
      status: 'idle',
      initMode: 'existing',
    });
    const missingTargetProject = await createProjectViaApi(request, {
      name: `${prefix} missing target`,
      sourceType: 'local',
      sourceRef: missingPath,
      status: 'idle',
      initMode: 'existing',
    });
    createdProjectIds.add(firstProject.id);
    createdProjectIds.add(secondProject.id);
    createdProjectIds.add(missingTargetProject.id);

    expect(firstProject.id).not.toBe(secondProject.id);
    expect(firstProject.sourceRef).toBe(sharedPath);
    expect(secondProject.sourceRef).toBe(sharedPath);
    expect(missingTargetProject.baseDir).toBe(path.resolve(missingPath));

    const missingDirectoryResponse = await request.get(`/api/local-directories?path=${encodeURIComponent(missingPath)}`);
    expect(missingDirectoryResponse.status()).toBe(400);
    expect(await missingDirectoryResponse.json()).toEqual({ error: 'Path does not exist' });

    await page.goto('/projects');
    await hideDashboardAssistant(page);
    await expect(page.getByRole('heading', { name: 'Manage Projects' })).toBeVisible();
    await expect(projectCard(page, missingTargetProject.name)).toHaveCount(1);

    await selectProjectCard(page, firstProject.name);
    await expect.poll(async () => (await fetchProjectsViaApi(request)).selectedProjectId).toBe(firstProject.id);
    await selectProjectCard(page, secondProject.name);
    await expect.poll(async () => (await fetchProjectsViaApi(request)).selectedProjectId).toBe(secondProject.id);

    await projectCard(page, secondProject.name).getByRole('button', { name: 'Delete project' }).click();
    await expect(projectCard(page, secondProject.name)).toHaveCount(0);
    await expect(projectCard(page, firstProject.name)).toHaveCount(1);
    await expect.poll(async () => {
      const projects = await fetchProjectsViaApi(request);
      return projects.projects.some((candidate) => candidate.id === firstProject.id)
        && !projects.projects.some((candidate) => candidate.id === secondProject.id);
    }).toBe(true);
    createdProjectIds.delete(secondProject.id);
  });
});
