import { render } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { KineticDock } from "./v2/components/KineticDock.js";
import { Sidebar } from "./v2/components/layout/Sidebar.js";
import { TopNav } from "./v2/components/TopNav.js";
import { ProjectDataProvider, useProjectData } from "./v2/context/project-data.js";
import { ToastProvider } from "./v2/components/feedback/ToastProvider.js";
import { useProjectEffectiveSettings } from "./v2/hooks/use-project-effective-settings.js";
import { fetchSystemSettings } from "./v2/lib/settings-api.js";
import type { DashboardSettings, SystemSettings } from "./types.js";
import { SkeletonPanel } from "./v2/components/layout/SkeletonLoader.js";
import { DashboardV2 } from "./v2/DashboardV2.js";
import { LiveSessionPage } from "./v2/LiveSessionPage.js";
import { OnboardingExperience } from "./v2/components/onboarding/OnboardingExperience.js";
import { GuidedDashboardTour } from "./v2/components/onboarding/GuidedDashboardTour.js";
import { TitleBar } from "./v2/components/TitleBar.js";
import "./styles.css";

const isElectron = typeof window !== "undefined" && Boolean(window.codeUxDesktop);
if (isElectron && typeof document !== "undefined") {
  document.documentElement.classList.add("is-electron");
  document.body.classList.add("is-electron");

  const syncWindowClasses = (state: { isMaximized: boolean; isFullScreen: boolean }) => {
    document.documentElement.classList.toggle("is-maximized", state.isMaximized);
    document.documentElement.classList.toggle("is-fullscreen", state.isFullScreen);
  };

  void window.codeUxDesktop!.window!.getState().then(syncWindowClasses);
  window.codeUxDesktop!.window!.onStateChange(syncWindowClasses);
}

import { applyAppearanceSettings } from "./v2/lib/apply-appearance.js";
import { BACKGROUND_PATTERNS } from "./v2/lib/background-patterns.js";

const BackgroundManager = lazy(() => import("./v2/components/backgrounds/BackgroundManager.js").then((module) => ({
  default: module.BackgroundManager,
})));

// 0. AppLayout extracted to use context hooks
const AppLayout = () => {
  const { selectedProject } = useProjectData();
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [appearancePreview, setAppearancePreview] = useState<DashboardSettings["appearance"] | null>(null);

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSystemSettings = async () => {
      try {
        const settings = await fetchSystemSettings();
        if (!cancelled) {
          setSystemSettings(settings);
        }
      } catch (error) {
        console.error("Failed to load system settings:", error);
      }
    };
    void loadSystemSettings();
    const handler = () => void loadSystemSettings();
    window.addEventListener("codeux:settings-updated", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("codeux:settings-updated", handler);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ appearance?: DashboardSettings["appearance"] | null }>).detail;
      setAppearancePreview(detail?.appearance ?? null);
    };
    window.addEventListener("codeux:appearance-preview", handler);
    return () => window.removeEventListener("codeux:appearance-preview", handler);
  }, []);

  const appearanceSettings = appearancePreview || effectiveSettings?.settings.appearance || systemSettings?.defaults.appearance;
  const appearanceTheme = appearanceSettings?.theme || "SYSTEM";
  const reducedMotion = appearanceSettings?.reducedMotion || "AUTO";
  const backgroundPattern = appearanceSettings?.backgroundPattern || "HEXAGONS";
  const backgroundImage = appearanceSettings?.backgroundImage;
  // On a low-power render profile (e.g. the desktop app under WSL, where the GPU is software-only
  // and requestAnimationFrame has no vsync to pace it) the animated WebGL/canvas backgrounds
  // busy-spin and peg the renderer, freezing the app. Force the static background there.
  const lowPowerRenderer = typeof window !== "undefined" && window.codeUxDesktop?.renderProfile === "low-power";
  const backgroundMode = lowPowerRenderer ? "STATIC" : (appearanceSettings?.backgroundMode || "ANIMATED");
  const animatedBackground = appearanceSettings?.animatedBackground || "deep-ocean";
  const staticBackgroundColor = appearanceSettings?.staticBackgroundColor || "#0d0f12";
  const zoomLevel = appearanceSettings?.zoomLevel ?? 1;
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    if (appearanceTheme === "SYSTEM") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return appearanceTheme === "DARK";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (appearanceTheme === "SYSTEM") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
      setIsDark(mediaQuery.matches);
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", listener);
      } else {
        mediaQuery.addListener(listener);
      }
      return () => {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener("change", listener);
        } else {
          mediaQuery.removeListener(listener);
        }
      };
    } else {
      setIsDark(appearanceTheme === "DARK");
    }
  }, [appearanceTheme]);

  useEffect(() => {
    applyAppearanceSettings({ theme: isDark ? "DARK" : "LIGHT" });
  }, [isDark]);

  useEffect(() => {
    applyAppearanceSettings({ backgroundImage });
  }, [backgroundImage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = window.document.documentElement;
    if (reducedMotion === "REDUCE" || (reducedMotion === "AUTO" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      root.setAttribute("data-reduced-motion", "true");
    } else {
      root.removeAttribute("data-reduced-motion");
    }
  }, [reducedMotion]);

  useEffect(() => {
    applyAppearanceSettings({ backgroundPattern });
  }, [backgroundPattern]);

  useEffect(() => {
    applyAppearanceSettings({ zoomLevel });
  }, [zoomLevel]);

  const navMode = appearanceSettings?.navigationMode || "DOCK";
  const showSidebar = isMobile || navMode === "SIDEBAR";

  return (
    <div className="app-shell flex flex-col h-screen overflow-hidden font-sans text-slate-900 dark:text-slate-200 bg-[#F9F8F4] dark:bg-void-900 transition-colors duration-700">
      {isElectron && <TitleBar />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {showSidebar && <Sidebar isMobile={isMobile} isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)} />}

      <div className="flex flex-col flex-1 h-full overflow-hidden relative">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-slate-900 focus:font-bold focus:rounded-br-lg ">
          Skip to main content
        </a>
        {/*
          Keep the Suspense boundary permanently mounted and only toggle its
          child. Replacing the boundary with a plain <div> when a background
          image is set tears down the Suspense node, which makes Preact remount
          the sibling <Outlet> — that reset wiped in-progress edits (e.g. an
          uploaded background image) and looked like a full page reload.
        */}
        <Suspense fallback={null}>
          {!backgroundImage && (
            <BackgroundManager
              mode={backgroundMode}
              animation={animatedBackground}
              staticColor={staticBackgroundColor}
              isDark={isDark}
            />
          )}
        </Suspense>
        {backgroundImage && (
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${backgroundImage})`, zIndex: 0, contain: "strict" }}
          />
        )}
        {backgroundPattern !== "NONE" && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              backgroundImage: BACKGROUND_PATTERNS[backgroundPattern] || undefined,
              backgroundRepeat: "repeat",
              zIndex: 1,
              contain: "strict",
            }}
          />
        )}

        <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
          <TopNav
            onMenuToggle={() => setIsMobileSidebarOpen(prev => !prev)}
            isMobile={isMobile}
            hideLogo={!isMobile && navMode === "SIDEBAR"}
          />

          <main id="main-content" tabIndex={-1} aria-label="Main content" className={`flex-1 overflow-y-auto dashboard-scrollbar relative ${showSidebar ? '' : 'pb-32'}`} style={{ contain: 'layout style' }}>
            <Suspense fallback={<div className="flex-1 p-8"><SkeletonPanel /></div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>

        {!showSidebar && <KineticDock />}
        <OnboardingExperience />
        <GuidedDashboardTour />
        <footer className="sr-only">Dashboard Footer</footer>
      </div>
      </div>
    </div>
  );
};

// Route components — each dynamic import becomes its own chunk in the build
const SprintsPage   = lazy(() => import("./v2/pages/sprints/SprintsPage.js").then(m => ({ default: m.SprintsPage })));
const ProjectsPage  = lazy(() => import("./v2/ProjectsPage.js").then(m => ({ default: m.ProjectsPage })));
const ChatPage      = lazy(() => import("./v2/ChatPage.js").then(m => ({ default: m.ChatPage })));
const TasksPage     = lazy(() => import("./v2/TasksPage.js").then(m => ({ default: m.TasksPage })));
const AgentsPage    = lazy(() => import("./v2/AgentsPage.js").then(m => ({ default: m.AgentsPage })));
const StatsPage     = lazy(() => import("./v2/StatsPage.js").then(m => ({ default: m.StatsPage })));
const SchedulerPage = lazy(() => import("./v2/SchedulerPage.js").then(m => ({ default: m.SchedulerPage })));
const SettingsPage  = lazy(() => import("./v2/SettingsPage.js").then(m => ({ default: m.SettingsPage })));
const MemoryPage    = lazy(() => import("./v2/MemoryPage.js").then(m => ({ default: m.MemoryPage })));
const BrowserPage   = lazy(() => import("./v2/BrowserPage.js").then(m => ({ default: m.BrowserPage })));
const FileBrowserPage = lazy(() => import("./v2/FileBrowserPage.js").then(m => ({ default: m.FileBrowserPage })));
const ErrorPage     = lazy(() => import("./v2/ErrorPage.js").then(m => ({ default: m.ErrorPage })));

// 1. Root layout route
const rootRoute = createRootRoute({
  notFoundComponent: ErrorPage,
  component: () => {
    return (
      <ToastProvider>
        <ProjectDataProvider>
        <AppLayout />
      </ProjectDataProvider>
      </ToastProvider>
    );
  },
});

// 2. Routes
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardV2,
});

const sprintsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sprints",
  component: SprintsPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksPage,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
});

const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsPage,
});

const schedulerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scheduler",
  component: SchedulerPage,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: LiveSessionPage,
});

// 3. Router
const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: SettingsPage,
});

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory",
  component: MemoryPage,
});

const browserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browser",
  component: BrowserPage,
});

const fileBrowserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  component: FileBrowserPage,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: ErrorPage,
});

const routeTree = rootRoute.addChildren([indexRoute, sprintsRoute, tasksRoute, projectsRoute, chatRoute, agentsRoute, statsRoute, schedulerRoute, configRoute, memoryRoute, browserRoute, fileBrowserRoute, liveRoute, notFoundRoute]);
// `defaultPreload: "intent"` warms route matching on hover/focus; the page chunks themselves are
// prefetched explicitly by the nav components via prefetchRoute() since they are Preact-lazy.
const router = createRouter({ routeTree, defaultPreload: "intent", defaultPreloadDelay: 50 });

// 4. Entry
const Root = () => <RouterProvider router={router} />;

const container = document.getElementById("app");
if (!container) throw new Error("Dashboard root element '#app' not found");

render(<Root />, container);
