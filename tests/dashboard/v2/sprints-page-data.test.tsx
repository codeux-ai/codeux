/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js";

expect.extend(matchers);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const baseSprint = {
  id: "sprint-1",
  number: 1,
  slug: "SPR-01",
  name: "Existing Sprint",
  goal: "Existing",
  originalPrompt: null,
  status: "idle",
  showcasePinned: true,
  startDate: null,
  endDate: null,
  linkedIssues: [],
  tasksCount: 0,
};

let sprintsData: any[] = [baseSprint];
const refreshMock = vi.fn(async () => undefined);
const refreshExecutionMock = vi.fn(async () => undefined);
const createSprintMock = vi.fn();
const executeQuicksprintMock = vi.fn();

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    projects: [{ id: "project-1", name: "Project 1" }],
    selectedProject: { id: "project-1", name: "Project 1" },
    createProject: vi.fn(),
  })),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(() => ({ data: sprintsData, refetch: refreshMock, loading: false })),
}));

vi.mock("../../../dashboard/src/hooks/useExecutions.js", () => ({
  useExecutions: vi.fn(() => ({ data: { connections: [], sprintRuns: [] }, refetch: refreshExecutionMock, loading: false })),
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

vi.mock("../../../dashboard/src/v2/lib/api/sprint-composer-client.js", () => ({
  fetchSprintComposerEta: vi.fn().mockResolvedValue({ estimatedMs: 60000, sampleSize: 8, isFallback: false }),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  createSprint: (...args: unknown[]) => createSprintMock(...args),
  planSprint: vi.fn(),
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

vi.mock("../../../dashboard/src/v2/lib/quicksprint-api.js", () => ({
  fetchQuicksprintTemplates: vi.fn(),
  executeQuicksprint: (...args: unknown[]) => executeQuicksprintMock(...args),
  createCustomQuicksprintTemplate: vi.fn(),
  updateCustomQuicksprintTemplate: vi.fn(),
  deleteCustomQuicksprintTemplate: vi.fn(),
}));

const HookHarness = () => {
  const data = useSprintsPageData();
  return (
    <div>
      <div data-testid="next-id">{data.nextId}</div>
      <button
        type="button"
        onClick={() => {
          void data.handleSubmitSprint({
            name: "Queued sprint",
            goal: "Create sprint",
            originalPrompt: "Create sprint",
            submitMode: "draft",
            routeOverride: null,
            modelOverride: null,
            planningAgentPresetId: null,
            agentRoutingMode: "MANUAL",
            workerAgentPresetId: null,
            linkedIssues: [],
          }).catch(() => undefined);
        }}
      >
        submit-sprint
      </button>
      <button
        type="button"
        onClick={() => {
          void data.handleQuicksprintExecute("template-1", 4, "plan_only").catch(() => undefined);
        }}
      >
        quicksprint
      </button>
    </div>
  );
};

describe("useSprintsPageData sprint-number reservations", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sprintsData = [baseSprint];
  });

  it("advances nextId while create sprint request is unresolved and resets after failure", async () => {
    const deferred = createDeferred<{ id: string }>();
    createSprintMock.mockReturnValueOnce(deferred.promise);
    render(<HookHarness />);

    expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");

    fireEvent.click(screen.getByRole("button", { name: "submit-sprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    await waitFor(() => {
      expect(createSprintMock).toHaveBeenCalledTimes(1);
    });
    expect(createSprintMock.mock.calls[0]?.[1]).toMatchObject({ number: 2 });

    deferred.reject(new Error("create failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");
    });
  });

  it("reserves distinct sprint numbers for multiple unresolved sprint creations", async () => {
    const firstDeferred = createDeferred<{ id: string }>();
    const secondDeferred = createDeferred<{ id: string }>();
    createSprintMock
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);
    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "submit-sprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    fireEvent.click(screen.getByRole("button", { name: "submit-sprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-04");
    });
    expect(createSprintMock.mock.calls[0]?.[1]).toMatchObject({ number: 2 });
    expect(createSprintMock.mock.calls[1]?.[1]).toMatchObject({ number: 3 });

    firstDeferred.reject(new Error("first create failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    secondDeferred.reject(new Error("second create failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");
    });
  });

  it("advances nextId while quicksprint execution is unresolved and resets after failure", async () => {
    const deferred = createDeferred<{ id: string }>();
    executeQuicksprintMock.mockReturnValueOnce(deferred.promise);
    render(<HookHarness />);

    expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");

    fireEvent.click(screen.getByRole("button", { name: "quicksprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    deferred.reject(new Error("quicksprint failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");
    });
  });

  it("reserves distinct sprint numbers for multiple unresolved quicksprint executions", async () => {
    const firstDeferred = createDeferred<{ id: string }>();
    const secondDeferred = createDeferred<{ id: string }>();
    executeQuicksprintMock
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);
    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "quicksprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    fireEvent.click(screen.getByRole("button", { name: "quicksprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-04");
    });

    firstDeferred.reject(new Error("first quicksprint failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-03");
    });

    secondDeferred.reject(new Error("second quicksprint failed"));

    await waitFor(() => {
      expect(screen.getByTestId("next-id")).toHaveTextContent("SPR-02");
    });
  });
});
