/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../../types.js";
import { planSourcesGridLayout, SourcesGrid } from "../SourcesGrid.js";
import { ProjectDataContext } from "../../context/project-data.js";
import { DashboardI18nProvider } from "../../i18n/index.js";
import type { DashboardLocale } from "../../i18n/locales.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T) => duration,
}));

const createSource = (id: number, updatedAt: string): Source => ({
  id: `project-${id}`,
  slug: `project-${id}`,
  name: `Project ${id}`,
  baseDir: `/tmp/project-${id}`,
  repoUrl: null,
  sourceType: "local",
  sourceRef: `/tmp/project-${id}`,
  initializationMode: "existing",
  gitProvider: "local",
  gitHostDomain: null,
  defaultBranch: "main",
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 0,
  openTasks: id,
  completedTasks: id * 2,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

const renderSourcesGrid = (projects: Source[], locale: DashboardLocale = "en", loading = false) => render(
  <DashboardI18nProvider initialLocale={locale} storage={null}>
    <ProjectDataContext.Provider
    value={{
      projects,
      selectedProjectId: null,
      selectedProject: null,
      loading,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    }}
  >
      <SourcesGrid />
    </ProjectDataContext.Provider>
  </DashboardI18nProvider>,
);

describe("SourcesGrid", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the five most recently updated project cells by default", () => {
    renderSourcesGrid([
      createSource(1, "2026-01-01T00:00:00.000Z"),
      createSource(2, "2026-01-02T00:00:00.000Z"),
      createSource(3, "2026-01-03T00:00:00.000Z"),
      createSource(4, "2026-01-04T00:00:00.000Z"),
      createSource(5, "2026-01-05T00:00:00.000Z"),
      createSource(6, "2026-01-06T00:00:00.000Z"),
    ]);

    expect(screen.getAllByRole("group")).toHaveLength(5);
    expect(screen.getByText("Project 6")).toBeInTheDocument();
    expect(screen.getByText("Project 2")).toBeInTheDocument();
    expect(screen.queryByText("Project 1")).not.toBeInTheDocument();
  });

  it("plans one-row visibility while at least three cells fit", () => {
    expect(planSourcesGridLayout(5, 8)).toEqual({ visibleCount: 5, columns: 5 });
    expect(planSourcesGridLayout(4, 8)).toEqual({ visibleCount: 4, columns: 4 });
    expect(planSourcesGridLayout(3, 8)).toEqual({ visibleCount: 3, columns: 3 });
  });

  it("plans two compact rows before a one-cell row would appear", () => {
    expect(planSourcesGridLayout(2, 8)).toEqual({ visibleCount: 4, columns: 2 });
    expect(planSourcesGridLayout(1, 8)).toEqual({ visibleCount: 4, columns: 2 });
    expect(planSourcesGridLayout(2, 3)).toEqual({ visibleCount: 2, columns: 2 });
  });

  it("spreads multi-card rows from the left edge to the right edge", () => {
    renderSourcesGrid([
      createSource(1, "2026-01-01T00:00:00.000Z"),
      createSource(2, "2026-01-02T00:00:00.000Z"),
      createSource(3, "2026-01-03T00:00:00.000Z"),
    ]);

    const grid = document.querySelector("[data-source-columns]") as HTMLElement;
    expect(grid.style.justifyContent).toBe("space-between");
    expect(grid.style.gridTemplateColumns).toContain("calc((100% - 48px) / 3)");
  });

  it("localizes German source state and counts without changing project names", () => {
    const source = { ...createSource(1234, "2026-01-06T00:00:00.000Z"), name: "Runtime Project Name", status: "running" } as Source;
    renderSourcesGrid([source], "de");

    expect(screen.getByRole("heading", { name: "Projekte & Quellen" })).toBeInTheDocument();
    expect(screen.getByText("Runtime Project Name")).toBeInTheDocument();
    expect(screen.getByText("Laufend")).toBeInTheDocument();
    expect(screen.getByText(`${new Intl.NumberFormat("de").format(1234)} offen`)).toBeInTheDocument();
  });

  it("announces German loading and empty states", () => {
    const loadingView = renderSourcesGrid([], "de", true);
    expect(screen.getByRole("status", { name: "Projekte und Quellen werden geladen" })).toHaveAttribute("aria-busy", "true");
    loadingView.unmount();

    renderSourcesGrid([], "de");
    expect(screen.getByRole("status")).toHaveTextContent("Keine Projekte oder Quellen");
  });
});
