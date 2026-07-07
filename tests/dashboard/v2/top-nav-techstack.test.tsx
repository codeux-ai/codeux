/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TopNav } from "../../../dashboard/src/v2/components/TopNav.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { useProjectEffectiveSettings, clearProjectEffectiveSettingsCache } from "../../../dashboard/src/v2/hooks/use-project-effective-settings.js";
import { fetchSystemSettings, saveProjectTechstackSettings } from "../../../dashboard/src/v2/lib/settings-api.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(),
  clearProjectEffectiveSettingsCache: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(),
  saveProjectTechstackSettings: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-notifications.js", () => ({
  useNotifications: vi.fn(() => ({
    notifications: [],
    unreadCount: 0,
    markAllRead: vi.fn(),
    markRead: vi.fn(),
    dismiss: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../dashboard/src/v2/hooks/useThemeSetting.js", () => ({
  useThemeSetting: vi.fn(() => ({ setTheme: vi.fn() })),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-is-dark.js", () => ({
  useIsDark: vi.fn(() => true),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
  useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../../dashboard/src/v2/components/DockerStatusMenu.js", () => ({
  DockerStatusMenu: () => <button type="button" aria-label="Docker Status: 0 active containers" />,
}));

vi.mock("../../../dashboard/src/v2/components/browser/BrowserSessionsMenu.js", () => ({
  BrowserSessionsMenu: () => <button type="button" aria-label="Browser Sessions: 0 active" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/GlobalSearch.js", () => ({
  GlobalSearch: () => <button type="button" aria-label="Open search" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/TelemetryStats.js", () => ({
  TelemetryStats: () => <div aria-hidden="true" />,
}));

vi.mock("../../../dashboard/src/v2/components/top-nav/BrandSection.js", () => ({
  BrandSection: ({ isMobileMenuOpen, onMenuToggle }: any) => (
    <button
      type="button"
      aria-label={isMobileMenuOpen ? "Close mobile menu" : "Open mobile menu"}
      aria-expanded={!!isMobileMenuOpen}
      onClick={onMenuToggle}
    />
  ),
}));

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: vi.fn(() => [{ pathname: "/" }]),
}));

const catalog = {
  defaultTechstackId: "code-ux-internal",
  entries: [
    {
      id: "code-ux-internal",
      label: "Code UX Internal",
      items: [{ id: "preact", label: "Preact" }],
    },
    {
      id: "react-saas",
      label: "React SaaS",
      items: [{ id: "react", label: "React" }],
    },
  ],
};

const makeProject = (id: string, name: string) => ({
  id,
  name,
  status: "idle",
  sourceType: "local",
  sourceRef: `/tmp/${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const refreshEffectiveSettings = vi.fn().mockResolvedValue(undefined);

const mockTopNavData = ({
  selectedProject = makeProject("proj-1", "Alpha"),
  selectedTechstackId = null as string | null,
  applicationKind = null as "web" | "desktop" | null,
  effectiveLoading = false,
  createProject = vi.fn(),
} = {}) => {
  vi.mocked(useProjectData).mockReturnValue({
    projects: selectedProject ? [selectedProject] : [],
    selectedProject,
    selectedProjectId: selectedProject?.id ?? null,
    loading: false,
    error: null,
    refreshProjects: vi.fn(),
    selectProject: vi.fn(),
    createProject,
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  } as any);
  vi.mocked(useSprints).mockReturnValue({
    data: [],
    selectedSprintId: null,
    selectedSprint: null,
    selectSprint: vi.fn(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  } as any);
  vi.mocked(useProjectEffectiveSettings).mockReturnValue({
    data: selectedProject ? {
      settings: {
        git: { sprintKeyPrefix: "SPR" },
        sprintPreview: { enabled: true, showInAppBrowser: true },
        techstackCatalog: catalog,
        techstack: { selectedTechstackId, applicationKind },
      },
      sources: {},
      system: {},
    } : null,
    loading: effectiveLoading,
    error: null,
    refresh: refreshEffectiveSettings,
  } as any);
};

const waitForTechstackTrigger = async () => {
  const trigger = await screen.findByRole("button", { name: /Techstack selector/i });
  await waitFor(() => {
    expect(trigger).toHaveAttribute("aria-busy", "false");
  });
  return trigger;
};

describe("TopNav techstack selector", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    refreshEffectiveSettings.mockResolvedValue(undefined);
    vi.mocked(fetchSystemSettings).mockResolvedValue({
      techstackCatalog: catalog,
      defaults: { techstack: { selectedTechstackId: null, applicationKind: null } },
    } as any);
    vi.mocked(saveProjectTechstackSettings).mockResolvedValue(undefined);
  });

  it("renders the selected techstack label from effective project settings", async () => {
    mockTopNavData({ selectedTechstackId: "react-saas" });

    render(<TopNav />);

    const trigger = await waitForTechstackTrigger();
    expect(trigger).toHaveAccessibleName("Techstack selector, active techstack: React SaaS");
    expect(trigger).toHaveTextContent("React SaaS");
    expect(trigger).toHaveTextContent("Assigned");
  });

  it("shows the catalog default as the display fallback while keeping the project unassigned", async () => {
    mockTopNavData({ selectedTechstackId: null });

    render(<TopNav />);

    const trigger = await waitForTechstackTrigger();
    expect(trigger).toHaveAccessibleName("Techstack selector, active techstack: Code UX Internal (unassigned, using default)");
    expect(trigger).toHaveTextContent("Unassigned; using Code UX Internal");

    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox", { name: "Techstack list" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Unassigned/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Code UX Internal/i })).toHaveAttribute("aria-selected", "false");
    expect(saveProjectTechstackSettings).not.toHaveBeenCalled();
  });

  it("supports keyboard selection and invalidates the effective settings cache after save", async () => {
    mockTopNavData({ selectedTechstackId: null });

    render(<TopNav />);

    const trigger = await waitForTechstackTrigger();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: "Techstack list" })).toBeInTheDocument();
      expect(document.activeElement).toHaveAttribute("id", "techstack-option-unassigned");
    });

    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("id", "techstack-option-react-saas");
    });

    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });

    await waitFor(() => {
      expect(saveProjectTechstackSettings).toHaveBeenCalledWith("proj-1", {
        selectedTechstackId: "react-saas",
        applicationKind: null,
      });
    });
    expect(clearProjectEffectiveSettingsCache).toHaveBeenCalledWith("proj-1");
    expect(refreshEffectiveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Techstack switched to React SaaS");
  });

  it("persists Unassigned as null without assigning the built-in default", async () => {
    mockTopNavData({ selectedTechstackId: "react-saas", applicationKind: "web" });

    render(<TopNav />);

    const trigger = await waitForTechstackTrigger();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: /Unassigned/i }));

    await waitFor(() => {
      expect(saveProjectTechstackSettings).toHaveBeenCalledWith("proj-1", {
        selectedTechstackId: null,
        applicationKind: "web",
      });
    });
    expect(saveProjectTechstackSettings).not.toHaveBeenCalledWith("proj-1", expect.objectContaining({
      selectedTechstackId: "code-ux-internal",
    }));
    expect(screen.getByRole("status")).toHaveTextContent("Code UX Internal remains the display fallback");
  });

  it("keeps the selector disabled with helper copy when no project is active or settings are loading", async () => {
    mockTopNavData({ selectedProject: null });
    const { rerender } = render(<TopNav />);

    let trigger = screen.getByRole("button", { name: /Techstack selector/i });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Select a project first");

    mockTopNavData({ effectiveLoading: true });
    rerender(<TopNav />);

    trigger = screen.getByRole("button", { name: /Techstack selector/i });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Loading settings");
  });

  it("opens Create Web App with the selected project techstack and submits explicit overrides", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    mockTopNavData({ selectedTechstackId: "react-saas", createProject });

    render(<TopNav />);

    fireEvent.click(await screen.findByRole("button", { name: "Create Web App" }));

    expect(await screen.findByRole("heading", { name: /Create Web App/i })).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Web Portal" } });
    await waitFor(() => expect(nameInput).toHaveValue("Web Portal"));
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
        name: "Web Portal",
        sourceType: "local",
        sourceRef: "Web Portal",
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
  });

  it("opens Create Desktop App with the catalog default techstack when the project is unassigned", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    mockTopNavData({ selectedTechstackId: null, createProject });

    render(<TopNav />);

    fireEvent.click(await screen.findByRole("button", { name: "Create Desktop App" }));

    expect(await screen.findByRole("heading", { name: /Create Desktop App/i })).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Desktop Shell" } });
    await waitFor(() => expect(nameInput).toHaveValue("Desktop Shell"));
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
        name: "Desktop Shell",
        settingsOverrides: expect.objectContaining({
          techstack: {
            selectedTechstackId: "code-ux-internal",
            applicationKind: "desktop",
          },
        }),
      }));
    });
  });
});
