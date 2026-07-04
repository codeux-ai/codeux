/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsGeneralPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
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

const cloneSettings = () => JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));

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
    expect(updateProject).not.toHaveBeenCalled();
  });
});
