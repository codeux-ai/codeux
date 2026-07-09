import { expect, type ConsoleMessage, type Locator, type Page, test } from '@playwright/test';
import { prepareSelectedLocalGitProject, type SeededCodeUxProject } from '../helpers/e2e-fixtures';

type RouteCase = {
  path: string;
  landmark: (page: Page) => Locator;
};

type CapturedLoadError = {
  kind: 'pageerror' | 'console' | 'response';
  message: string;
  route: string;
};

const routes: RouteCase[] = [
  { path: '/', landmark: (page) => page.getByRole('heading', { name: 'Overview' }) },
  { path: '/sprints', landmark: (page) => page.getByRole('heading', { name: 'Active Sprints' }) },
  { path: '/tasks', landmark: (page) => page.getByRole('heading', { name: 'Task Board', exact: true }) },
  { path: '/projects', landmark: (page) => page.getByRole('heading', { name: 'Manage Projects' }) },
  { path: '/chat', landmark: (page) => page.getByRole('heading', { name: 'Project Conversations' }) },
  { path: '/agents', landmark: (page) => page.getByRole('heading', { name: 'Your Workforce' }) },
  { path: '/stats', landmark: (page) => page.getByRole('region', { name: 'Statistics' }) },
  { path: '/scheduler', landmark: (page) => page.getByTestId('scheduler-page-root') },
  { path: '/config', landmark: (page) => page.getByRole('heading', { name: 'Settings & Integration' }) },
  { path: '/memory', landmark: (page) => page.getByRole('heading', { name: 'Memory Map' }) },
  { path: '/browser', landmark: (page) => page.getByTestId('browser-page-root') },
  { path: '/files', landmark: (page) => page.getByTestId('file-browser-page-root') },
];

let fixture: SeededCodeUxProject | null = null;

test.beforeEach(async ({ page, request }, testInfo) => {
  fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'route-smoke');
});

test.afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

function formatConsoleMessage(message: ConsoleMessage): string {
  const location = message.location();
  const locationLabel = location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : 'unknown location';
  return `${message.text()} (${locationLabel})`;
}

function isExpectedOptionalAgentsStorage404(error: CapturedLoadError): boolean {
  return error.route === '/agents'
    && error.kind === 'response'
    && /\/api\/projects\/[^/]+\/skill-storages\b/.test(error.message)
    && /\b404\b/.test(error.message);
}

function isConsoleResourceErrorForExpectedResponse(
  error: CapturedLoadError,
  routeErrors: CapturedLoadError[],
): boolean {
  return error.route === '/agents'
    && error.kind === 'console'
    && /Failed to load resource/i.test(error.message)
    && routeErrors.some(isExpectedOptionalAgentsStorage404);
}

function filterUnexpectedErrors(errors: CapturedLoadError[]): CapturedLoadError[] {
  return errors.filter((error) => (
    !isExpectedOptionalAgentsStorage404(error)
    && !isConsoleResourceErrorForExpectedResponse(error, errors)
  ));
}

test('primary dashboard routes load intentional content without browser errors', async ({ page }) => {
  const capturedErrors: CapturedLoadError[] = [];
  let activeRoute = 'startup';

  page.on('pageerror', (error) => {
    capturedErrors.push({ kind: 'pageerror', message: error.message, route: activeRoute });
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    capturedErrors.push({ kind: 'console', message: formatConsoleMessage(message), route: activeRoute });
  });

  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    capturedErrors.push({
      kind: 'response',
      message: `${response.status()} ${response.url()}`,
      route: activeRoute,
    });
  });

  for (const route of routes) {
    activeRoute = route.path;
    const routeStartIndex = capturedErrors.length;

    await page.goto(route.path, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('main', { name: 'Main content' })).toBeVisible();
    await expect(route.landmark(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Project selector, selected project:/i })).toContainText(fixture?.project.name ?? '');

    const routeErrors = capturedErrors.slice(routeStartIndex);
    const unexpectedErrors = filterUnexpectedErrors(routeErrors);
    expect(unexpectedErrors, unexpectedErrors.map((error) => `${error.route} ${error.kind}: ${error.message}`).join('\n')).toEqual([]);
  }
});
