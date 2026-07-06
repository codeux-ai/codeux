import { expect, type ConsoleMessage, type Page, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectSummary } from '../../src/contracts/project-management-types.js';
import {
  completeOnboarding,
  createE2eFixturePrefix,
  fetchProjectsViaApi,
  installLocalNavigationGuard,
} from './helpers/prepare-app';
import { deleteProjectViaApi } from './helpers/e2e-api';

const benignConsoleErrorPatterns = [
  /Failed to fetch/i,
  /AbortError/i,
  /The operation was aborted/i,
  /net::ERR_ABORTED/i,
];

function isBenignConsoleError(message: string): boolean {
  return benignConsoleErrorPatterns.some((pattern) => pattern.test(message));
}

function installErrorCapture(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' && !isBenignConsoleError(message.text())) {
      errors.push(`console error: ${message.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    if (!isBenignConsoleError(error.message)) {
      errors.push(`page error: ${error.message}`);
    }
  });

  return errors;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectNoCapturedErrors(errors: string[]): Promise<void> {
  expect(errors, errors.join('\n')).toEqual([]);
}

async function expectNoPersistentLoading(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0);
  await expect(page.getByText(/loading dashboard|loading workspace|loading projects/i)).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => (
    page.evaluate(() => {
      const root = document.documentElement;
      const main = document.querySelector<HTMLElement>('#main-content');
      return {
        documentOverflow: root.scrollWidth - root.clientWidth,
        mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      };
    })
  )).toEqual({ documentOverflow: 0, mainOverflow: 0 });
}

async function expectProjectSelectedInShell(page: Page, projectName: string): Promise<void> {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();

  if ((await projectButton.innerText()).includes(projectName)) {
    return;
  }

  await projectButton.click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(projectName)) }).click();
  await expect(projectButton).toContainText(projectName);
}

async function ensureProjectCardSelected(page: Page, projectName: string): Promise<void> {
  const selectedButton = page.getByRole('button', { name: `${projectName} is selected` });
  if (await selectedButton.isVisible()) {
    await expect(selectedButton).toBeVisible();
    return;
  }

  await page.getByRole('button', { name: `Select ${projectName}` }).click();
  await expect(selectedButton).toBeVisible();
}

async function findProjectByName(page: Page, projectName: string): Promise<ProjectSummary> {
  let project: ProjectSummary | null = null;

  await expect.poll(async () => {
    const projects = await fetchProjectsViaApi(page.request);
    project = projects.projects.find((candidate) => candidate.name === projectName) ?? null;
    return project !== null;
  }).toBe(true);

  return project;
}

test.describe('credential-free project setup release flow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  let createdProjectId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (createdProjectId) {
      await deleteProjectViaApi(request, createdProjectId);
      createdProjectId = null;
    }
  });

  test('adds an isolated local project through the dashboard and keeps shell navigation stable', async ({ page, request }, testInfo) => {
    const errors = installErrorCapture(page);
    const assertNoExternalNavigation = installLocalNavigationGuard(page, testInfo);
    const prefix = createE2eFixturePrefix({ testInfo, fixtureKey: 'project-setup-release' });
    const projectName = `${prefix} local project`;
    const projectDir = path.join(os.tmpdir(), 'codeux-e2e-project-setup', prefix);
    expect(prefix).toContain(`e2e-w${testInfo.workerIndex}-r${testInfo.repeatEachIndex}-try${testInfo.retry}-`);
    expect(projectName).toContain(prefix);
    expect(projectDir).toContain(prefix);
    await fs.mkdir(projectDir, { recursive: true });

    await completeOnboarding(request);
    await page.addInitScript(() => {
      localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
      localStorage.setItem('codeux:sidebar:minimized', 'false');
    });

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Manage Projects' })).toBeVisible();

    await page.getByRole('button', { name: /Add Project/ }).last().click();
    const dialog = page.getByRole('dialog', { name: /Add Project/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Project Name/).fill(projectName);
    await dialog.getByLabel(/Directory Path/).fill(projectDir);

    const setupCheckbox = dialog.getByLabel(/Initialize with Project Setup Agent/);
    await expect(setupCheckbox).toBeChecked();
    await dialog.getByText('Initialize with Project Setup Agent').click();
    await expect(setupCheckbox).not.toBeChecked();

    await dialog.getByRole('button', { name: 'Add Project' }).click();
    await expect(dialog).toBeHidden();

    const createdProject = await findProjectByName(page, projectName);
    createdProjectId = createdProject.id;
    expect(createdProject.sourceType).toBe('local');
    expect(createdProject.sourceRef).toBe(projectDir);

    await ensureProjectCardSelected(page, projectName);
    await expectProjectSelectedInShell(page, projectName);
    await expectNoPersistentLoading(page);
    await expectNoHorizontalOverflow(page);

    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
    await expectProjectSelectedInShell(page, projectName);
    await expectNoPersistentLoading(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
    await expectProjectSelectedInShell(page, projectName);
    await expectNoHorizontalOverflow(page);
    await expectNoCapturedErrors(errors);
    assertNoExternalNavigation();
  });
});
