/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ProjectsPage } from "../../../dashboard/src/v2/ProjectsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useToast } from "../../../dashboard/src/v2/components/feedback/ToastProvider.js";
import { startProjectSetup } from "../../../dashboard/src/v2/lib/project-api.js";

expect.extend(matchers);

const navigateMock = vi.fn();
const selectProjectMock = vi.fn(() => Promise.resolve());
const deleteProjectMock = vi.fn(() => Promise.resolve());
const createProjectMock = vi.fn(() => Promise.resolve({}));

vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
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

const createProject = () => ({
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
});

describe("ProjectsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(startProjectSetup).mockResolvedValue({
      accepted: true,
      projectId: "project-1",
      invocationId: "invocation-1",
      agentId: "agent-1",
    });
    vi.mocked(useToast).mockReturnValue({ addToast: vi.fn() } as any);
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

  it("truncates long metadata accurately without overflowing the card constraints", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [{
        ...createProject(),
        name: "A very very long project name that should definitely be truncated with line clamp",
        repoUrl: "https://github.com/acme/a-very-very-long-project-name-that-should-definitely-be-truncated-with-line-clamp.git",
        defaultBranch: "a-very-very-long-branch-name-that-should-definitely-be-truncated"
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

    // Assert that the title exists and is using the line clamp class for truncation
    const title = screen.getByText("A very very long project name that should definitely be truncated with line clamp");
    expect(title).toBeInTheDocument();
    expect(title.className).toContain("line-clamp-2");

    // Check that long urls are in a flexible container (min-w-0 for ellipsis truncation)
    const urlText = screen.getByText("https://github.com/acme/a-very-very-long-project-name-that-should-definitely-be-truncated-with-line-clamp.git");
    const containerRow = urlText.closest(".min-w-0");
    expect(containerRow).toBeInTheDocument();
  });

  it("renders repository metadata, project settings, and isolated quick actions", () => {
    render(<ProjectsPage />);

    // Repo URL and on-disk path are both surfaced for git projects.
    expect(screen.getByText("https://github.com/acme/widget-service.git")).toBeInTheDocument();
    expect(screen.getByText("/workspace/widget-service")).toBeInTheDocument();
    // Last run timestamp is shown in the manifest.
    expect(screen.getByText("Jan 4, 2026, 5:06 AM")).toBeInTheDocument();
    expect(screen.getAllByText("github.com").length).toBeGreaterThan(0);

    // The selected project's primary action is a select toggle in its "selected" state.
    expect(screen.getByRole("button", { name: /Widget Service is selected/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Setup project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete project/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Selected project: Widget Service/i }));
    expect(selectProjectMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Widget Service is selected/i }));
    expect(selectProjectMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Project settings/i }));
    expect(selectProjectMock).toHaveBeenCalledTimes(3);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/config" });

    fireEvent.click(screen.getByRole("button", { name: /Delete project/i }));
    expect(deleteProjectMock).toHaveBeenCalledTimes(1);
    expect(selectProjectMock).toHaveBeenCalledTimes(3);
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

    // Filter controls
    const filterBtn = screen.getByText("All");
    const filterContainer = filterBtn.closest(".flex-wrap");
    expect(filterContainer).toBeInTheDocument();

    // Card actions
    const selectBtn = screen.getByRole("button", { name: /Widget Service is selected/i });
    const actionsContainer = selectBtn.closest(".flex-wrap");
    expect(actionsContainer).toBeInTheDocument();
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
});
