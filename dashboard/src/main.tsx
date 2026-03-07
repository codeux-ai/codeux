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
import "./styles.css";

// Route components — each dynamic import becomes its own chunk in the build
const DashboardV2   = lazy(() => import("./v2/DashboardV2.js").then(m => ({ default: m.DashboardV2 })));
const SprintsPage   = lazy(() => import("./v2/SprintsPage.js").then(m => ({ default: m.SprintsPage })));
const ProjectsPage  = lazy(() => import("./v2/ProjectsPage.js").then(m => ({ default: m.ProjectsPage })));
const ChatPage      = lazy(() => import("./v2/ChatPage.js").then(m => ({ default: m.ChatPage })));
const AgentsPage    = lazy(() => import("./v2/AgentsPage.js").then(m => ({ default: m.AgentsPage })));
const SettingsPage  = lazy(() => import("./v2/SettingsPage.js").then(m => ({ default: m.SettingsPage })));
const MemoryPage    = lazy(() => import("./v2/MemoryPage.js").then(m => ({ default: m.MemoryPage })));
const LegacyApp     = lazy(() => import("./legacy-app.js").then(m => ({ default: m.App })));

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
      <div className="flex flex-col h-screen overflow-hidden font-sans text-slate-900 dark:text-slate-200 bg-[#F9F8F4] dark:bg-void-900 transition-colors duration-700">
        {/* Warm ambient glows */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.04)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.06)_0%,_transparent_60%)] transition-colors duration-1000" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_110%_110%,_rgba(255,184,0,0.03)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_60%_40%_at_110%_110%,_rgba(255,184,0,0.05)_0%,_transparent_60%)] transition-colors duration-1000" />
        </div>

        <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
          <TopNav isDark={isDark} toggleTheme={toggleTheme} />

          <div className="flex-1 overflow-y-auto dashboard-scrollbar relative pb-32">
            {/* Suspense boundary: shows nothing while the route chunk loads */}
            <Suspense fallback={<div className="flex-1" />}>
              <Outlet />
            </Suspense>
          </div>
        </div>

        <KineticDock />
      </div>
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

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: LegacyApp,
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

const routeTree = rootRoute.addChildren([indexRoute, sprintsRoute, projectsRoute, chatRoute, agentsRoute, configRoute, memoryRoute, liveRoute]);
const router = createRouter({ routeTree });

// 4. Entry — legacy hash fallback preserved
const Root = () => {
  const [legacyHash, setLegacyHash] = useState(window.location.hash);

  useEffect(() => {
    const handler = () => setLegacyHash(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  if (legacyHash === "#legacy") {
    return (
      <Suspense fallback={null}>
        <LegacyApp />
      </Suspense>
    );
  }

  return <RouterProvider router={router} />;
};

const container = document.getElementById("app");
if (!container) throw new Error("Dashboard root element '#app' not found");

render(<Root />, container);
