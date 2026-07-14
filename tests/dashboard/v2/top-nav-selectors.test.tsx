/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TopNav } from "../../../dashboard/src/v2/components/TopNav.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { useProjectEffectiveSettings, clearProjectEffectiveSettingsCache } from "../../../dashboard/src/v2/hooks/use-project-effective-settings.js";
import { saveProjectDesignGuidanceSettings } from "../../../dashboard/src/v2/lib/settings-api.js";
import {
  CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
  DESIGN_GUIDANCE_NONE_ID,
} from "../../../src/domain/settings/design-guidance-catalog.js";

expect.extend(matchers);

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/",
}));

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
  saveProjectDesignGuidanceSettings: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-notifications.js", () => ({
  useNotifications: vi.fn(() => ({
    notifications: [],
    unreadCount: 0,
    agentSchedules: [],
    markAllRead: vi.fn(),
    markRead: vi.fn(),
    dismiss: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("../../../dashboard/src/v2/components/feedback/ToastProvider.js", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../../../dashboard/src/v2/hooks/useThemeSetting.js", () => ({
  useThemeSetting: vi.fn(() => ({ setTheme: vi.fn() })),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-is-dark.js", () => ({
  useIsDark: vi.fn(() => false),
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
  GlobalSearch: () => <button type="button" aria-label="Open search" data-testid="global-search" />,
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
    to: vi.fn(),
    context: (cb: any) => {
      cb();
      return { add: vi.fn((fn: any) => fn()), revert: vi.fn() };
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: any) => select({ matches: [{ pathname: routerMocks.pathname }] }),
  useNavigate: () => routerMocks.navigate,
}));

const project = {
  id: "proj-1",
  name: "Alpha",
  status: "idle",
  sourceType: "local",
  sourceRef: "/tmp/proj-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const secondProject = {
  ...project,
  id: "proj-2",
  name: "Beta",
  sourceRef: "/tmp/proj-2",
};

const customGuidance = {
  selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
  selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
  hideDefaultStyleguides: false,
  customTechStacks: [
    {
      id: "internal-ui-stack",
      name: "Internal UI Stack",
      summary: "Internal Preact and Tailwind guidance.",
      instructionMarkdown: "Use internal dashboard conventions.",
    },
  ],
  customStyleguides: [
    {
      id: "studio-style",
      name: "Studio Style",
      summary: "Dense studio workflow visuals.",
      instructionMarkdown: "Use compact studio controls.",
    },
  ],
};

const sprintOne = {
  id: "sprint-1",
  name: "Build shell",
  status: "idle",
  number: 1,
  projectId: "proj-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const refreshEffectiveSettings = vi.fn().mockResolvedValue(undefined);
const selectSprint = vi.fn().mockResolvedValue(undefined);
const createSprint = vi.fn();
const refetchSprints = vi.fn().mockResolvedValue(undefined);

const renderTopNav = ({
  selectedProject = project as any,
  projects = selectedProject ? [selectedProject] : [],
  selectProject = vi.fn().mockResolvedValue(undefined),
  guidance = customGuidance,
  sprints = [sprintOne],
  selectedSprintId = "sprint-1",
  effectiveLoading = false,
} = {}) => {
  vi.mocked(useProjectData).mockReturnValue({
    projects,
    selectedProject,
    selectedProjectId: selectedProject?.id ?? null,
    loading: false,
    error: null,
    refreshProjects: vi.fn(),
    selectProject,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  } as any);

  vi.mocked(useSprints).mockReturnValue({
    data: sprints,
    selectedSprintId,
    selectedSprint: sprints.find((sprint: any) => sprint.id === selectedSprintId) ?? null,
    selectSprint,
    createSprint,
    loading: false,
    error: null,
    refetch: refetchSprints,
  } as any);

  vi.mocked(useProjectEffectiveSettings).mockReturnValue({
    data: selectedProject ? {
      settings: {
        git: { sprintKeyPrefix: "SPR" },
        sprintPreview: { enabled: true, showInAppBrowser: true },
        designGuidance: guidance,
      },
      sources: {},
      system: {},
    } : null,
    loading: effectiveLoading,
    error: null,
    refresh: refreshEffectiveSettings,
  } as any);

  return render(<TopNav />);
};

describe("TopNav guidance and sprint selectors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.pathname = "/";
    routerMocks.navigate.mockResolvedValue(undefined);
    vi.mocked(saveProjectDesignGuidanceSettings).mockResolvedValue(undefined);
    refreshEffectiveSettings.mockResolvedValue(undefined);
    selectSprint.mockResolvedValue(undefined);
    createSprint.mockResolvedValue({
      id: "sprint-2",
      name: "Release prep",
      status: "idle",
      number: 2,
      projectId: "proj-1",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    refetchSprints.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("groups guidance selectors beside global search and persists tech stack guidance selection", async () => {
    renderTopNav();

    const search = screen.getByTestId("global-search");
    const techstackTrigger = screen.getByRole("button", { name: /Tech stack guidance selector/i });
    const styleguideTrigger = screen.getByRole("button", { name: /Styleguide selector/i });

    expect(search.parentElement).toContainElement(techstackTrigger);
    expect(search.parentElement).toContainElement(styleguideTrigger);
    expect(techstackTrigger).toHaveTextContent("None");

    techstackTrigger.focus();
    fireEvent.keyDown(techstackTrigger, { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: "Tech stack guidance list" })).toBeInTheDocument();
      expect(document.activeElement).toHaveAttribute("id", "techstack-option-none");
    });

    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toHaveAttribute("id", "techstack-option-internal-ui-stack");
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });

    await waitFor(() => {
      expect(saveProjectDesignGuidanceSettings).toHaveBeenCalledWith("proj-1", {
        ...customGuidance,
        selectedTechStackId: "internal-ui-stack",
      });
    });
    expect(clearProjectEffectiveSettingsCache).toHaveBeenCalledWith("proj-1");
    expect(refreshEffectiveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Tech stack guidance switched to Internal UI Stack");
  });

  it("renders styleguide options, footer Add and Manage links, and persists None correctly", async () => {
    renderTopNav({
      guidance: {
        ...customGuidance,
        selectedStyleguideId: "studio-style",
      },
    });

    const styleguideTrigger = screen.getByRole("button", { name: /Styleguide selector/i });
    expect(styleguideTrigger).toHaveTextContent("Studio Style");

    fireEvent.click(styleguideTrigger);

    expect(await screen.findByRole("option", { name: /Studio Style/i })).toHaveAttribute("aria-selected", "true");
    const noneOption = screen.getByRole("option", { name: /^None/i });
    fireEvent.click(noneOption);

    await waitFor(() => {
      expect(saveProjectDesignGuidanceSettings).toHaveBeenCalledWith("proj-1", {
        ...customGuidance,
        selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
      });
    });

    fireEvent.click(styleguideTrigger);
    const addLink = await screen.findByRole("link", { name: "Add Styleguide" });
    const manageLink = screen.getByRole("link", { name: /Manage Guidance/i });
    expect(addLink).toHaveAttribute("href", "/config?category=guidance#guidance");
    expect(manageLink).toHaveAttribute("href", "/config?category=guidance#guidance");
  });

  it("uses a rendered active descendant when the selected built-in styleguide is hidden", async () => {
    renderTopNav({
      guidance: {
        ...customGuidance,
        selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
        hideDefaultStyleguides: true,
      },
    });

    const styleguideTrigger = screen.getByRole("button", { name: /Styleguide selector/i });
    expect(styleguideTrigger).toHaveTextContent("Code UX");

    fireEvent.click(styleguideTrigger);

    const listbox = await screen.findByRole("listbox", { name: "Styleguide list" });
    expect(screen.queryByRole("option", { name: /^Code UX$/i })).not.toBeInTheDocument();

    const activeDescendantId = styleguideTrigger.getAttribute("aria-activedescendant");
    expect(activeDescendantId).toBe("styleguide-option-none");
    const activeDescendant = document.getElementById(activeDescendantId ?? "");
    expect(activeDescendant).toBeInTheDocument();
    if (!activeDescendant) {
      throw new Error("Expected styleguide active descendant to reference a rendered option.");
    }
    expect(listbox).toContainElement(activeDescendant);
  });

  it("disables guidance selectors without a project but keeps the sprint Add action available for empty collections", async () => {
    renderTopNav({ selectedProject: null, sprints: [], selectedSprintId: null });

    expect(screen.getByRole("button", { name: /Tech stack guidance selector/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Styleguide selector/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Sprint selector/i })).not.toBeInTheDocument();

    cleanup();
    renderTopNav({ sprints: [], selectedSprintId: null });

    const sprintTrigger = screen.getByRole("button", { name: /Sprint selector/i });
    expect(sprintTrigger).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(sprintTrigger);

    expect(await screen.findByText("No sprints yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Sprint" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Manage Sprints" })).toHaveAttribute("href", "/sprints");
  });

  it("creates an idle sprint from the selector modal, refreshes, selects it, and announces success", async () => {
    renderTopNav({ sprints: [], selectedSprintId: null });

    fireEvent.click(screen.getByRole("button", { name: /Sprint selector/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Sprint" }));

    expect(await screen.findByRole("dialog", { name: "Add Sprint" })).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText("Sprint name"), { target: { value: "Release prep" } });
    fireEvent.input(screen.getByLabelText("Goal"), { target: { value: "Prepare release notes and verification." } });
    fireEvent.click(screen.getByRole("button", { name: "Create Sprint" }));

    await waitFor(() => {
      expect(createSprint).toHaveBeenCalledWith({
        name: "Release prep",
        goal: "Prepare release notes and verification.",
        originalPrompt: null,
        status: "idle",
        showcasePinned: true,
        startDate: null,
        endDate: null,
      });
    });
    expect(refetchSprints).toHaveBeenCalledTimes(1);
    expect(selectSprint).toHaveBeenCalledWith("sprint-2");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Sprint Release prep created and selected.");
    });
  });

  it.each(["/tasks", "/live"] as const)("keeps %s project and sprint selectors synchronized with router scope", async (pathname) => {
    const user = userEvent.setup();
    const selectProject = vi.fn().mockResolvedValue(undefined);
    routerMocks.pathname = pathname;
    renderTopNav({
      projects: [project, secondProject] as any,
      selectProject,
    });

    await user.click(screen.getByRole("button", { name: /Project selector, selected project: Alpha/i }));
    await user.click(await screen.findByRole("option", { name: /Beta/i }));

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: pathname,
        search: { projectId: "proj-2" },
        replace: true,
      });
      expect(selectProject).toHaveBeenCalledWith("proj-2");
      expect(screen.getByRole("status")).toHaveTextContent("Project switched to Beta");
    });

    await user.click(screen.getByRole("button", { name: /Sprint selector/i }));
    await user.click(await screen.findByRole("option", { name: /Build shell/i }));

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: pathname,
        search: { projectId: "proj-1", sprintId: "sprint-1" },
        replace: true,
      });
      expect(selectSprint).toHaveBeenCalledWith("sprint-1");
      expect(screen.getByRole("status")).toHaveTextContent("Sprint switched to Build shell");
    });
  });
});
