/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "../../ProjectsPage.js";
import { useToast } from "../../components/feedback/ToastProvider.js";
import { useProjectData } from "../../context/project-data.js";

expect.extend(matchers);

const navigateMock = vi.fn();
const selectProjectMock = vi.fn(() => Promise.resolve());
const deleteProjectMock = vi.fn(() => Promise.resolve());
const createProjectMock = vi.fn(() => Promise.resolve({ id: "project-beta", name: "Beta Workspace" }));

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

vi.mock("../../context/project-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/project-data.js")>();
  return {
    ...actual,
    useProjectData: vi.fn(),
  };
});

vi.mock("../../components/feedback/ToastProvider.js", () => ({
  useToast: vi.fn(),
}));

vi.mock("../../components/ui/AddProjectModal.js", () => ({
  AddProjectModal: ({ initialSourceType }: { initialSourceType?: string }) => h(
    "div",
    { "data-testid": "add-project-modal", "data-source-type": initialSourceType },
    "Add project modal",
  ),
}));

vi.mock("../../components/ui/WaveFluid.js", () => ({
  WaveFluid: () => h("div", { "data-testid": "wave-fluid" }),
}));

vi.mock("../../components/ui/BorderTrace.js", () => ({
  BorderTrace: () => h("div", { "data-testid": "border-trace" }),
}));

vi.mock("../../lib/project-api.js", () => ({
  startProjectSetup: vi.fn(),
}));

vi.mock("../../lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(),
}));

vi.mock("../../router/route-prefetch.js", () => ({
  prefetchRoute: vi.fn(),
}));

const createProject = () => ({
  id: "project-alpha",
  slug: "project-alpha",
  name: "Alpha Inventory Workspace With A Deliberately Long Name",
  baseDir: "/workspace/synthetic/alpha-inventory-workspace-with-a-long-path",
  repoUrl: "https://example.invalid/org/alpha-inventory-workspace-with-a-long-url.git",
  sourceType: "git",
  sourceRef: "https://example.invalid/org/alpha-inventory-workspace-with-a-long-url.git",
  gitProvider: "github",
  gitHostDomain: "example.invalid",
  defaultBranch: "feature/very-long-operational-inventory-branch-name",
  featureBranchPrefix: "feature/",
  status: "idle",
  sprintsCount: 3,
  openTasks: 2,
  completedTasks: 7,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: "2026-01-04T05:06:07.000Z",
  lastRunStatus: "completed",
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-03T04:05:06.000Z",
});

describe("ProjectsPage inventory presentation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ addToast: vi.fn() } as any);
    vi.mocked(useProjectData).mockReturnValue({
      projects: [createProject()],
      selectedProjectId: "project-alpha",
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

  it("keeps inventory metadata scannable and preserves selection actions", () => {
    render(<ProjectsPage />);

    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("example.invalid")).toBeInTheDocument();

    const selectButton = screen.getByRole("button", {
      name: /Alpha Inventory Workspace With A Deliberately Long Name is selected/i,
    });
    expect(selectButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", {
      name: /Selected project: Alpha Inventory Workspace With A Deliberately Long Name/i,
    }));
    expect(selectProjectMock).toHaveBeenCalledTimes(1);
  });

  it("exposes setup, settings, delete, and add-project entry points with durable labels", () => {
    render(<ProjectsPage />);

    expect(screen.getByRole("button", { name: "Setup project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete project" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Project: local or Git" }));
    expect(screen.getByTestId("add-project-modal")).toHaveAttribute("data-source-type", "local");
  });

  it("opens the new-project setup entry from the page header", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    expect(screen.getByTestId("add-project-modal")).toHaveAttribute("data-source-type", "new_project");
  });
});
