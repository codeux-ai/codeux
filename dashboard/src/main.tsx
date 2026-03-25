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
import "./styles.css";

// Route components — each dynamic import becomes its own chunk in the build
const DashboardV2   = lazy(() => import("./v2/DashboardV2.js").then(m => ({ default: m.DashboardV2 })));
const SprintsPage   = lazy(() => import("./v2/pages/sprints/SprintsPage.js").then(m => ({ default: m.SprintsPage })));
const ProjectsPage  = lazy(() => import("./v2/ProjectsPage.js").then(m => ({ default: m.ProjectsPage })));
const ChatPage      = lazy(() => import("./v2/ChatPage.js").then(m => ({ default: m.ChatPage })));
const TasksPage     = lazy(() => import("./v2/TasksPage.js").then(m => ({ default: m.TasksPage })));
const AgentsPage    = lazy(() => import("./v2/AgentsPage.js").then(m => ({ default: m.AgentsPage })));
const StatsPage     = lazy(() => import("./v2/StatsPage.js").then(m => ({ default: m.StatsPage })));
const SettingsPage  = lazy(() => import("./v2/SettingsPage.js").then(m => ({ default: m.SettingsPage })));
const MemoryPage    = lazy(() => import("./v2/MemoryPage.js").then(m => ({ default: m.MemoryPage })));
const LiveSessionPage = lazy(() => import("./v2/LiveSessionPage.js").then(m => ({ default: m.LiveSessionPage })));

// 1. Root layout route
const rootRoute = createRootRoute({
  component: () => {
    const [isDark, setIsDark] = useState(true);

    useEffect(() => {
      const root = window.document.documentElement;
      if (isDark) root.classList.add("dark");
      else root.classList.remove("dark");
    }, [isDark]);

    const toggleTheme = () => setIsDark(!isDark);

    return (
      <ProjectDataProvider>
        <div className="flex flex-col h-screen overflow-hidden font-sans text-slate-900 dark:text-slate-200 bg-[#F9F8F4] dark:bg-void-900 transition-colors duration-700">
          {/* Warm ambient glows */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.04)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.06)_0%,_transparent_60%)] transition-colors duration-1000" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_110%_110%,_rgba(255,184,0,0.03)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_60%_40%_at_110%_110%,_rgba(255,184,0,0.05)_0%,_transparent_60%)] transition-colors duration-1000" />
          </div>

          <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
            <TopNav isDark={isDark} toggleTheme={toggleTheme} />

            <div className="flex-1 overflow-y-auto dashboard-scrollbar relative pb-32">
              <Suspense fallback={<div className="flex-1" />}>
                <Outlet />
              </Suspense>
            </div>
          </div>

          <KineticDock />
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

const routeTree = rootRoute.addChildren([indexRoute, sprintsRoute, tasksRoute, projectsRoute, chatRoute, agentsRoute, statsRoute, configRoute, memoryRoute, liveRoute]);
const router = createRouter({ routeTree });

// 4. Entry
const Root = () => <RouterProvider router={router} />;

const container = document.getElementById("app");
if (!container) throw new Error("Dashboard root element '#app' not found");

render(<Root />, container);
