/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsGeneralPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { fetchLocalFiles } from "../../../dashboard/src/v2/lib/project-api.js";
import { cloneProjectSettings } from "../../../dashboard/src/v2/lib/settings/project-overrides.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (duration: number) => duration,
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/lib/onboarding-control.js", () => ({
  openOnboarding: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalFiles: vi.fn(),
}));

const cloneSettings = () => cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS);

const createProjectState = () => ({
  activeScope: "project",
  systemSettings: null,
  projectSettings: cloneSettings(),
  selectedProject: {
    id: "proj-1",
    name: "Test Project",
    baseDir: "/workspace/test-project",
    sourceType: "local",
  },
  updateSystem: vi.fn(),
  editableSettings: cloneSettings(),
  updateEditableSettings: vi.fn(),
  projectSources: {},
});

describe("SettingsGeneralPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchLocalFiles).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("updates the selected project name from project settings", async () => {
    const updateProject = vi.fn().mockResolvedValue({
      id: "proj-1",
      name: "Renamed Project",
      baseDir: "/workspace/test-project",
      sourceType: "local",
    });
    vi.mocked(useProjectData).mockReturnValue({ updateProject } as any);

    render(<SettingsGeneralPanel state={createProjectState() as any} />);

    const nameInput = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "Renamed Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Name" }));

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("proj-1", { name: "Renamed Project" });
    });
    expect(await screen.findByText("Project name updated.")).toBeInTheDocument();
  });

  it("prevents blank project names", async () => {
    const updateProject = vi.fn();
    vi.mocked(useProjectData).mockReturnValue({ updateProject } as any);

    render(<SettingsGeneralPanel state={createProjectState() as any} />);

    const nameInput = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "   " } });

    const saveButton = screen.getByRole("button", { name: "Save Name" });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("title", "Enter a project name before saving.");
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("browses local files and updates the container setup script path", async () => {
    vi.mocked(useProjectData).mockReturnValue({ updateProject: vi.fn() } as any);
    vi.mocked(fetchLocalFiles)
      .mockResolvedValueOnce({
        currentPath: "/workspace/test-project",
        parentPath: "/workspace",
        rootPath: "/",
        homePath: "/home/user",
        directories: [{ name: ".code-ux", path: "/workspace/test-project/.code-ux" }],
        files: [],
      })
      .mockResolvedValueOnce({
        currentPath: "/workspace/test-project/.code-ux",
        parentPath: "/workspace/test-project",
        rootPath: "/",
        homePath: "/home/user",
        directories: [],
        files: [{ name: "setup.sh", path: "/workspace/test-project/.code-ux/setup.sh" }],
      });

    const StatefulHarness = () => {
      const [settings, setSettings] = useState(cloneSettings());
      return <SettingsGeneralPanel state={{
        activeScope: "system",
        systemSettings: { runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard", dbPruningEnabled: true, dbRetentionDays: 14, dbAutoVacuumOnStartup: true } },
        projectSettings: null,
        selectedProject: null,
        updateSystem: vi.fn(),
        editableSettings: settings,
        updateEditableSettings: (recipe: any) => setSettings((current: any) => recipe(current)),
        projectSources: {},
      } as any} />;
    };

    render(<StatefulHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByText("/workspace/test-project")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ".code-ux" }));
    expect(await screen.findByText("/workspace/test-project/.code-ux")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "setup.sh" }));

    expect(screen.getByLabelText("Container setup script")).toHaveValue("/workspace/test-project/.code-ux/setup.sh");
  });

  it("keeps manual container setup script text when file browsing fails", async () => {
    vi.mocked(useProjectData).mockReturnValue({ updateProject: vi.fn() } as any);
    vi.mocked(fetchLocalFiles).mockRejectedValueOnce(new Error("Path is outside allowed roots"));

    const StatefulHarness = () => {
      const initialSettings = cloneSettings();
      const [settings, setSettings] = useState({
        ...initialSettings,
        cliWorkflow: {
          ...initialSettings.cliWorkflow,
          containerSetupScriptPath: ".code-ux/container/setup.sh",
        },
      });
      return <SettingsGeneralPanel state={{
        activeScope: "system",
        systemSettings: { runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard", dbPruningEnabled: true, dbRetentionDays: 14, dbAutoVacuumOnStartup: true } },
        projectSettings: null,
        selectedProject: null,
        updateSystem: vi.fn(),
        editableSettings: settings,
        updateEditableSettings: (recipe: any) => setSettings((current: any) => recipe(current)),
        projectSources: {},
      } as any} />;
    };

    render(<StatefulHarness />);

    const input = screen.getByLabelText("Container setup script");
    expect(input).toHaveValue(".code-ux/container/setup.sh");

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Path is outside allowed roots");
    expect(input).toHaveValue(".code-ux/container/setup.sh");
  });
});
