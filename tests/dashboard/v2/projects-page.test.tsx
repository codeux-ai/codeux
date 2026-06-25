/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ProjectsPage } from "../../../dashboard/src/v2/ProjectsPage.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useToast } from "../../../dashboard/src/v2/components/feedback/ToastProvider.js";

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
  AddProjectModal: ({ onClose }: any) => h(
    "div",
    { "data-testid": "add-project-modal" },
    h("button", { type: "button", onClick: onClose }, "Close"),
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
    vi.clearAllMocks();
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

  it("renders repository metadata, project settings, and isolated quick actions", () => {
    render(<ProjectsPage />);

    expect(screen.getByText("https://github.com/acme/widget-service.git")).toBeInTheDocument();
    expect(screen.getByText("/workspace/widget-service")).toBeInTheDocument();
    expect(screen.getByText("Jan 2, 2026, 3:04 AM")).toBeInTheDocument();
    expect(screen.getByText("Jan 3, 2026, 4:05 AM")).toBeInTheDocument();
    expect(screen.getByText("Jan 4, 2026, 5:06 AM")).toBeInTheDocument();
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0);
    expect(screen.getAllByText("github.com").length).toBeGreaterThan(0);

    expect(screen.getByRole("button", { name: /Open project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Setup project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete project/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Selected project: Widget Service/i }));
    expect(selectProjectMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Open project/i }));
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
});
