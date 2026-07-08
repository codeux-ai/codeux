// Warms the lazy-loaded page chunk for a route ahead of navigation. The pages are code-split
// via Preact `lazy()` in main.tsx, so the chunk normally only downloads once the route renders,
// adding a visible suspense flash on first visit. Triggering the same dynamic `import()` on
// pointer/focus intent (hover, touch-start, keyboard focus) downloads the chunk in the background
// so the page is already in the module cache by the time the user clicks.
//
// The specifiers below resolve to the exact modules used by main.tsx's `lazy()` calls; the bundler
// and the ESM module cache dedupe by resolved module id, so a prefetch and the later `lazy()` load
// share one chunk and one in-flight request.
import type { DashboardFeatureFlagMap, DashboardFeatureId } from "../lib/dashboard-feature-flags.js";
import { isDashboardFeatureEnabled } from "../lib/dashboard-feature-flags.js";

type ModuleImporter = () => Promise<unknown>;

interface ComponentImporterEntry {
  importer: ModuleImporter;
  feature?: DashboardFeatureId;
}

const componentImporters: Record<string, ComponentImporterEntry> = {
  "/sprints": { importer: () => import("../pages/sprints/SprintsPage.js") },
  "/projects": { importer: () => import("../ProjectsPage.js") },
  "/chat": { importer: () => import("../ChatPage.js") },
  "/tasks": { importer: () => import("../TasksPage.js") },
  "/agents": { importer: () => import("../AgentsPage.js") },
  "/nodes": { importer: () => import("../NodesPage.js"), feature: "nodes" },
  "/stats": { importer: () => import("../StatsPage.js") },
  "/scheduler": { importer: () => import("../SchedulerPage.js") },
  "/config": { importer: () => import("../SettingsPage.js") },
  "/memory": { importer: () => import("../MemoryPage.js") },
  "/knowledge": { importer: () => import("../KnowledgePage.js") },
  "/browser": { importer: () => import("../BrowserPage.js") },
  "/files": { importer: () => import("../FileBrowserPage.js") },
  "/docs": { importer: () => import("../docs-web/DocsWebPage.js") },
};

const startedPaths = new Set<string>();

export const canPrefetchRoute = (path: string, featureFlags?: DashboardFeatureFlagMap): boolean => {
  const entry = componentImporters[path];
  return Boolean(entry && (!entry.feature || isDashboardFeatureEnabled(entry.feature, featureFlags)));
};

/**
 * Begin downloading the chunk for `path` if it is code-split and not already requested.
 * Safe to call repeatedly and on every pointer event — it is a no-op after the first call,
 * and a failed prefetch is reset so a later real navigation can retry.
 */
export const prefetchRoute = (path: string): void => {
  const entry = componentImporters[path];
  if (!entry || !canPrefetchRoute(path) || startedPaths.has(path)) {
    return;
  }
  startedPaths.add(path);
  void entry.importer().catch(() => {
    // Allow a real navigation (or a later intent) to retry the load.
    startedPaths.delete(path);
  });
};
