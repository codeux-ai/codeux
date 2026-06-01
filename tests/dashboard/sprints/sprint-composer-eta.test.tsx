/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useEffect } from "preact/hooks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    projects: [{ id: "project-1", name: "Project 1" }],
    selectedProject: { id: "project-1", name: "Project 1" },
    createProject: vi.fn(),
  })),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(() => ({ data: [], refetch: vi.fn().mockResolvedValue(undefined), loading: false })),
}));

vi.mock("../../../dashboard/src/hooks/useExecutions.js", () => ({
  useExecutions: vi.fn(() => ({ data: { connections: [], sprintRuns: [] }, refetch: vi.fn().mockResolvedValue(undefined), loading: false })),
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(() => ({ data: null })),
}));

vi.mock("../../../dashboard/src/v2/lib/quicksprint-api.js", () => ({
  fetchQuicksprintTemplates: vi.fn(),
  executeQuicksprint: vi.fn(),
  createCustomQuicksprintTemplate: vi.fn(),
  updateCustomQuicksprintTemplate: vi.fn(),
  deleteCustomQuicksprintTemplate: vi.fn(),
}));

const createSprintMock = vi.fn(async () => ({ id: "spr-1" }));
const planSprintMock = vi.fn(async () => ({ ok: true }));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  createSprint: (...args: unknown[]) => createSprintMock(...args),
  planSprint: (...args: unknown[]) => planSprintMock(...args),
  improveSprintPrompt: vi.fn(),
  cancelPlanningRequest: vi.fn(),
  updateSprintShowcase: vi.fn(),
  deleteSprint: vi.fn(),
  exportSprintMarkdown: vi.fn(),
  fetchProjectExecution: vi.fn(),
  fetchTasks: vi.fn(),
  importSprintMarkdown: vi.fn(),
  updateSprint: vi.fn(),
  createTask: vi.fn(),
}));

const fetchSprintComposerEtaMock = vi.fn();

vi.mock("../../../dashboard/src/v2/lib/api/sprint-composer-client.js", () => ({
  fetchSprintComposerEta: (...args: unknown[]) => fetchSprintComposerEtaMock(...args),
}));

const HookHarness = () => {
  const data = useSprintsPageData();

  useEffect(() => {
    if (data.selectedProject) {
      void data.handleSubmitSprint({
        name: "ETA refresh sprint",
        goal: "Generate tasks",
        originalPrompt: "Generate tasks",
        submitMode: "plan_only",
        routeOverride: null,
        modelOverride: null,
        planningAgentPresetId: null,
        agentRoutingMode: "MANUAL",
        workerAgentPresetId: null,
        linkedIssues: [],
      });
    }
    // run once after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div data-testid="eta-ms">{String(data.planningEta)}</div>
      <button type="button" onClick={() => {
        void data.handleSubmitSprint({
          name: "ETA refresh sprint",
          goal: "Generate tasks",
          originalPrompt: "Generate tasks",
          submitMode: "plan_only",
          routeOverride: null,
          modelOverride: null,
          planningAgentPresetId: null,
          agentRoutingMode: "MANUAL",
          workerAgentPresetId: null,
          linkedIssues: [],
        });
      }}>submit</button>
    </div>
  );
};

describe("Sprint composer ETA wiring", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fetchSprintComposerEtaMock
      .mockResolvedValueOnce({ estimatedMs: 91000, sampleSize: 10, isFallback: false })
      .mockResolvedValueOnce({ estimatedMs: 45000, sampleSize: 10, isFallback: false });
  });

  it("renders backend ETA and refreshes it after planning invocation", async () => {
    render(<HookHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("eta-ms")).toHaveTextContent("91000");
    });

    await waitFor(() => {
      expect(screen.getByTestId("eta-ms")).toHaveTextContent("45000");
    });

    expect(fetchSprintComposerEtaMock).toHaveBeenCalledTimes(2);
    expect(createSprintMock).toHaveBeenCalled();
    expect(planSprintMock).toHaveBeenCalled();
  });

  it("falls back safely when ETA endpoint fails", async () => {
    fetchSprintComposerEtaMock.mockReset();
    fetchSprintComposerEtaMock.mockRejectedValueOnce(new Error("eta failed"));
    render(<HookHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("eta-ms")).toHaveTextContent("180000");
    });
  });
});
