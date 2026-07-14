import { expect, type ConsoleMessage, type Locator, type Page, test } from '@playwright/test';
import {
  createSprintWithTasks,
  prepareSelectedLocalGitProject,
  type SeededCodeUxProject,
} from '../helpers/e2e-fixtures';

const LOCALE_STORAGE_KEY = 'codeux.dashboard.locale.v1';
const projectName = 'English User Project — Unchanged';
const sprintName = 'English User Sprint — Unchanged';
const taskTitle = 'English User Task — Unchanged';

type CapturedError = { kind: 'console' | 'pageerror'; message: string; route: string };
type RouteCase = { path: string; landmark: (page: Page) => Locator };

const localizedRoutes: RouteCase[] = [
  { path: '/', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/projects', landmark: (page) => page.getByRole('heading', { name: 'Projekte verwalten' }) },
  { path: '/sprints', landmark: (page) => page.getByRole('heading', { name: 'Aktive Sprints' }) },
  { path: '/tasks', landmark: (page) => page.getByRole('heading', { name: 'Aufgaben', level: 1, exact: true }) },
  { path: '/chat', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/agents', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/stats', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/scheduler', landmark: (page) => page.getByTestId('scheduler-page-root') },
  { path: '/config', landmark: (page) => page.getByRole('heading', { name: 'Einstellungen & Integrationen' }) },
  { path: '/memory', landmark: (page) => page.getByRole('heading', { name: 'Erinnerungskarte' }) },
  { path: '/knowledge', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/browser', landmark: (page) => page.getByTestId('browser-page-root') },
  { path: '/files', landmark: (page) => page.getByTestId('file-browser-page-root') },
  { path: '/live', landmark: (page) => page.getByRole('main', { name: 'Hauptinhalt' }) },
  { path: '/docs', landmark: (page) => page.getByTestId('docs-web-page-root') },
  { path: '/route-that-does-not-exist', landmark: (page) => page.getByText('Seite nicht gefunden') },
];

function formatConsoleMessage(message: ConsoleMessage): string {
  const location = message.location();
  return `${message.text()} (${location.url || 'unknown'}:${location.lineNumber}:${location.columnNumber})`;
}

function isExpectedAgentsStorageError(error: CapturedError): boolean {
  return error.route === '/agents'
    && error.kind === 'console'
    && (/skill-storages/.test(error.message) || /Failed to load resource/.test(error.message));
}

async function chooseGermanInAppearance(page: Page): Promise<void> {
  await page.goto('/config', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Settings category panel' });
  await panel.getByRole('button', { name: 'Configure Display Settings', exact: true }).click();

  const germanChoice = page.getByRole('radio', { name: 'Deutsch', exact: true });
  await germanChoice.click();
  await expect(germanChoice).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('status').filter({ hasText: 'Dashboard-Sprache auf Deutsch umgestellt.' })).toHaveText(
    'Dashboard-Sprache auf Deutsch umgestellt.',
  );
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY)).toBe('de');
}

test.describe('dashboard German locale fan-in', () => {
  let fixture: SeededCodeUxProject | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    fixture = await prepareSelectedLocalGitProject(page, request, testInfo, 'dashboard-i18n');
    await request.patch(`/api/projects/${encodeURIComponent(fixture.project.id)}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { name: projectName },
    });
    await createSprintWithTasks(request, fixture.project.id, {
      sprint: { name: sprintName, goal: 'English user-authored sprint goal stays unchanged.' },
      tasks: [{ title: taskTitle, promptMarkdown: 'English **Markdown** task prompt stays unchanged.' }],
    });
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
    fixture = null;
  });

  test('switches immediately, persists, covers registered routes, and preserves authored data', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: CapturedError[] = [];
    let activeRoute = 'startup';
    page.on('pageerror', (error) => errors.push({ kind: 'pageerror', message: error.message, route: activeRoute }));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ kind: 'console', message: formatConsoleMessage(message), route: activeRoute });
    });

    await chooseGermanInAppearance(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'Einstellungen & Integrationen' })).toBeVisible();

    const projectSelector = page.getByRole('button', { name: new RegExp(`^Projektauswahl, ausgewähltes Projekt: ${projectName}`) });
    await projectSelector.click();
    await expect(page.getByRole('listbox', { name: 'Projektliste' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(projectSelector).toBeFocused();

    const searchTrigger = page.getByRole('button', { name: 'Arbeitsbereich durchsuchen' }).first();
    await searchTrigger.focus();
    await page.keyboard.press('Enter');
    const searchDialog = page.getByRole('dialog', { name: 'Suche' });
    await expect(searchDialog).toBeVisible();
    await expect(searchDialog.getByPlaceholder('Sprints, Aufgaben, Agenten, Vorschauen suchen...')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchTrigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Dies betrifft nur die Dashboard-Oberfläche.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const route of localizedRoutes) {
      activeRoute = route.path;
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(route.landmark(page)).toBeVisible();
      await expect(page.getByRole('main', { name: 'Hauptinhalt' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.goto('/projects');
    await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
    await page.goto('/sprints');
    await expect(page.getByText(sprintName, { exact: true }).first()).toBeVisible();
    const localizedDate = new Intl.DateTimeFormat('de', { month: 'short', day: 'numeric' }).format(new Date());
    await expect(page.getByText(localizedDate, { exact: false }).first()).toBeVisible();
    await page.goto('/tasks');
    await expect(page.getByRole('region', { name: 'Aufgabenboard', exact: true })).toBeVisible();
    await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible();
    await page.goto('/docs');
    await expect(page.getByRole('navigation', { name: 'Dokumentationsnavigation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Code UX Documentation', level: 1 })).toBeVisible();

    const unexpectedErrors = errors.filter((error) => !isExpectedAgentsStorageError(error));
    expect(unexpectedErrors, unexpectedErrors.map((error) => `${error.route} ${error.kind}: ${error.message}`).join('\n')).toEqual([]);
  });
});
