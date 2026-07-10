import { expect, type ConsoleMessage, type Page, test } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from '../helpers/prepare-app';

type DocsRouteCase = {
  path: string;
  expectedHeading: string;
  expectedSourcePath: string;
};

type CapturedLoadError = {
  kind: 'pageerror' | 'console' | 'response';
  message: string;
  route: string;
};

const docsRoutes: DocsRouteCase[] = [
  {
    path: '/docs',
    expectedHeading: 'Code UX Documentation',
    expectedSourcePath: 'index.md',
  },
  {
    path: '/docs/docs-overview',
    expectedHeading: 'Code UX Documentation',
    expectedSourcePath: 'index.md',
  },
  {
    path: '/docs/user-dashboard-overview',
    expectedHeading: 'The Dashboard',
    expectedSourcePath: 'user/dashboard/overview.md',
  },
  {
    path: '/docs/developer-mcp-tools',
    expectedHeading: 'MCP tools',
    expectedSourcePath: 'developer/mcp-tools.md',
  },
  {
    path: '/docs/architecture-system-overview',
    expectedHeading: 'System overview',
    expectedSourcePath: 'architecture/system-overview.md',
  },
];

test.beforeEach(async ({ page, request }, testInfo) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request, { testInfo, fixtureKey: 'docs-page' });
  await suppressDashboardTour(page);
});

function formatConsoleMessage(message: ConsoleMessage): string {
  const location = message.location();
  const locationLabel = location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : 'unknown location';
  return `${message.text()} (${locationLabel})`;
}

function formatCapturedErrors(errors: CapturedLoadError[]): string {
  return errors.map((error) => `${error.route} ${error.kind}: ${error.message}`).join('\n');
}

function captureBrowserErrors(page: Page, getActiveRoute: () => string): CapturedLoadError[] {
  const capturedErrors: CapturedLoadError[] = [];

  page.on('pageerror', (error) => {
    capturedErrors.push({ kind: 'pageerror', message: error.message, route: getActiveRoute() });
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    capturedErrors.push({ kind: 'console', message: formatConsoleMessage(message), route: getActiveRoute() });
  });

  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    capturedErrors.push({
      kind: 'response',
      message: `${response.status()} ${response.url()}`,
      route: getActiveRoute(),
    });
  });

  return capturedErrors;
}

test('documentation routes render compiled docs content without browser errors', async ({ page }) => {
  let activeRoute = 'startup';
  const capturedErrors = captureBrowserErrors(page, () => activeRoute);

  for (const route of docsRoutes) {
    activeRoute = route.path;
    const routeStartIndex = capturedErrors.length;

    await page.goto(route.path, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('main', { name: 'Main content' })).toBeVisible();

    const root = page.getByTestId('docs-web-page-root');
    await expect(root).toBeVisible();

    const articleMain = page.getByRole('main', { name: `Documentation: ${route.expectedHeading}` });
    await expect(articleMain).toBeVisible();
    await expect(articleMain.getByRole('heading', { name: route.expectedHeading, level: 1 })).toBeVisible();
    await expect(root.getByText(route.expectedSourcePath, { exact: true })).toBeVisible();

    const routeErrors = capturedErrors.slice(routeStartIndex);
    expect(routeErrors, formatCapturedErrors(routeErrors)).toEqual([]);
  }
});
