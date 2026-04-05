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
import { Sidebar } from "./v2/components/Sidebar.js";
import { TopNav } from "./v2/components/TopNav.js";
import { ProjectDataProvider, useProjectData } from "./v2/context/project-data.js";
import { useProjectEffectiveSettings } from "./v2/hooks/use-project-effective-settings.js";
import { SkeletonPanel } from "./v2/components/ui/ListSkeletons.js";
import { DashboardV2 } from "./v2/DashboardV2.js";
import { LiveSessionPage } from "./v2/LiveSessionPage.js";
import { DeepOceanBackground } from "./v2/components/chat/DeepOceanBackground.js";
import "./styles.css";

// 0. AppLayout extracted to use context hooks
const AppLayout = () => {
  const { selectedProject } = useProjectData();
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const appearanceTheme = effectiveSettings?.settings.appearance?.theme || "SYSTEM";
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
    const root = window.document.documentElement;
    const bg = isDark ? "#0d0f12" : "#dbe8f8";
    if (isDark) root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.background = bg;
    document.body.style.background = bg;
  }, [isDark]);

  const toggleTheme = () => {
    // If the theme is currently controlled by the user, we can temporarily override it
    // Wait, the requirement says "integrate the Light/Dark theme preference into the app."
    // It's probably best if toggleTheme still toggles it but maybe doesn't persist if they want to override?
    // The requirements say: "Implement a root-level effect that applies the 'dark' class to the html element based on the appearance.theme setting."
    // And "Preserve the 'Warm Void' aesthetic across both Light and Dark modes."
    // Let's just update local state if they click toggle
    setIsDark((prev) => !prev);
  };

  const navMode = effectiveSettings?.settings.appearance?.navigationMode || "DOCK";
  const showSidebar = isMobile || navMode === "SIDEBAR";

  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-900 dark:text-slate-200 bg-[#F9F8F4] dark:bg-void-900 transition-colors duration-700">
      {showSidebar && <Sidebar isMobile={isMobile} isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)} />}

      <div className="flex flex-col flex-1 h-screen overflow-hidden relative">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-slate-900 focus:font-bold focus:rounded-br-lg ">
          Skip to main content
        </a>
        <DeepOceanBackground />

        <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
          <TopNav isDark={isDark} toggleTheme={toggleTheme} onMenuToggle={() => setIsMobileSidebarOpen(prev => !prev)} isMobile={isMobile} />

          <main id="main-content" tabIndex={-1} aria-label="Main content" className={`flex-1 overflow-y-auto dashboard-scrollbar relative ${showSidebar ? '' : 'pb-32'}`}>
            <Suspense fallback={<div className="flex-1 p-8"><SkeletonPanel /></div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>

        {!showSidebar && <KineticDock />}
        <footer className="sr-only">Dashboard Footer</footer>
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
const SettingsPage  = lazy(() => import("./v2/SettingsPage.js").then(m => ({ default: m.SettingsPage })));
const MemoryPage    = lazy(() => import("./v2/MemoryPage.js").then(m => ({ default: m.MemoryPage })));
const BrowserPage   = lazy(() => import("./v2/BrowserPage.js").then(m => ({ default: m.BrowserPage })));

// 1. Root layout route
const rootRoute = createRootRoute({
  component: () => {
    return (
      <ProjectDataProvider>
        <AppLayout />
      </ProjectDataProvider>
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

const routeTree = rootRoute.addChildren([indexRoute, sprintsRoute, tasksRoute, projectsRoute, chatRoute, agentsRoute, statsRoute, configRoute, memoryRoute, browserRoute, liveRoute]);
const router = createRouter({ routeTree });

// 4. Entry
const Root = () => <RouterProvider router={router} />;

const container = document.getElementById("app");
if (!container) throw new Error("Dashboard root element '#app' not found");

render(<Root />, container);
