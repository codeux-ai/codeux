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
import { TopNav } from "./v2/components/TopNav.js";
import { ProjectDataProvider } from "./v2/context/project-data.js";
import { SkeletonPanel } from "./v2/components/ui/ListSkeletons.js";
import { DashboardV2 } from "./v2/DashboardV2.js";
import { LiveSessionPage } from "./v2/LiveSessionPage.js";
import "./styles.css";

// Route components — each dynamic import becomes its own chunk in the build
const DeepOceanBackground = lazy(() => import("./v2/components/chat/DeepOceanBackground.js").then(m => ({ default: m.DeepOceanBackground })));
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
const IdleDeepOceanBackground = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let handle: any;
    if ("requestIdleCallback" in window) {
      handle = (window as any).requestIdleCallback(() => setMounted(true), { timeout: 2000 });
    } else {
      handle = window.setTimeout(() => setMounted(true), 500);
    }
    return () => {
      if ("requestIdleCallback" in window) {
        (window as any).cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <DeepOceanBackground />
    </Suspense>
  );
};

const rootRoute = createRootRoute({
  component: () => {
    const [isDark, setIsDark] = useState(true);

    useEffect(() => {
      const root = window.document.documentElement;
      const bg = isDark ? "#0d0f12" : "#dbe8f8";
      if (isDark) root.classList.add("dark");
      else root.classList.remove("dark");
      root.style.background = bg;
      document.body.style.background = bg;
    }, [isDark]);

    const toggleTheme = () => setIsDark(!isDark);

    return (
      <ProjectDataProvider>
        <div className="flex flex-col h-screen overflow-hidden font-sans text-slate-900 dark:text-slate-200 bg-[#F9F8F4] dark:bg-void-900 transition-colors duration-700">
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-slate-900 focus:font-bold focus:rounded-br-lg ">
            Skip to main content
          </a>
          <IdleDeepOceanBackground />

          <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
            <TopNav isDark={isDark} toggleTheme={toggleTheme} />

            <main id="main-content" tabIndex={-1} aria-label="Main content" className="flex-1 overflow-y-auto dashboard-scrollbar relative pb-32">
              <Suspense fallback={<div className="flex-1 p-8"><SkeletonPanel /></div>}>
                <Outlet />
              </Suspense>
            </main>
          </div>

          <KineticDock />
          <footer className="sr-only">Dashboard Footer</footer>
        </div>
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
