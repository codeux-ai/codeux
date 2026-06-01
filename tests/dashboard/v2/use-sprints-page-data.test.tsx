/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

// Mock GSAP
vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => { fn(); return { revert: vi.fn() }; },
  },
}));

// Mock routing
vi.mock("@tanstack/react-router", () => ({
  useSearch: vi.fn().mockReturnValue({}),
  Link: ({ children }: any) => <a>{children}</a>,
}));

// Mock APIs
vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../dashboard/src/v2/lib/api/sprint-composer-client.js", () => ({
  fetchSprintComposerEta: vi.fn().mockResolvedValue({ estimatedMs: 60000 }),
}));
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  createSprint: vi.fn(),
  createTask: vi.fn(),
  updateSprintShowcase: vi.fn(),
  deleteSprint: vi.fn(),
  exportSprintMarkdown: vi.fn(),
  fetchProjectExecution: vi.fn(),
  fetchTasks: vi.fn(),
  importSprintMarkdown: vi.fn(),
  improveSprintPrompt: vi.fn(),
  planSprint: vi.fn(),
  updateSprint: vi.fn(),
  cancelPlanningRequest: vi.fn(),
}));

// Mock Contexts and hooks
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { useExecutions } from "../../../dashboard/src/hooks/useExecutions.js";
import { useProjectEffectiveSettings } from "../../../dashboard/src/v2/hooks/use-project-effective-settings.js";
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js";

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));
vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(),
}));
vi.mock("../../../dashboard/src/hooks/useExecutions.js", () => ({
  useExecutions: vi.fn(() => ({ data: { connections: [], sprintRuns: [] }, loading: false, refetch: vi.fn() })),
}));
vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(),
}));

describe("useSprintsPageData nextId derivation & loading state", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function getHookResult(renderFn: (result: any) => void) {
    function HookWrapper() {
      const result = useSprintsPageData();
      renderFn(result);
      return null;
    }
    render(<HookWrapper />);
  }

  it("regression: initially loading project with no sprints loaded yet returns neutral pending nextId", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [{ id: "proj-1", name: "Project 1" }],
      selectedProject: { id: "proj-1", name: "Project 1" },
      createProject: vi.fn(),
    } as any);

    vi.mocked(useSprints).mockReturnValue({
      data: [],
      loading: true,
      refetch: vi.fn(),
    } as any);

    vi.mocked(useProjectEffectiveSettings).mockReturnValue({
      data: {
        settings: {
          git: { sprintKeyPrefix: "SPR" },
          agents: { routing: null },
          workers: { executionMode: "MANUAL", virtualWorkerProvider: "gemini" }
        }
      },
    } as any);

    let lastResult: any = null;
    getHookResult((res) => {
      lastResult = res;
    });

    expect(lastResult.nextId).toBe("...");
    expect(lastResult.loading).toBe(true);
  });

  it("regression: loaded project whose latest sprint key is CODUX-34 resolves nextId to CODUX-35", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [{ id: "proj-1", name: "Project 1" }],
      selectedProject: { id: "proj-1", name: "Project 1" },
      createProject: vi.fn(),
    } as any);

    vi.mocked(useSprints).mockReturnValue({
      data: [
        { id: "CODUX-34", slug: "CODUX-34", number: 34, title: "Sprint 34", name: "Sprint 34", status: "completed" }
      ],
      loading: false,
      refetch: vi.fn(),
    } as any);

    vi.mocked(useProjectEffectiveSettings).mockReturnValue({
      data: {
        settings: {
          git: { sprintKeyPrefix: "SPR" },
          agents: { routing: null },
          workers: { executionMode: "MANUAL", virtualWorkerProvider: "gemini" }
        }
      },
    } as any);

    let lastResult: any = null;
    getHookResult((res) => {
      lastResult = res;
    });

    expect(lastResult.nextId).toBe("CODUX-35");
    expect(lastResult.loading).toBe(false);
  });

  it("regression: loaded project with no custom history should still use Settings prefix or fallback to SPR-01", () => {
    vi.mocked(useProjectData).mockReturnValue({
      projects: [{ id: "proj-1", name: "Project 1" }],
      selectedProject: { id: "proj-1", name: "Project 1" },
      createProject: vi.fn(),
    } as any);

    vi.mocked(useSprints).mockReturnValue({
      data: [],
      loading: false,
      refetch: vi.fn(),
    } as any);

    vi.mocked(useProjectEffectiveSettings).mockReturnValue({
      data: {
        settings: {
          git: { sprintKeyPrefix: "SPR" },
          agents: { routing: null },
          workers: { executionMode: "MANUAL", virtualWorkerProvider: "gemini" }
        }
      },
    } as any);

    let lastResult: any = null;
    getHookResult((res) => {
      lastResult = res;
    });

    expect(lastResult.nextId).toBe("SPR-01");
    expect(lastResult.loading).toBe(false);
  });

  it("regression: switching away from and back to a project recomputes from the selected project's list and retains last stable ID", () => {
    const mockProj1 = { id: "proj-1", name: "Project 1" };
    const mockProj2 = { id: "proj-2", name: "Project 2" };

    const useProjectDataMock = vi.mocked(useProjectData);
    const useSprintsMock = vi.mocked(useSprints);

    // Initial project select
    useProjectDataMock.mockReturnValue({
      projects: [mockProj1, mockProj2],
      selectedProject: mockProj1,
      createProject: vi.fn(),
    } as any);

    useSprintsMock.mockReturnValue({
      data: [
        { id: "CODUX-34", slug: "CODUX-34", number: 34, title: "Sprint 34", name: "Sprint 34", status: "completed" }
      ],
      loading: false,
      refetch: vi.fn(),
    } as any);

    vi.mocked(useProjectEffectiveSettings).mockReturnValue({
      data: {
        settings: {
          git: { sprintKeyPrefix: "SPR" },
          agents: { routing: null },
          workers: { executionMode: "MANUAL", virtualWorkerProvider: "gemini" }
        }
      },
    } as any);

    let lastResult: any = null;
    const { rerender } = render(<HookWrapper />);

    function HookWrapper() {
      const result = useSprintsPageData();
      lastResult = result;
      return null;
    }

    expect(lastResult.nextId).toBe("CODUX-35");

    // Switch to Project 2 (Loading state)
    useProjectDataMock.mockReturnValue({
      projects: [mockProj1, mockProj2],
      selectedProject: mockProj2,
      createProject: vi.fn(),
    } as any);

    useSprintsMock.mockReturnValue({
      data: [],
      loading: true,
      refetch: vi.fn(),
    } as any);

    rerender(<HookWrapper />);
    // Project 2 has no stable ID yet, so should show neutral pending value
    expect(lastResult.nextId).toBe("...");

    // Project 2 finishes loading with SPR prefix
    useSprintsMock.mockReturnValue({
      data: [
        { id: "SPR-02", slug: "SPR-02", number: 2, title: "Sprint 2", name: "Sprint 2", status: "completed" }
      ],
      loading: false,
      refetch: vi.fn(),
    } as any);

    rerender(<HookWrapper />);
    expect(lastResult.nextId).toBe("SPR-03");

    // Switch back to Project 1 (Loading state) - should retain stable nextId: CODUX-35
    useProjectDataMock.mockReturnValue({
      projects: [mockProj1, mockProj2],
      selectedProject: mockProj1,
      createProject: vi.fn(),
    } as any);

    useSprintsMock.mockReturnValue({
      data: [],
      loading: true,
      refetch: vi.fn(),
    } as any);

    rerender(<HookWrapper />);
    expect(lastResult.nextId).toBe("CODUX-35");
  });
});
