import { expect, type ConsoleMessage, type Locator, type Page, test } from '@playwright/test';
import { completeOnboarding, createDraftSprint, ensureSelectedProject } from '../helpers/prepare-app';

type RouteSmokeCase = {
  path: string;
  tourId?: string;
  landmark: (page: Page) => Locator;
};

const routeSmokeCases: RouteSmokeCase[] = [
  {
    path: '/',
    tourId: 'nav-overview',
    landmark: (page) => page.getByRole('heading', { name: 'Overview' }),
  },
  {
    path: '/sprints',
    tourId: 'nav-sprints',
    landmark: (page) => page.getByRole('region', { name: 'Sprint Ledger' }),
  },
  {
    path: '/tasks',
    tourId: 'nav-tasks',
    landmark: (page) => page.getByRole('heading', { name: 'Task Board', exact: true }),
  },
  {
    path: '/projects',
    landmark: (page) => page.getByRole('heading', { name: 'Manage Projects' }),
  },
  {
    path: '/chat',
    tourId: 'nav-chat',
    landmark: (page) => page.getByRole('heading', { name: 'Project Conversations' }),
  },
  {
    path: '/agents',
    tourId: 'nav-agents',
    landmark: (page) => page.getByRole('heading', { name: 'Your Workforce' }),
  },
  {
    path: '/stats',
    tourId: 'nav-stats',
    landmark: (page) => page.getByRole('heading', { name: 'Stats' }),
  },
  {
    path: '/scheduler',
    tourId: 'nav-schedule',
    landmark: (page) => page.getByTestId('scheduler-page-root'),
  },
  {
    path: '/config',
    tourId: 'nav-config',
    landmark: (page) => page.getByRole('heading', { name: 'Settings & Integration' }),
  },
  {
    path: '/memory',
    tourId: 'nav-memory',
    landmark: (page) => page.getByRole('heading', { name: 'Memory Map' }),
  },
  {
    path: '/browser',
    landmark: (page) => page.getByTestId('browser-page-root'),
  },
  {
    path: '/files',
    tourId: 'nav-files',
    landmark: (page) => page.getByTestId('file-browser-page-root'),
  },
];

const benignConsoleErrorPatterns = [
  /Failed to fetch/i,
  /AbortError/i,
  /The operation was aborted/i,
  /net::ERR_ABORTED/i,
];
const genericResourceStatusConsolePattern = /Failed to load resource: the server responded with a status of \d+/i;
const optionalSkillStorageRoutePattern = /\/api\/projects\/[^/]+\/skill-storages(?:[?#]|$)/;

test.describe.configure({ mode: 'serial' });

function isBenignConsoleError(message: string): boolean {
  return benignConsoleErrorPatterns.some((pattern) => pattern.test(message));
}

function isBenignHttpFailure(status: number, url: string): boolean {
  return status === 404 && optionalSkillStorageRoutePattern.test(url);
}

function installErrorCapture(page: Page): string[] {
  const errors: string[] = [];

  page.on('response', (response) => {
    if (response.status() === 404) {
      errors.push(`response 404: ${response.url()}`);
    }
  });

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' && genericResourceStatusConsolePattern.test(message.text())) {
      return;
    }
    if (message.type() === 'error' && !isBenignConsoleError(message.text())) {
      errors.push(`console error: ${message.text()}`);
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400 && !isBenignHttpFailure(status, response.url())) {
      errors.push(`http ${status}: ${response.url()}`);
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

async function ensureProjectSelectedInShell(page: Page, projectName: string): Promise<void> {
  const projectButton = page.locator('[data-tour-id="project-selector"]');
  await expect(projectButton).toBeVisible();

  if ((await projectButton.innerText()).includes(projectName)) {
    return;
  }

  await projectButton.click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(projectName)) }).click();
  await expect(projectButton).toContainText(projectName);
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

test.beforeEach(async ({ page, request }, testInfo) => {
  await completeOnboarding(request);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'release-smoke' });
  await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'release-smoke',
    goal: 'Provide stable dashboard release smoke fixture data.',
  });

  await page.addInitScript(() => {
    localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
    localStorage.setItem('codeux:sidebar:minimized', 'false');
  });
});

test('normal app shell loads and global shell behavior works', async ({ page, request }, testInfo) => {
  const errors = installErrorCapture(page);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'release-smoke-shell' });
  await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'release-smoke-shell',
    goal: 'Keep shell smoke checks in normal project scope.',
  });

  await page.goto('/');

  await expect(page).toHaveTitle(/Code UX/i);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText(/connect a project|add first project|welcome/i)).toHaveCount(0);

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toHaveClass(/sr-only/);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.locator('[data-tour-id="project-selector"]')).toBeVisible();
  await ensureProjectSelectedInShell(page, project.name);

  for (const { tourId } of routeSmokeCases.filter((route) => route.tourId)) {
    await expect(page.locator(`[data-tour-id="${tourId}"]`).first()).toBeVisible();
  }

  const searchTrigger = page.getByRole('button', { name: /Search workspace|Open search/i }).first();
  await expect(searchTrigger).toBeVisible();
  await searchTrigger.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      element.click();
    }
  });
  const searchDialog = page.getByRole('dialog', { name: 'Search' });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByPlaceholder('Find sprints, tasks, agents, previews...')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchDialog).toBeHidden();

  await expect(page.getByRole('button', { name: /Notifications:/ })).toBeVisible();

  await page.locator('[data-tour-id="nav-tasks"]').click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await ensureProjectSelectedInShell(page, project.name);
  await expectNoPersistentLoading(page);
  await expectNoCapturedErrors(errors);
});

test('core dashboard routes render release smoke landmarks without app errors', async ({ page, request }, testInfo) => {
  const errors = installErrorCapture(page);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'release-smoke-routes' });
  await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'release-smoke-routes',
    goal: 'Keep route smoke checks in normal project scope.',
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await ensureProjectSelectedInShell(page, project.name);

  for (const route of routeSmokeCases) {
    if (route.tourId) {
      const navItem = page.locator(`[data-tour-id="${route.tourId}"]`).first();
      await expect(navItem).toBeVisible();
      await navItem.click();
    } else {
      await page.goto(route.path);
    }
    await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/$' : `${escapeRegExp(route.path)}$`}`));
    await expect(route.landmark(page)).toBeVisible();
    await ensureProjectSelectedInShell(page, project.name);
    await expectNoPersistentLoading(page);
    await expectNoCapturedErrors(errors);
  }
});

test('task board remains usable across mobile and desktop release viewports', async ({ page, request }, testInfo) => {
  const errors = installErrorCapture(page);
  const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'release-smoke-responsive' });
  await createDraftSprint(request, project.id, {
    testInfo,
    fixtureKey: 'release-smoke-responsive',
    goal: 'Keep responsive smoke checks in normal project scope.',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await ensureProjectSelectedInShell(page, project.name);
  await expect(page.getByRole('button', { name: 'New Task' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.getByRole('heading', { name: 'Task Board', exact: true })).toBeVisible();
  await ensureProjectSelectedInShell(page, project.name);
  await expect(page.getByRole('button', { name: 'New Task' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoPersistentLoading(page);
  await expectNoCapturedErrors(errors);
});
