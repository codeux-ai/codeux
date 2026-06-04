// Warms the lazy-loaded page chunk for a route ahead of navigation. The pages are code-split
// via Preact `lazy()` in main.tsx, so the chunk normally only downloads once the route renders,
// adding a visible suspense flash on first visit. Triggering the same dynamic `import()` on
// pointer/focus intent (hover, touch-start, keyboard focus) downloads the chunk in the background
// so the page is already in the module cache by the time the user clicks.
//
// The specifiers below resolve to the exact modules used by main.tsx's `lazy()` calls; the bundler
// and the ESM module cache dedupe by resolved module id, so a prefetch and the later `lazy()` load
// share one chunk and one in-flight request.
type ModuleImporter = () => Promise<unknown>;

const componentImporters: Record<string, ModuleImporter> = {
  "/sprints": () => import("../pages/sprints/SprintsPage.js"),
  "/projects": () => import("../ProjectsPage.js"),
  "/chat": () => import("../ChatPage.js"),
  "/tasks": () => import("../TasksPage.js"),
  "/agents": () => import("../AgentsPage.js"),
  "/stats": () => import("../StatsPage.js"),
  "/scheduler": () => import("../SchedulerPage.js"),
  "/config": () => import("../SettingsPage.js"),
  "/memory": () => import("../MemoryPage.js"),
  "/browser": () => import("../BrowserPage.js"),
  "/files": () => import("../FileBrowserPage.js"),
};

const startedPaths = new Set<string>();

/**
 * Begin downloading the chunk for `path` if it is code-split and not already requested.
 * Safe to call repeatedly and on every pointer event — it is a no-op after the first call,
 * and a failed prefetch is reset so a later real navigation can retry.
 */
export const prefetchRoute = (path: string): void => {
  const importer = componentImporters[path];
  if (!importer || startedPaths.has(path)) {
    return;
  }
  startedPaths.add(path);
  void importer().catch(() => {
    // Allow a real navigation (or a later intent) to retry the load.
    startedPaths.delete(path);
  });
};
