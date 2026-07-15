/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { renderWithI18n } from "../render-with-i18n.js";
import { useSprintsPageActions } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-actions.js";
import { useSprintsPageData } from "../../../dashboard/src/v2/pages/sprints/use-sprints-page-data.js";
import { fetchAgentPresets } from "../../../dashboard/src/v2/lib/agent-preset-api.js";

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
const updateSprintMock = vi.fn();
const markSprintCompletedMock = vi.fn();
const markSprintQaPassedMock = vi.fn();
const addImportedTasksToSprintMock = vi.fn();
const executeQuicksprintMock = vi.fn();
const createSchedulerEntryMock = vi.fn();

const renderActions = (createProject = vi.fn()) => {
  let actionsRef: ReturnType<typeof useSprintsPageActions> | null = null;
  const ActionHarness = () => {
    actionsRef = useSprintsPageActions({
      selectedProject: { id: "project-1" },
      sprints: [baseSprint] as any,
      sprintKeyPrefix: "SPR",
      activeRunsBySprintId: new Map(),
      pauseResumeRunsBySprintId: new Map(),
      pendingActionIds: new Set(),
      setPendingActionIds: vi.fn(),
      setOptimisticStatuses: vi.fn(),
      setSuppressedRunningSprintIds: vi.fn(),
      refresh: refreshMock,
      refreshExecution: refreshExecutionMock,
      refreshPlanningEta: vi.fn(),
      inFlightStartIds: { current: new Set() },
      editingSprint: null,
      setEditingSprint: vi.fn(),
      reserveNextSprintNumber: vi.fn(() => 2),
      releaseSprintNumberReservation: vi.fn(),
      setError: vi.fn(),
      setExportState: vi.fn(),
      addTaskForSprint: null,
      setAddTaskSprintTasks: vi.fn(),
      setAddTaskForSprint: vi.fn(),
      reloadQuicksprintTemplates: vi.fn(),
      createProject,
    } as any);
    return null;
  };

  renderWithI18n(<ActionHarness />);
  if (!actionsRef) {
    throw new Error("actions did not render");
  }
  return actionsRef;
};

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
  updateSprint: (...args: unknown[]) => updateSprintMock(...args),
  markSprintCompleted: (...args: unknown[]) => markSprintCompletedMock(...args),
  markSprintQaPassed: (...args: unknown[]) => markSprintQaPassedMock(...args),
  addImportedTasksToSprint: (...args: unknown[]) => addImportedTasksToSprintMock(...args),
  planSprint: vi.fn(),
  improveSprintPrompt: vi.fn(),
  cancelPlanningRequest: vi.fn(),
  updateSprintShowcase: vi.fn(),
  deleteSprint: vi.fn(),
  exportSprintMarkdown: vi.fn(),
  fetchProjectExecution: vi.fn(),
  fetchTasks: vi.fn(),
  importSprintMarkdown: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/quicksprint-api.js", () => ({
  fetchQuicksprintTemplates: vi.fn(),
  executeQuicksprint: (...args: unknown[]) => executeQuicksprintMock(...args),
  createCustomQuicksprintTemplate: vi.fn(),
  updateCustomQuicksprintTemplate: vi.fn(),
  deleteCustomQuicksprintTemplate: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/scheduler-api.js", () => ({
  createSchedulerEntry: (...args: unknown[]) => createSchedulerEntryMock(...args),
}));

const HookHarness = () => {
  const data = useSprintsPageData();
  const [submitExistingSprint, setSubmitExistingSprint] = useState(false);

  useEffect(() => {
    if (!submitExistingSprint || !data.editingSprint) {
      return;
    }
    setSubmitExistingSprint(false);
    void data.handleSubmitSprint({
      name: "Existing sprint",
      goal: "Existing",
      originalPrompt: null,
      submitMode: "draft",
      routeOverride: null,
      modelOverride: null,
      planningAgentPresetId: null,
      agentRoutingMode: "MANUAL",
      workerAgentPresetId: null,
      linkedIssues: [],
      importedTasks: [
        {
          kind: "quality",
          title: "Quality follow-up: Fix UI",
          sourceUrl: "https://github.com/acme/widgets/issues/43",
          sourcePath: "https://github.com/acme/widgets/issues/43",
          provider: "github",
          repository: "acme/widgets",
        },
      ],
    }).catch(() => undefined);
  }, [data.editingSprint, data.handleSubmitSprint, submitExistingSprint]);

  return (
    <div>
      <div data-testid="next-id">{data.nextId}</div>
      <div data-testid="editing-sprint">{data.editingSprint?.id || "none"}</div>
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
          void data.handleSubmitSprint({
            name: "Queued sprint with tasks",
            goal: "Create sprint",
            originalPrompt: "Create sprint",
            submitMode: "draft",
            routeOverride: null,
            modelOverride: null,
            planningAgentPresetId: null,
            agentRoutingMode: "MANUAL",
            workerAgentPresetId: null,
            linkedIssues: [],
            importedTasks: [
              {
                kind: "security",
                title: "Security follow-up: Fix CI",
                sourceUrl: "https://github.com/acme/widgets/issues/42",
                sourcePath: "https://github.com/acme/widgets/issues/42",
                provider: "github",
                repository: "acme/widgets",
              },
            ],
          }).catch(() => undefined);
        }}
      >
        submit-sprint-with-tasks
      </button>
      <button
        type="button"
        onClick={() => {
          data.setEditingSprint(baseSprint);
          setSubmitExistingSprint(true);
        }}
      >
        edit-sprint
      </button>
      <button
        type="button"
        onClick={() => {
          data.setEditingSprint(baseSprint);
          setSubmitExistingSprint(true);
        }}
      >
        submit-edit-with-tasks
      </button>
      <button
        type="button"
        onClick={() => {
          void data.handleQuicksprintExecute("template-1", 4, "plan_only").catch(() => undefined);
        }}
      >
        quicksprint
      </button>
      <button
        type="button"
        onClick={() => {
          void data.handleQuicksprintExecute(
            "template-1",
            4,
            "plan_only",
            undefined,
            undefined,
            undefined,
            undefined,
            { noTaskLimit: true },
          ).catch(() => undefined);
        }}
      >
        quicksprint-unlimited
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
    renderWithI18n(<HookHarness />);

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

  it("aborts the agent-preset request when the sprint page unmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(fetchAgentPresets).mockImplementationOnce((_projectId, signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
      });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = renderWithI18n(<HookHarness />);

    await waitFor(() => expect(requestSignal).toBeDefined());
    view.unmount();
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));

    expect(consoleError).not.toHaveBeenCalledWith("Failed to fetch agent presets", expect.anything());
    consoleError.mockRestore();
  });

  it("creates a sprint without passing imported tasks in the create payload and then adds them through the imported-task API", async () => {
    createSprintMock.mockResolvedValueOnce({ id: "new-sprint" });
    addImportedTasksToSprintMock.mockResolvedValueOnce([]);
    renderWithI18n(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "submit-sprint-with-tasks" }));

    await waitFor(() => {
      expect(createSprintMock).toHaveBeenCalledTimes(1);
      expect(addImportedTasksToSprintMock).toHaveBeenCalledTimes(1);
    });

    expect(createSprintMock.mock.calls[0]?.[1]).not.toHaveProperty("importedTasks");
    expect(addImportedTasksToSprintMock.mock.calls[0]).toEqual([
      "project-1",
      "new-sprint",
      [
        expect.objectContaining({
          kind: "security",
          repository: "acme/widgets",
        }),
      ],
    ]);
  });

  it("updates an existing sprint and sends imported tasks through the imported-task API", async () => {
    updateSprintMock.mockResolvedValueOnce(undefined);
    addImportedTasksToSprintMock.mockResolvedValueOnce([]);
    let actionsRef: ReturnType<typeof useSprintsPageActions> | null = null;
    const ActionHarness = () => {
      actionsRef = useSprintsPageActions({
        selectedProject: { id: "project-1" },
        sprints: [baseSprint] as any,
        sprintKeyPrefix: "SPR",
        activeRunsBySprintId: new Map(),
        pauseResumeRunsBySprintId: new Map(),
        pendingActionIds: new Set(),
        setPendingActionIds: vi.fn(),
        setOptimisticStatuses: vi.fn(),
        setSuppressedRunningSprintIds: vi.fn(),
        refresh: refreshMock,
        refreshExecution: refreshExecutionMock,
        refreshPlanningEta: vi.fn(),
        inFlightStartIds: { current: new Set() },
        editingSprint: baseSprint as any,
        setEditingSprint: vi.fn(),
        reserveNextSprintNumber: vi.fn(() => 2),
        releaseSprintNumberReservation: vi.fn(),
        setError: vi.fn(),
        setExportState: vi.fn(),
        addTaskForSprint: null,
        setAddTaskSprintTasks: vi.fn(),
        setAddTaskForSprint: vi.fn(),
        reloadQuicksprintTemplates: vi.fn(),
        createProject: vi.fn(),
      } as any);
      return null;
    };

    renderWithI18n(<ActionHarness />);
    await actionsRef!.handleSubmitSprint({
      name: "Existing sprint",
      goal: "Existing",
      originalPrompt: null,
      submitMode: "draft",
      routeOverride: null,
      modelOverride: null,
      planningAgentPresetId: null,
      agentRoutingMode: "MANUAL",
      workerAgentPresetId: null,
      linkedIssues: [],
      importedTasks: [
        {
          kind: "quality",
          title: "Quality follow-up: Fix UI",
          sourceUrl: "https://github.com/acme/widgets/issues/43",
          sourcePath: "https://github.com/acme/widgets/issues/43",
          provider: "github",
          repository: "acme/widgets",
        },
      ],
    });

    await waitFor(() => {
      expect(updateSprintMock).toHaveBeenCalledTimes(1);
      expect(addImportedTasksToSprintMock).toHaveBeenCalledTimes(1);
    });

    expect(updateSprintMock.mock.calls[0]?.[1]).not.toHaveProperty("importedTasks");
    expect(addImportedTasksToSprintMock.mock.calls[0]).toEqual([
      "project-1",
      "sprint-1",
      [
        expect.objectContaining({
          kind: "quality",
          repository: "acme/widgets",
        }),
      ],
    ]);
  });

  it("creates local projects with LOCAL git-mode settings overrides", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    const actions = renderActions(createProject);

    await actions.handleAddProject({
      name: "Local Project",
      type: "local",
      path: "/workspace/local-project",
    });

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: "Local Project",
      sourceType: "local",
      sourceRef: "/workspace/local-project",
      settingsOverrides: expect.objectContaining({
        git: { githubMode: "LOCAL" },
      }),
    }));
    const settingsOverrides = createProject.mock.calls[0]?.[0].settingsOverrides;
    expect(settingsOverrides.skills.find((skill: any) => skill.name === "git_manager_local")?.enabled).toBe(true);
    expect(settingsOverrides.skills.find((skill: any) => skill.name === "git_manager_remote")?.enabled).toBe(false);
  });

  it("creates a scheduler entry when a new sprint is submitted in schedule mode", async () => {
    createSprintMock.mockResolvedValueOnce({ id: "scheduled-sprint", name: "Scheduled Sprint" });
    createSchedulerEntryMock.mockResolvedValueOnce({ id: "schedule-1" });
    const actions = renderActions();

    await actions.handleSubmitSprint({
      name: "Scheduled Sprint",
      goal: "Run later",
      originalPrompt: "Run later",
      submitMode: "schedule",
      routeOverride: null,
      modelOverride: null,
      planningAgentPresetId: "planner-1",
      agentRoutingMode: "ORCHESTRATOR",
      workerAgentPresetId: null,
      linkedIssues: [],
      schedule: {
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint-1",
          offsetMinutes: 20,
        },
      },
    });

    expect(createSprintMock).toHaveBeenCalledTimes(1);
    expect(createSchedulerEntryMock).toHaveBeenCalledWith("project-1", expect.objectContaining({
      title: "Start Scheduled Sprint",
      targetType: "sprint",
      sprintTarget: { sprintId: "scheduled-sprint" },
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint-1",
        offsetMinutes: 20,
      },
    }));
  });

  it("creates a scheduler entry for quicksprint schedule requests", async () => {
    createSchedulerEntryMock.mockResolvedValueOnce({ id: "schedule-1" });
    const actions = renderActions();

    await actions.handleQuicksprintSchedule({
      templateId: "template-1",
      taskCount: 4,
      noTaskLimit: true,
      submitMode: "plan_only",
      additionalPrompt: "Only deployment follow-ups.",
      routeOverride: null,
      modelOverride: null,
      title: "Run Template 1",
      schedule: {
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint-1",
          offsetMinutes: 30,
        },
      },
    });

    expect(createSchedulerEntryMock).toHaveBeenCalledWith("project-1", expect.objectContaining({
      title: "Run Template 1",
      targetType: "quicksprint",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint-1",
        offsetMinutes: 30,
      },
      quicksprintTarget: {
        templateId: "template-1",
        taskCount: 4,
        noTaskLimit: true,
        submitMode: "plan_only",
        additionalPrompt: "Only deployment follow-ups.",
        planningOverrides: undefined,
      },
    }));
  });

  it("preserves remote project creation without LOCAL git-mode overrides", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    const actions = renderActions(createProject);

    await actions.handleAddProject({
      name: "Remote Project",
      type: "new_project",
      path: "",
      initMode: "new-remote",
      repoSlug: "remote-project",
      remoteProvider: "github",
      isPrivate: true,
    });

    expect(createProject).toHaveBeenCalledWith({
      name: "Remote Project",
      sourceType: "git",
      sourceRef: "remote-project",
      initMode: "new-remote",
      remoteProvider: "github",
      isPrivate: true,
      settingsOverrides: {
        techstack: {
          selectedTechstackId: "code-ux-internal",
          applicationKind: null,
        },
      },
    });
    expect(createProject.mock.calls[0]?.[0].settingsOverrides.git).toBeUndefined();
  });

  it("reserves distinct sprint numbers for multiple unresolved sprint creations", async () => {
    const firstDeferred = createDeferred<{ id: string }>();
    const secondDeferred = createDeferred<{ id: string }>();
    createSprintMock
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);
    renderWithI18n(<HookHarness />);

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
    renderWithI18n(<HookHarness />);

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

  it("includes noTaskLimit in the quicksprint execution payload", async () => {
    const deferred = createDeferred<{ id: string }>();
    executeQuicksprintMock.mockReturnValueOnce(deferred.promise);
    renderWithI18n(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "quicksprint-unlimited" }));

    await waitFor(() => {
      expect(executeQuicksprintMock).toHaveBeenCalledTimes(1);
    });
    expect(executeQuicksprintMock.mock.calls[0]?.[1]).toMatchObject({
      templateId: "template-1",
      taskCount: 4,
      noTaskLimit: true,
      submitMode: "plan_only",
    });

    deferred.reject(new Error("quicksprint failed"));
  });

  it("reserves distinct sprint numbers for multiple unresolved quicksprint executions", async () => {
    const firstDeferred = createDeferred<{ id: string }>();
    const secondDeferred = createDeferred<{ id: string }>();
    executeQuicksprintMock
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);
    renderWithI18n(<HookHarness />);

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

describe("useSprintsPageActions manual sprint state", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the manual completion endpoint instead of patching sprint status directly", async () => {
    markSprintCompletedMock.mockResolvedValueOnce({ ...baseSprint, status: "completed" });
    const actions = renderActions();

    await actions.handleMarkCompleted(baseSprint.id);

    expect(markSprintCompletedMock).toHaveBeenCalledWith(baseSprint.id);
    expect(updateSprintMock).not.toHaveBeenCalledWith(baseSprint.id, { status: "completed" });
    expect(refreshMock).toHaveBeenCalled();
    expect(refreshExecutionMock).toHaveBeenCalled();
  });

  it("persists a manual sprint QA pass and refreshes sprint review state", async () => {
    markSprintQaPassedMock.mockResolvedValueOnce({
      ...baseSprint,
      latestReview: { status: "completed", outcome: "pass" },
    });
    const actions = renderActions();

    await actions.handleMarkQaPassed(baseSprint.id);

    expect(markSprintQaPassedMock).toHaveBeenCalledWith(baseSprint.id);
    expect(refreshMock).toHaveBeenCalled();
    expect(refreshExecutionMock).toHaveBeenCalled();
  });
});
