/** @vitest-environment happy-dom */
/** @jsx h */
import { h, type ComponentChildren } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render as testingRender, screen, waitFor, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { ProjectsPage } from "../../../dashboard/src/v2/ProjectsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useToast } from "../../../dashboard/src/v2/components/feedback/ToastProvider.js";
import { startProjectSetup } from "../../../dashboard/src/v2/lib/project-api.js";
import { fetchProjectInvocations } from "../../../dashboard/src/v2/lib/invocation-api.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import type { DashboardLocale } from "../../../dashboard/src/v2/i18n/locales.js";

expect.extend(matchers);

const render = (children: ComponentChildren, locale: DashboardLocale = "en") => testingRender(
  <DashboardI18nProvider initialLocale={locale} storage={null}>{children}</DashboardI18nProvider>,
);

const navigateMock = vi.fn();
const selectProjectMock = vi.fn(() => Promise.resolve());
const deleteProjectMock = vi.fn(() => Promise.resolve());
const createProjectMock = vi.fn(() => Promise.resolve({}));
const addToastMock = vi.fn();

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

vi.mock("gsap", () => ({
  default: {
    to: vi.fn((_target: unknown, vars: { onComplete?: () => void }) => {
      vars.onComplete?.();
    }),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../dashboard/src/v2/context/project-data.js")>();
  return {
    ...actual,
    useProjectData: vi.fn(),
  };
});

vi.mock("../../../dashboard/src/v2/components/feedback/ToastProvider.js", () => ({
  useToast: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/components/ui/AddProjectModal.js", () => ({
  AddProjectModal: ({ onClose, onAdd, initialSourceType, quickActionDefaults }: any) => h(
    "div",
    {
      "data-testid": "add-project-modal",
      "data-initial-source-type": initialSourceType || "",
      "data-quickaction-kind": quickActionDefaults?.applicationKind || "",
    },
    h("button", { type: "button", onClick: onClose }, "Close"),
    h("button", {
      type: "button",
      onClick: () => void onAdd({
        name: "Imported Local",
        type: "local",
        path: "/workspace/imported-local",
      }),
    }, "Submit local import"),
    h("button", {
      type: "button",
      onClick: () => void onAdd({
        name: "New Local App",
        type: "new_project",
        path: "/workspace/new-local-app",
        initMode: "new-local",
        selectedTechstackId: "react-saas",
        applicationKind: "web",
      }),
    }, "Submit new local app"),
    h("button", {
      type: "button",
      onClick: () => void onAdd({
        name: "New Remote App",
        type: "new_project",
        path: "",
        initMode: "new-remote",
        repoSlug: "new-remote-app",
        remoteProvider: "github",
        isPrivate: true,
        selectedTechstackId: "react-saas",
        applicationKind: "desktop",
      }),
    }, "Submit new remote app"),
  ),
}));

vi.mock("../../../dashboard/src/v2/components/ui/WaveFluid.js", () => ({
  WaveFluid: () => h("div", { "data-testid": "wave-fluid" }),
}));

vi.mock("../../../dashboard/src/v2/components/ui/BorderTrace.js", () => ({
  BorderTrace: () => h("div", { "data-testid": "border-trace" }),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  startProjectSetup: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/router/route-prefetch.js", () => ({
  prefetchRoute: vi.fn(),
}));

const createProject = (overrides: Record<string, unknown> = {}) => ({
  id: "project-1",
  slug: "project-one",
  name: "Widget Service",
  baseDir: "/workspace/widget-service",
  repoUrl: "https://github.com/acme/widget-service.git",
  sourceType: "git",
  sourceRef: "https://github.com/acme/widget-service.git",
  gitProvider: "github",
  gitHostDomain: "github.com",
  defaultBranch: "main",
  featureBranchPrefix: "feature/",
  status: "idle",
  sprintsCount: 4,
  openTasks: 2,
  completedTasks: 6,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: "2026-01-04T05:06:07.000Z",
  lastRunStatus: "completed",
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-03T04:05:06.000Z",
  ...overrides,
});

describe("ProjectsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/projects");
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(startProjectSetup).mockResolvedValue({
      accepted: true,
      projectId: "project-1",
      invocationId: "invocation-1",
      agentId: "agent-1",
    });
    vi.mocked(useToast).mockReturnValue({ addToast: addToastMock } as any);
    vi.mocked(useProjectData).mockReturnValue({
      projects: [createProject()],
      selectedProjectId: "project-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: createProject(),
    } as any);
  });

  it("applies a project fallback query when another project is selected", async () => {
    window.history.replaceState({}, "", "/projects?projectId=project-9");
    vi.mocked(useProjectData).mockReturnValue({
      projects: [createProject(), { ...createProject(), id: "project-9", name: "Notification Project" }],
      selectedProjectId: "project-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: createProject(),
    } as any);

    render(<ProjectsPage />);
    expect(screen.getByRole("list", { name: "Projects" })).toBeInTheDocument();

    await waitFor(() => expect(selectProjectMock).toHaveBeenCalledWith("project-9"));
  });

  it("renders semantic cards and truncates normalized long metadata", () => {
    const longName = "A very very long project name that should definitely be truncated";
    const longRepository = "https://github.com/acme/a-very-very-long-project-name-that-should-definitely-be-truncated.git";
    const longBranch = "a-very-very-long-branch-name-that-should-definitely-be-truncated";
    vi.mocked(useProjectData).mockReturnValue({
      projects: [{
        ...createProject(),
        name: longName,
        repoUrl: longRepository,
        sourceRef: longRepository,
        defaultBranch: longBranch,
      }],
      selectedProjectId: "project-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: createProject(),
    } as any);
    render(<ProjectsPage />);

    const card = screen.getByRole("article", { name: `Project: ${longName}` });
    expect(card).toHaveAttribute("data-selected", "true");

    const title = screen.getByTestId("project-name");
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", longName);
    expect(screen.getByTestId("project-location")).toHaveClass("truncate", "min-w-0");
    expect(screen.getByTestId("project-location")).toHaveAttribute("title", longRepository);
    expect(screen.getByTestId("project-branch")).toHaveClass("truncate", "min-w-0");
    expect(screen.getByTestId("project-branch")).toHaveAttribute("title", longBranch);
  });

  it("supports keyboard selection and isolates settings, setup, and delete actions", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    expect(screen.getByText("https://github.com/acme/widget-service.git")).toBeInTheDocument();
    expect(screen.getByText("Jan 4, 2026, 5:06 AM")).toBeInTheDocument();

    const selectionSurface = screen.getByRole("button", { name: "Selected project: Widget Service" });
    expect(selectionSurface).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "Widget Service is selected" })).toHaveTextContent("Selected");
    selectionSurface.focus();
    await user.keyboard("{Enter}");
    expect(selectProjectMock).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    expect(screen.getByRole("dialog", { name: "Setup Widget Service" })).toBeInTheDocument();
    expect(selectProjectMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Project settings" }));
    expect(selectProjectMock).toHaveBeenCalledTimes(2);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/config" });

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete Widget Service?" });
    expect(deleteProjectMock).not.toHaveBeenCalled();
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledOnce());
    expect(selectProjectMock).toHaveBeenCalledTimes(2);
  });

  it("shows correct filter counts and preserves active project selection across every filter", () => {
    const projects = [
      createProject({ id: "running-1", name: "Running One", status: "running", isRunning: true }),
      createProject({ id: "idle-1", name: "Idle One", status: "idle" }),
      createProject({ id: "failed-1", name: "Failed One", status: "failed" }),
      createProject({ id: "review-1", name: "Review One", status: "intervention" }),
    ];
    vi.mocked(useProjectData).mockReturnValue({
      projects,
      selectedProjectId: "idle-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: projects[1],
    } as any);

    render(<ProjectsPage />);

    const expectedFilters = [
      { name: "All 4", visible: ["Running One", "Idle One", "Failed One", "Review One"] },
      { name: "Running 1", visible: ["Running One"] },
      { name: "Idle 1", visible: ["Idle One"] },
      { name: "Failed 1", visible: ["Failed One"] },
    ];

    for (const [index, filter] of expectedFilters.entries()) {
      const tab = screen.getByRole("tab", { name: filter.name });
      if (index > 0) fireEvent.click(tab);
      expect(tab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText(new RegExp(`${filter.visible.length} projects? shown for`))).toBeInTheDocument();
      expect(screen.getAllByRole("article").map((article) => article.getAttribute("aria-label"))).toEqual(
        filter.visible.map((name) => `Project: ${name}`),
      );
    }

    fireEvent.click(screen.getByRole("tab", { name: "Idle 1" }));
    expect(screen.getByRole("button", { name: "Selected project: Idle One" })).toHaveAttribute("aria-pressed", "true");
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("opens the add-project modal from the add card", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Add Project/i }));

    expect(screen.getByTestId("add-project-modal")).toBeInTheDocument();
  });

  it("creates imported local projects with local git settings and no techstack assignment", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Add Project/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit local import" }));

    expect(createProjectMock).toHaveBeenCalledWith({
      name: "Imported Local",
      sourceType: "local",
      sourceRef: "/workspace/imported-local",
      cloneDir: undefined,
      settingsOverrides: expect.objectContaining({
        git: { githubMode: "LOCAL" },
        skills: expect.any(Array),
      }),
    });
    expect(createProjectMock.mock.calls[0]?.[0].settingsOverrides.techstack).toBeUndefined();
  });

  it("creates new local projects with local git settings and explicit techstack assignment", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));
    expect(screen.getByTestId("add-project-modal")).toHaveAttribute("data-initial-source-type", "new_project");
    fireEvent.click(screen.getByRole("button", { name: "Submit new local app" }));

    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Local App",
      sourceType: "local",
      sourceRef: "/workspace/new-local-app",
      initMode: "new-local",
      settingsOverrides: expect.objectContaining({
        git: { githubMode: "LOCAL" },
        techstack: {
          selectedTechstackId: "react-saas",
          applicationKind: "web",
        },
      }),
    }));
  });

  it("creates new remote projects with explicit techstack assignment and no local git override", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit new remote app" }));

    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Remote App",
      sourceType: "git",
      sourceRef: "new-remote-app",
      initMode: "new-remote",
      remoteProvider: "github",
      isPrivate: true,
      settingsOverrides: {
        techstack: {
          selectedTechstackId: "react-saas",
          applicationKind: "desktop",
        },
      },
    }));
    expect(createProjectMock.mock.calls[0]?.[0].settingsOverrides.git).toBeUndefined();
  });

  it("announces project loading with busy region semantics and stable actions", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [],
      selectedProjectId: null,
      loading: true,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: null,
    } as any);

    render(<ProjectsPage />);

    expect(screen.getByRole("region", { name: "Project cards" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects.");
    expect(screen.getByRole("button", { name: "New Project" })).toBeInTheDocument();
  });

  it("announces project load errors as alerts without removing recovery actions", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [],
      selectedProjectId: null,
      loading: false,
      error: "Unable to load projects.",
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: null,
    } as any);

    render(<ProjectsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load projects.");
    expect(screen.getByRole("region", { name: "Project cards" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "New Project" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Project" }));
    expect(screen.getByTestId("add-project-modal")).toHaveAttribute("data-initial-source-type", "local");
  });

  it("announces the empty project state while keeping add-project controls reachable", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [],
      selectedProjectId: null,
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: null,
    } as any);

    render(<ProjectsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("No projects connected. Add a project to start tracking work.");
    expect(screen.getByRole("button", { name: /Add Project/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Project" })).toBeInTheDocument();
  });

  it("announces a no-filter-match state and recovers to all projects", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [createProject()],
      selectedProjectId: "project-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: createProject(),
    } as any);

    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Failed 0" }));

    const noMatches = screen.getByRole("status");
    expect(noMatches).toHaveAttribute("aria-live", "polite");
    expect(noMatches).toHaveTextContent("No failed projects");
    expect(noMatches).toHaveTextContent("Choose another filter to see the rest of your projects.");
    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all projects" }));
    expect(screen.getByRole("tab", { name: "All 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("article", { name: "Project: Widget Service" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selected project: Widget Service" })).toHaveAttribute("aria-pressed", "true");
    expect(selectProjectMock).not.toHaveBeenCalled();
  });

  it("keeps page header actions stacked until large viewports", () => {
    const { container } = render(<ProjectsPage />);
    const headerContainer = container.querySelector("header");
    expect(headerContainer).toBeInTheDocument();
    expect(headerContainer?.className).toContain("flex-col");
    expect(headerContainer?.className).toContain("lg:flex-row");
    expect(headerContainer?.className).not.toContain("sm:flex-row");
  });

  it("wraps filter controls and card actions on narrow screens", () => {
    const { container } = render(<ProjectsPage />);

    const filterContainer = screen.getByRole("tablist", { name: "Filter projects by status" });
    expect(filterContainer).toHaveClass("min-w-0", "flex-wrap");
    expect(screen.getByRole("tab", { name: "All 1" })).toHaveClass("min-w-0", "flex-1", "sm:flex-none");

    const cardRegion = screen.getByRole("region", { name: "Project cards" });
    expect(cardRegion.firstElementChild).toHaveClass(
      "min-w-0",
      "grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]",
    );
    const selectBtn = screen.getByRole("button", { name: "Widget Service is selected" });
    expect(selectBtn.closest(".flex-wrap")).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Projects"]')).toHaveClass("min-w-0", "overflow-x-clip");
  });

  it("stacks the setup dialog actions for mobile heights", () => {
    render(<ProjectsPage />);

    // Open setup dialog
    fireEvent.click(screen.getByRole("button", { name: /Setup project/i }));

    // Setup dialog should open and render the Cancel button
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    const actionsContainer = cancelBtn.closest(".flex-col-reverse");
    expect(actionsContainer).toBeInTheDocument();
  });

  it("shows a default-enabled keyboard-focusable techstack option in the setup dialog", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Setup project/i }));

    const techstackOption = screen.getByRole("button", { name: /Techstack/i });
    expect(techstackOption).toHaveAttribute("aria-pressed", "true");
    techstackOption.focus();
    expect(document.activeElement).toBe(techstackOption);
  });

  it("renders Docs disabled by default and submits docs false when untouched", async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Setup project/i }));

    const docsOption = screen.getByRole("button", { name: /Docs/i });
    expect(docsOption).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));

    await waitFor(() => expect(startProjectSetup).toHaveBeenCalledWith("project-1", {
      enabled: true,
      options: expect.objectContaining({
        docs: false,
      }),
    }));
  });

  it("toggles Docs without starting setup and includes docs true in the setup payload", async () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Setup project/i }));

    const docsOption = screen.getByRole("button", { name: /Docs/i });
    fireEvent.click(docsOption);

    expect(startProjectSetup).not.toHaveBeenCalled();
    expect(docsOption).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));

    await waitFor(() => expect(startProjectSetup).toHaveBeenCalledWith("project-1", {
      enabled: true,
      options: expect.objectContaining({
        docs: true,
      }),
    }));
  });

  it("traps setup focus, closes with Escape, and restores the setup trigger", async () => {
    vi.useFakeTimers();
    render(<ProjectsPage />);
    const setupTrigger = screen.getByRole("button", { name: "Setup project" });
    setupTrigger.focus();
    fireEvent.click(setupTrigger);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    const agentsOption = screen.getByRole("button", { name: /Agents/ });
    expect(document.activeElement).toBe(agentsOption);

    screen.getByRole("button", { name: "Close project setup" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Setup Project" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByRole("dialog", { name: "Setup Widget Service" })).not.toBeInTheDocument();
    expect(setupTrigger).toHaveFocus();
  });

  it("suppresses duplicate setup launches while the first request is pending", () => {
    const started = createDeferred<{
      accepted: boolean;
      projectId: string;
      invocationId: string;
      agentId: string;
    }>();
    vi.mocked(startProjectSetup).mockReturnValue(started.promise);
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    const runSetup = screen.getByRole("button", { name: "Setup Project" });
    fireEvent.click(runSetup);
    fireEvent.click(runSetup);

    expect(startProjectSetup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Setting up..." })).toBeDisabled();
  });

  it("stops setup polling on close while retaining the background invocation action", async () => {
    vi.useFakeTimers();
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Open invocation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(fetchProjectInvocations).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open setup invocation" })).toBeInTheDocument();
  });

  it("ignores a polling response that completes after the setup dialog closes", async () => {
    vi.useFakeTimers();
    const polling = createDeferred<any[]>();
    vi.mocked(fetchProjectInvocations).mockReturnValue(polling.promise);
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchProjectInvocations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      polling.resolve([{ id: "invocation-1", status: "completed" }]);
      await Promise.resolve();
    });

    expect(screen.getByText("Project setup running")).toBeInTheDocument();
    expect(screen.queryByText("Project setup completed successfully.")).not.toBeInTheDocument();
  });

  it("cleans up scheduled setup polling when the page unmounts", async () => {
    vi.useFakeTimers();
    const rendered = render(<ProjectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetchProjectInvocations).not.toHaveBeenCalled();
  });

  it("keeps setup failures retryable without replacing the project list", async () => {
    vi.mocked(startProjectSetup)
      .mockRejectedValueOnce(new Error("temporary setup failure"))
      .mockResolvedValueOnce({
        accepted: true,
        projectId: "project-1",
        invocationId: "invocation-2",
        agentId: "agent-1",
      });
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Project" }));

    const dialog = await screen.findByRole("dialog", { name: "Setup Widget Service" });
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("temporary setup failure"));
    expect(screen.getByRole("article", { name: "Project: Widget Service" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(startProjectSetup).toHaveBeenCalledTimes(2));
  });

  it("restores delete focus on cancel and keeps failed deletion retryable", async () => {
    const deletion = createDeferred<void>();
    deleteProjectMock.mockReturnValueOnce(deletion.promise);
    render(<ProjectsPage />);
    const deleteTrigger = screen.getByRole("button", { name: "Delete project" });
    deleteTrigger.focus();
    fireEvent.click(deleteTrigger);
    const firstDialog = screen.getByRole("dialog", { name: "Delete Widget Service?" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(firstDialog).not.toBeInTheDocument());
    await waitFor(() => expect(deleteTrigger).toHaveFocus());

    fireEvent.click(deleteTrigger);
    const confirmDelete = within(screen.getByRole("dialog", { name: "Delete Widget Service?" })).getByRole("button", { name: "Delete project" });
    fireEvent.click(confirmDelete);
    fireEvent.click(confirmDelete);
    expect(deleteProjectMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      deletion.reject(new Error("temporary delete failure"));
      await Promise.resolve();
    });
    const card = screen.getByRole("article", { name: "Project: Widget Service" });
    await waitFor(() => expect(within(card).getByRole("alert")).toHaveTextContent("temporary delete failure"));
    expect(within(card).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("moves focus to the next project after deletion removes the originating card", async () => {
    const first = createProject({ id: "project-1", name: "Project One" });
    const second = createProject({ id: "project-2", name: "Project Two" });
    let projects = [first, second];
    const deletion = createDeferred<void>();
    deleteProjectMock.mockReturnValue(deletion.promise);
    vi.mocked(useProjectData).mockImplementation(() => ({
      projects,
      selectedProjectId: "project-1",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: first,
    } as any));
    const rendered = render(<ProjectsPage />);

    fireEvent.click(within(screen.getByRole("article", { name: "Project: Project One" })).getByRole("button", { name: "Delete project" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Project One?" })).getByRole("button", { name: "Delete project" }));
    projects = [second];
    rendered.rerender(<DashboardI18nProvider initialLocale="en" storage={null}><ProjectsPage /></DashboardI18nProvider>);
    await act(async () => {
      deletion.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Select project: Project Two" })).toHaveFocus());
    expect(screen.getAllByText(/Deleted Project One from Code UX/)).toHaveLength(2);
  });

  it("keeps German project selection and deletion confirmation operable", async () => {
    render(<ProjectsPage />, "de");

    expect(screen.getByRole("heading", { name: "Projekte verwalten" })).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/widget-service.git")).toBeInTheDocument();
    expect(screen.getByText("4. Jan. 2026, 5:06")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ausgewähltes Projekt: Widget Service" }));
    expect(selectProjectMock).toHaveBeenCalledWith("project-1");

    fireEvent.click(screen.getByRole("button", { name: "Projekt löschen" }));
    const dialog = screen.getByRole("dialog", { name: "Widget Service löschen?" });
    expect(deleteProjectMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Widget Service löschen?" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Projekt löschen" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Widget Service löschen?" })).getByRole("button", { name: "Projekt löschen" }));
    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith("project-1"));
  });

  it("renders the German Projects header count for a small collection", () => {
    const projects = Array.from({ length: 2 }, (_, index) => createProject({
      id: `project-${index}`,
      name: `Project ${index}`,
    }));
    vi.mocked(useProjectData).mockReturnValue({
      projects,
      selectedProjectId: "project-0",
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: selectProjectMock,
      createProject: createProjectMock,
      updateProject: vi.fn(),
      deleteProject: deleteProjectMock,
      selectedProject: projects[0],
    } as any);

    render(<ProjectsPage />, "de");

    expect(screen.getByText("2 insgesamt")).toBeInTheDocument();
  });

  it("localizes setup progress and preserves a provider failure verbatim", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchProjectInvocations).mockResolvedValue([{
      id: "invocation-1",
      status: "failed",
      lastErrorMessage: "provider diagnostic 42",
    } as any]);
    render(<ProjectsPage />, "de");

    fireEvent.click(screen.getByRole("button", { name: "Projekt einrichten" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Widget Service einrichten" })).getByRole("button", { name: "Projekt einrichten" }));
    await vi.runAllTimersAsync();

    expect(startProjectSetup).toHaveBeenCalledWith("project-1", {
      enabled: true,
      options: expect.objectContaining({ techstack: true, docs: false }),
    });
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("wird gestartet"),
    }));
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Aufruf invocati"),
    }));
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      message: expect.stringContaining("provider diagnostic 42"),
    }));
    vi.useRealTimers();
  });
});
