/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KineticDock } from "../../../dashboard/src/v2/components/KineticDock.js";
import { Sidebar } from "../../../dashboard/src/v2/components/layout/Sidebar.js";
import type { DashboardExperienceMode } from "../../../dashboard/src/types.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

const mocks = vi.hoisted(() => ({
  useProjectData: vi.fn(),
  useProjectEffectiveSettings: vi.fn(),
  useReducedMotion: vi.fn(),
  useRouterState: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const { forwardRef } = await vi.importActual<typeof import("preact/compat")>("preact/compat");
  return {
    Link: forwardRef(({ children, to, ...props }: any, ref: any) => (
      <a ref={ref} href={to} {...props}>
        {children}
      </a>
    )),
    useRouterState: mocks.useRouterState,
  };
});

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: mocks.useProjectData,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: mocks.useProjectEffectiveSettings,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: mocks.useReducedMotion,
  useResolvedMotionDuration: (duration: string) => duration,
}));

vi.mock("../../../dashboard/src/v2/router/route-prefetch.js", () => ({
  prefetchRoute: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/motion/index.js", () => ({
  useAnimatedActiveIndicator: vi.fn(() => ({ style: {} })),
  useGsapInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: 0, ease: "power2.out" },
    enterExit: { duration: 0, ease: "power2.out" },
    expansionCollapse: { duration: 0, ease: "power2.inOut" },
    selectionMovement: { duration: 0, ease: "power2.out" },
    listReveal: { duration: 0, ease: "power2.out" },
    listReorder: { duration: 0, ease: "power2.out" },
    inlineValidation: { duration: 0, ease: "elastic.out(1, 0.4)" },
    asyncFeedback: { duration: 0, ease: "linear" },
  })),
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    enterExit: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    expansionCollapse: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    selectionMovement: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    listReveal: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    listReorder: { duration: "0ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
    inlineValidation: { duration: "0ms", ease: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    asyncFeedback: { duration: "0ms", ease: "linear" },
  })),
}));

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
  },
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const knownDockLabels = new Set([
  "Chat",
  "Overview",
  "Sprints",
  "Tasks",
  "Agents",
  "Nodes",
  "Stats",
  "Schedule",
  "Memory",
  "Knowledge",
  "Browser",
  "Files",
  "Live",
  "Docs",
  "Config",
]);

const knownSidebarLabels = new Set([
  "Chat",
  "Overview",
  "Sprints",
  "Tasks",
  "Agents",
  "Nodes",
  "Stats",
  "Schedule",
  "Memory",
  "Knowledge",
  "Browser Preview",
  "Files",
  "Live",
  "Docs",
  "Settings",
]);

const modeExpectations: Array<{
  mode: DashboardExperienceMode;
  dock: string[];
  sidebar: string[];
}> = [
  {
    mode: "EASY",
    dock: ["Chat", "Sprints", "Browser", "Stats", "Live", "Config", "Docs"],
    sidebar: ["Chat", "Sprints", "Browser Preview", "Stats", "Live", "Settings", "Docs"],
  },
  {
    mode: "STANDARD",
    dock: ["Chat", "Overview", "Sprints", "Tasks", "Agents", "Nodes", "Stats", "Schedule", "Browser", "Live", "Docs", "Config"],
    sidebar: ["Chat", "Overview", "Sprints", "Tasks", "Agents", "Nodes", "Stats", "Schedule", "Browser Preview", "Live", "Docs", "Settings"],
  },
  {
    mode: "EXPERT",
    dock: ["Chat", "Overview", "Sprints", "Tasks", "Agents", "Nodes", "Stats", "Schedule", "Memory", "Knowledge", "Browser", "Files", "Live", "Docs", "Config"],
    sidebar: ["Chat", "Overview", "Sprints", "Tasks", "Agents", "Nodes", "Stats", "Schedule", "Memory", "Knowledge", "Browser Preview", "Files", "Live", "Docs", "Settings"],
  },
];

function setEffectiveSettings(mode: DashboardExperienceMode, sprintPreview = { enabled: true, showInAppBrowser: true }): void {
  mocks.useProjectEffectiveSettings.mockReturnValue({
    data: {
      settings: {
        appearance: { experienceMode: mode },
        sprintPreview,
      },
    },
  });
}

function getDockNavigationLabels(): string[] {
  const dock = screen.getByRole("navigation", { name: "Dock navigation" });
  return within(dock)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") || "")
    .filter((label) => knownDockLabels.has(label));
}

function getSidebarNavigationLabels(): string[] {
  const sidebar = screen.getByLabelText("Primary navigation");
  return within(sidebar)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") || "")
    .filter((label) => knownSidebarLabels.has(label));
}

describe("primary navigation experience modes", () => {
  beforeEach(() => {
    localStorage.setItem("codeux:sidebar:minimized", "false");
    mocks.useProjectData.mockReturnValue({ selectedProject: { id: "project-1" } });
    mocks.useReducedMotion.mockReturnValue(true);
    mocks.useRouterState.mockReturnValue([{ pathname: "/chat" }]);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  modeExpectations.forEach(({ mode, dock, sidebar }) => {
    it(`renders ${mode} mode items in the dock`, () => {
      setEffectiveSettings(mode);

      render(<KineticDock />);

      expect(getDockNavigationLabels()).toEqual(dock);
      expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    });

    it(`renders ${mode} mode items in the sidebar`, () => {
      setEffectiveSettings(mode);

      render(<Sidebar />);

      expect(getSidebarNavigationLabels()).toEqual(sidebar);
      expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    });
  });

  it("applies Browser visibility after Easy mode filtering in the dock", () => {
    setEffectiveSettings("EASY", { enabled: false, showInAppBrowser: false });

    render(<KineticDock />);

    expect(getDockNavigationLabels()).toEqual(["Chat", "Sprints", "Stats", "Live", "Config", "Docs"]);
    expect(screen.queryByRole("link", { name: "Browser" })).not.toBeInTheDocument();
  });

  it("uses the same stable navigation labels across German dock and sidebar surfaces", () => {
    setEffectiveSettings("EASY");
    render(<DashboardI18nProvider initialLocale="de"><KineticDock /></DashboardI18nProvider>);
    expect(screen.getByRole("navigation", { name: "Dock-Navigation" })).toHaveTextContent("Dokumentation");
    cleanup();

    render(<DashboardI18nProvider initialLocale="de"><Sidebar /></DashboardI18nProvider>);
    expect(screen.getByLabelText("Hauptnavigation")).toHaveTextContent("Dokumentation");
    expect(screen.getByRole("link", { name: "Dokumentation" })).toHaveAttribute("href", "/docs");
  });
});
