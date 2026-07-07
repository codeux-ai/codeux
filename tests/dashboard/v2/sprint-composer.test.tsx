/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import { useState } from "preact/hooks";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/preact";
import type { SprintLinkedIssueInput } from "../../../dashboard/src/v2/types.js";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    timeline: () => ({
      fromTo: vi.fn(),
    }),
  },
}));

vi.mock("../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: vi.fn(() => ({ execution: { connections: [] } })),
}));

import { SprintComposer } from "../../../dashboard/src/v2/components/ui/SprintComposer.js";

describe("SprintComposer", () => {
  beforeEach(() => {
    cleanup();
  });

  const defaultProps = {
    nextId: "SPR-1",
    virtualProviders: [],
    planningPresets: [],
    planningEta: 60000,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  it("renders correctly", () => {
    const { getByText, getByPlaceholderText } = render(<SprintComposer {...defaultProps} />);
    expect(getByText("Compose The Next Sprint.")).toBeInTheDocument();
    expect(getByPlaceholderText("Runtime hardening")).toBeInTheDocument();
  });

  it("renders provider instance route labels, default models, and brand icons", async () => {
    const { getByRole, getByText, queryByText } = render(
      <SprintComposer
        {...defaultProps}
        virtualProviders={[
          {
            providerConfigId: "codex-primary",
            provider: "codex",
            displayLabel: "Codex Primary",
            iconProviderId: "codex",
            effectiveModel: "gpt-5.5",
          },
        ]}
        defaultRouteOptionLabel="Default Route (Codex Primary)"
        defaultModelOptionLabel="Default Model (gpt-5.5)"
        defaultRouteIconProviderId="codex"
      />
    );

    expect(getByText("Default Route (Codex Primary)")).toBeInTheDocument();
    expect(getByText("Default Model (gpt-5.5)")).toBeInTheDocument();
    expect(document.body.querySelector('img[src="/lobe-icons/codex-color.svg"]')).toBeInTheDocument();
    expect(queryByText("Virtual Codex Worker")).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Planning Route" }));
    await waitFor(() => {
      expect(getByText("Codex Primary")).toBeInTheDocument();
    });
    expect(document.body.querySelectorAll('img[src="/lobe-icons/codex-color.svg"]').length).toBeGreaterThan(1);
  });

  it("renders linked issue cards for GitHub, GitLab, and Jira", () => {
    const issues: SprintLinkedIssueInput[] = [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 12,
        issueKey: "#12",
        title: "Improve GitHub issue import",
        url: "https://github.com/openai/example/issues/12",
        state: "open",
        labels: ["ux"],
        assignees: ["pierre"],
        includeConversation: true,
      },
      {
        provider: "gitlab",
        hostDomain: "gitlab.com",
        repository: "platform/runtime",
        issueNumber: 34,
        issueKey: "#34",
        title: "Handle GitLab labels without clipping",
        url: "https://gitlab.com/platform/runtime/-/issues/34",
        state: "opened",
        labels: ["frontend-polish"],
        assignees: ["alex"],
        includeConversation: false,
      },
      {
        provider: "jira",
        hostDomain: "example.atlassian.net",
        projectKey: "OPS",
        repository: "OPS",
        issueNumber: 56,
        issueKey: "OPS-56",
        title: "Review Jira sprint scope",
        url: "https://example.atlassian.net/browse/OPS-56",
        state: "To Do",
        labels: ["triage"],
        assignees: ["sam"],
        includeConversation: false,
      },
    ];

    const { getAllByText, getByRole, getByText } = render(
      <SprintComposer {...defaultProps} linkedIssues={issues} />
    );

    expect(getByText("Linked Issues")).toBeInTheDocument();
    expect(getByText("3 imported")).toBeInTheDocument();
    expect(getAllByText("GitHub").length).toBeGreaterThan(0);
    expect(getAllByText("GitLab").length).toBeGreaterThan(0);
    expect(getAllByText("Jira").length).toBeGreaterThan(0);
    expect(getByText("open")).toBeInTheDocument();
    expect(getByText("opened")).toBeInTheDocument();
    expect(getByText("To Do")).toBeInTheDocument();
    expect(getByText("platform/runtime")).toBeInTheDocument();
    expect(getByText("OPS")).toBeInTheDocument();
    expect(getByText("Conversation included")).toBeInTheDocument();
    expect(getAllByText("Conversation omitted")).toHaveLength(2);
    expect(getByRole("link", { name: /open source issue #12/i })).toHaveAttribute("href", issues[0]!.url);
    expect(getByRole("link", { name: /open source issue OPS-56/i })).toHaveAttribute("href", issues[2]!.url);
  });

  it("removes linked issues before submit and preserves submitted issue payloads", async () => {
    const onSubmit = vi.fn();
    const issues: SprintLinkedIssueInput[] = [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "openai/example",
        issueNumber: 12,
        issueKey: "#12",
        title: "Improve issue import",
        url: "https://github.com/openai/example/issues/12",
        state: "open",
        labels: ["ux"],
        assignees: ["pierre"],
        issueBodyMarkdown: "Full GitHub body",
        issueConversationMarkdown: "GitHub discussion",
        includeConversation: true,
      },
      {
        provider: "jira",
        hostDomain: "example.atlassian.net",
        projectKey: "OPS",
        repository: "OPS",
        issueNumber: 56,
        issueKey: "OPS-56",
        title: "Remove this imported issue",
        url: "https://example.atlassian.net/browse/OPS-56",
        state: "To Do",
        labels: ["triage"],
        assignees: ["sam"],
        issueBodyMarkdown: "Full Jira body",
        issueConversationMarkdown: "Jira discussion",
        includeConversation: false,
      },
    ];

    const Harness = () => {
      const [linkedIssues, setLinkedIssues] = useState<SprintLinkedIssueInput[]>(issues);

      return (
        <SprintComposer
          {...defaultProps}
          onSubmit={onSubmit}
          linkedIssues={linkedIssues}
          onRemoveLinkedIssue={(issue) => {
            setLinkedIssues((current) => current.filter((candidate) => (
              candidate.provider !== issue.provider
              || candidate.hostDomain !== issue.hostDomain
              || candidate.repository !== issue.repository
              || candidate.issueNumber !== issue.issueNumber
            )));
          }}
        />
      );
    };

    const { getByText, getByPlaceholderText, getAllByText, getByRole, queryByText } = render(
      <Harness />
    );

    fireEvent.input(getByPlaceholderText("Runtime hardening"), { target: { value: "Import sprint" } });
    expect(getByText("Improve issue import")).toBeInTheDocument();
    expect(getByText("Remove this imported issue")).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: /remove linked issue OPS-56/i }));
    expect(queryByText("Remove this imported issue")).not.toBeInTheDocument();

    fireEvent.click(getAllByText("Plan & Start").pop()!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      goal: "",
      linkedIssues: [issues[0]],
    });
  });

  it("renders imported special tasks with metadata, removal controls, and task-import feedback", async () => {
    const onRemoveImportedTask = vi.fn();
    const onClearImportedTaskFeedback = vi.fn();
    const clearImportedTaskError = vi.fn();
    const task = {
      kind: "security" as const,
      title: "Security follow-up: Fix CI",
      sourceUrl: "https://github.com/openai/example/issues/12",
      sourcePath: "https://github.com/openai/example/issues/12",
      provider: "github",
      repository: "openai/example",
      priority: "high" as const,
    };

    const { getByText, getByRole, getAllByText } = render(
      <SprintComposer
        {...defaultProps}
        importedTasks={[task]}
        onRemoveImportedTask={onRemoveImportedTask}
        importedTaskFeedback={{ status: "error", message: "Special imported tasks were not added: API error" }}
        onClearImportedTaskFeedback={onClearImportedTaskFeedback}
        clearImportedTaskError={clearImportedTaskError}
      />
    );

    expect(getByText("Special Imported Tasks")).toBeInTheDocument();
    expect(getByText("Security")).toBeInTheDocument();
    expect(getAllByText("High").length).toBeGreaterThan(0);
    expect(getByRole("link", { name: task.sourceUrl! })).toBeInTheDocument();
    expect(getByText("Special imported tasks were not added: API error")).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: /remove task/i }));
    expect(onRemoveImportedTask).toHaveBeenCalledWith(task);
    expect(onClearImportedTaskFeedback).toHaveBeenCalledTimes(1);
    expect(clearImportedTaskError).toHaveBeenCalledTimes(1);
  });

  it("uses default planning and worker agents for new sprint submissions", async () => {
    const onSubmit = vi.fn();
    const agentPresets = [
      {
        id: "planner-1",
        projectId: "project-1",
        name: "Delivery Planner",
        labels: [],
        instructionMarkdown: "",
        syncStatus: "manual" as const,
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "worker-1",
        projectId: "project-1",
        name: "Frontend Coder",
        labels: [],
        instructionMarkdown: "",
        syncStatus: "manual" as const,
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const { getByPlaceholderText, getAllByText } = render(
      <SprintComposer
        {...defaultProps}
        agentPresets={agentPresets as any}
        planningPresets={agentPresets as any}
        defaultPlanningAgentPresetId="planner-1"
        defaultAgentRoutingMode="MANUAL"
        defaultWorkerAgentPresetId="worker-1"
        onSubmit={onSubmit}
      />
    );

    expect(getAllByText("Delivery Planner").length).toBeGreaterThan(0);
    expect(getAllByText("Frontend Coder").length).toBeGreaterThan(0);

    fireEvent.input(getByPlaceholderText("Runtime hardening"), { target: { value: "Agent defaults" } });
    fireEvent.click(getAllByText("Plan & Start").pop()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      planningAgentPresetId: "planner-1",
      agentRoutingMode: "MANUAL",
      workerAgentPresetId: "worker-1",
    });
  });

  it("submits schedule payloads with after-sprint-end anchors and preserves composer fields", async () => {
    const onSubmit = vi.fn();
    const issue: SprintLinkedIssueInput = {
      provider: "github",
      hostDomain: "github.com",
      repository: "openai/example",
      issueNumber: 12,
      issueKey: "#12",
      title: "Follow linked issue",
      url: "https://github.com/openai/example/issues/12",
      state: "open",
      labels: ["scheduler"],
      assignees: [],
      includeConversation: false,
    };

    const { getByPlaceholderText, getByRole, getAllByText, getByText } = render(
      <SprintComposer
        {...defaultProps}
        onSubmit={onSubmit}
        linkedIssues={[issue]}
        defaultPlanningAgentPresetId="planner-1"
        defaultAgentRoutingMode="ORCHESTRATOR"
        scheduleAnchorSprintOptions={[{ id: "source-sprint-1", label: "Release prep" }]}
      />
    );

    fireEvent.input(getByPlaceholderText("Runtime hardening"), { target: { value: "Scheduled Sprint" } });
    fireEvent.input(getByPlaceholderText("Describe the outcome, affected systems, and what done looks like when this sprint lands."), {
      target: { value: "Run after the release prep sprint ends." },
    });
    fireEvent.input(getByRole("textbox", { name: /sprint key override/i }), { target: { value: "OPS-42" } });

    fireEvent.click(getAllByText("Schedule")[0]!);
    fireEvent.click(getByRole("button", { name: "After End" }));
    fireEvent.click(getByRole("button", { name: "Source Sprint" }));
    fireEvent.click(getByText("Release prep"));
    fireEvent.input(getByRole("spinbutton", { name: /offset minutes/i }), { target: { value: "15" } });
    fireEvent.click(getAllByText("Schedule").pop()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Scheduled Sprint",
      goal: "Run after the release prep sprint ends.",
      submitMode: "schedule",
      sprintKeyOverride: "OPS-42",
      planningAgentPresetId: "planner-1",
      agentRoutingMode: "ORCHESTRATOR",
      workerAgentPresetId: null,
      linkedIssues: [issue],
      schedule: {
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint-1",
          offsetMinutes: 15,
        },
      },
    });
  });

  it("keeps default planning and worker agents while agent options load", async () => {
    const agentPresets = [
      {
        id: "planner-1",
        projectId: "project-1",
        name: "Test Planning Agent",
        labels: [],
        instructionMarkdown: "",
        syncStatus: "manual" as const,
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "worker-1",
        projectId: "project-1",
        name: "Test Worker Agent",
        labels: [],
        instructionMarkdown: "",
        syncStatus: "manual" as const,
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const { rerender, getAllByText } = render(
      <SprintComposer
        {...defaultProps}
        agentPresets={[]}
        planningPresets={[]}
      />
    );

    rerender(
      <SprintComposer
        {...defaultProps}
        agentPresets={[]}
        planningPresets={[]}
        defaultPlanningAgentPresetId="planner-1"
        defaultAgentRoutingMode="MANUAL"
        defaultWorkerAgentPresetId="worker-1"
      />
    );

    rerender(
      <SprintComposer
        {...defaultProps}
        agentPresets={agentPresets as any}
        planningPresets={agentPresets as any}
        defaultPlanningAgentPresetId="planner-1"
        defaultAgentRoutingMode="MANUAL"
        defaultWorkerAgentPresetId="worker-1"
      />
    );

    await waitFor(() => {
      expect(getAllByText("Test Planning Agent").length).toBeGreaterThan(0);
      expect(getAllByText("Test Worker Agent").length).toBeGreaterThan(0);
    });
  });

  it("shows planning overlay on submit and allows dismiss without cancel", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    const mockOnSubmit = vi.fn(() => submitPromise);

    const { getByText, getByPlaceholderText, queryByText, getAllByText, queryByRole, queryAllByText } = render(
      <SprintComposer {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();

    // Dismiss overlay via keyboard
    fireEvent.keyDown(window, { key: "Escape" });

    // Overlay should disappear
    await waitFor(() => {
      expect(queryByText("Planning in motion")).not.toBeInTheDocument();
    });
    expect(queryByRole("button", { name: "Minimize" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "New Sprint" })).toBeInTheDocument();
    expect(queryByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(queryAllByText("Cancel Active Request")).toHaveLength(0);

    // We didn't cancel, so we can now resolve the submit to finish
    resolveSubmit!(undefined);
  });

  it("announces submit pending state without clearing stale form content", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const mockOnSubmit = vi.fn(() => submitPromise);
    const mockOnClose = vi.fn();

    const { getByPlaceholderText, getAllByText, getByRole, getByText } = render(
      <SprintComposer {...defaultProps} onSubmit={mockOnSubmit} onClose={mockOnClose} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening") as HTMLInputElement;
    const promptInput = getByPlaceholderText("Describe the outcome, affected systems, and what done looks like when this sprint lands.") as HTMLTextAreaElement;
    fireEvent.input(nameInput, { target: { value: "Pending Sprint" } });
    fireEvent.input(promptInput, { target: { value: "Keep this prompt visible during planning." } });

    const submitBtn = getAllByText("Plan & Start").pop()!;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(getByText(/Plan & Start request started/i)).toBeInTheDocument();
    });

    expect(nameInput.value).toBe("Pending Sprint");
    expect(promptInput.value).toBe("Keep this prompt visible during planning.");
    expect(getByRole("form", { name: /sprint composer/i })).toHaveAttribute("aria-busy", "true");
    expect(submitBtn.closest("button")).toBeDisabled();
    expect(mockOnClose).not.toHaveBeenCalled();

    resolveSubmit!(undefined);
  });

  it("shows prompt improvement pending feedback and retry after failure", async () => {
    let rejectImprove: (error: Error) => void;
    const improvePromise = new Promise<string>((_, reject) => {
      rejectImprove = reject;
    });
    const onImprovePrompt = vi.fn(() => improvePromise);

    const { getByPlaceholderText, getByRole, getByText } = render(
      <SprintComposer {...defaultProps} onImprovePrompt={onImprovePrompt} />
    );

    fireEvent.input(getByPlaceholderText("Runtime hardening"), { target: { value: "Improve Prompt" } });
    fireEvent.input(getByPlaceholderText("Describe the outcome, affected systems, and what done looks like when this sprint lands."), {
      target: { value: "Make this implementation-ready." },
    });

    fireEvent.click(getByRole("button", { name: /plan ahead with ai/i }));

    await waitFor(() => {
      expect(getByText(/Prompt improvement started/i)).toBeInTheDocument();
    });
    expect(getByRole("button", { name: /refining prompt/i })).toBeDisabled();

    rejectImprove!(new Error("planner offline"));

    await waitFor(() => {
      expect(getByRole("button", { name: /retry improve/i })).toBeInTheDocument();
    });
    expect(within(document.body).getAllByRole("alert")[0]).toHaveTextContent(/Prompt improvement failed: planner offline/i);
    expect(getByRole("button", { name: /retry improve/i })).toBeInTheDocument();
  });

  it("moves focus to the first invalid required field", async () => {
    const onImprovePrompt = vi.fn();
    const { getByPlaceholderText, getByRole, getAllByText } = render(
      <SprintComposer {...defaultProps} onImprovePrompt={onImprovePrompt} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    const promptInput = getByPlaceholderText("Describe the outcome, affected systems, and what done looks like when this sprint lands.");

    fireEvent.click(getAllByText("Plan & Start").pop()!);
    await waitFor(() => {
      expect(document.activeElement).toBe(nameInput);
    });

    fireEvent.click(getByRole("button", { name: /plan ahead with ai/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(nameInput);
    });

    fireEvent.input(nameInput, { target: { value: "Needs Prompt" } });
    fireEvent.click(getByRole("button", { name: /plan ahead with ai/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(promptInput);
    });
    expect(onImprovePrompt).not.toHaveBeenCalled();
  });

  it("shows planning overlay and cancels through explicit request cancellation", async () => {
    const mockOnCancelPlanningRequest = vi.fn();
    const mockOnSubmit = vi.fn(async () => new Promise(() => undefined));

    const { getByText, getByPlaceholderText, queryByText, getAllByText, getByRole } = render(
      <SprintComposer {...defaultProps} onSubmit={mockOnSubmit} onCancelPlanningRequest={mockOnCancelPlanningRequest} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: /turn planning vessel into a coffee break reminder/i }));
    expect(getByText("Coffee break unlocked. Grab a fresh cup while planning keeps moving.")).toBeInTheDocument();

    // Click Cancel Active Request through the overlay specifically.
    const cancelBtns = getAllByText("Cancel Active Request");
    // Click the one inside the overlay
    fireEvent.click(cancelBtns[0]!);

    expect(mockOnCancelPlanningRequest).toHaveBeenCalledTimes(1);
    expect(mockOnCancelPlanningRequest.mock.calls[0]?.[0]).toEqual(expect.any(String));
    expect(getByText(/Planning request cancelled/i)).toBeInTheDocument();

    // Overlay should disappear because state resets when not busy
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("Generating subtasks...");
    });
  });

  it("shows New Sprint secondary action and opens a fresh composer without cancelling", async () => {
    let resolveFirstSubmit: (val: any) => void;
    let resolveSecondSubmit: (val: any) => void;
    const firstSubmitPromise = new Promise((resolve) => {
      resolveFirstSubmit = resolve;
    });
    const secondSubmitPromise = new Promise((resolve) => {
      resolveSecondSubmit = resolve;
    });

    const mockOnSubmit = vi
      .fn()
      .mockReturnValueOnce(firstSubmitPromise)
      .mockReturnValueOnce(secondSubmitPromise);
    const mockOnCancelPlanningRequest = vi.fn();
    const mockOnStartNewSprint = vi.fn();
    const mockOnClose = vi.fn();

    const { getByText, getByPlaceholderText, getAllByText, getByRole } = render(
      <SprintComposer
        {...defaultProps}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        onCancelPlanningRequest={mockOnCancelPlanningRequest}
        onStartNewSprint={mockOnStartNewSprint}
      />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();
    const firstSignal = mockOnSubmit.mock.calls[0]?.[0]?.signal as AbortSignal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);

    fireEvent.click(getByRole("button", { name: /turn planning vessel into a coffee break reminder/i }));
    expect(getByText("Coffee break unlocked. Grab a fresh cup while planning keeps moving.")).toBeInTheDocument();

    // Click New Sprint
    const newSprintBtn = getByText("New Sprint");
    fireEvent.click(newSprintBtn);

    expect(mockOnStartNewSprint).toHaveBeenCalled();
    expect(mockOnCancelPlanningRequest).not.toHaveBeenCalled();
    expect(firstSignal.aborted).toBe(false);
    expect((nameInput as HTMLInputElement).value).toBe("");
    fireEvent.input(nameInput, { target: { value: "Follow-up Sprint" } });
    const secondSubmitBtn = getAllByText("Plan & Start").pop()!;
    expect(secondSubmitBtn).not.toBeDisabled();
    fireEvent.click(secondSubmitBtn);
    expect(mockOnSubmit).toHaveBeenCalledTimes(2);

    resolveFirstSubmit!(undefined);
    await Promise.resolve();
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(secondSubmitBtn).toBeDisabled();

    resolveSecondSubmit!(undefined);
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });
});

import { AddTaskModal } from "../../../dashboard/src/v2/components/ui/AddTaskModal.js";

describe("AddTaskModal Lifecycle", () => {
  const defaultProps = {
    sprints: [{ id: "SPR-1", name: "Test Sprint", status: "planning", order: 0 }],
    availableTasks: [],
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    cleanup();
  });

  it("returns focus to trigger upon modal close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open Modal";
    document.body.appendChild(trigger);
    trigger.focus();

    const { getByLabelText, unmount } = render(
      <AddTaskModal {...defaultProps} />
    );

    const closeBtn = getByLabelText("Close dialog");
    fireEvent.click(closeBtn);

    // useFocusTrap sets the timeout to focus the previous active element.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    unmount();
    trigger.remove();
  });

  it("disables cancel and close buttons during pending submit", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const mockOnSubmit = vi.fn(() => submitPromise);

    const { getByLabelText, getByRole, getByText } = render(
      <AddTaskModal {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const sprintSelect = getByLabelText(/Sprint/i);
    const titleInput = getByLabelText(/Title/i);

    fireEvent.input(sprintSelect, { target: { value: "SPR-1" } });
    fireEvent.input(titleInput, { target: { value: "A valid title" } });

    const submitButton = getByRole("button", { name: "Create Task" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });

    const closeBtn = getByLabelText("Close dialog");
    const cancelBtn = getByText("Cancel");

    expect(closeBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-disabled", "true");

    resolveSubmit!(undefined);
  });

  it("displays error in ActionFeedbackRegion without auto dismiss, and handles dismiss", async () => {
    const mockOnSubmit = vi.fn(() => Promise.reject(new Error("API Error 500")));

    const { getByLabelText, getByRole, getByText, queryByText, queryByRole } = render(
      <AddTaskModal {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const sprintSelect = getByLabelText(/Sprint/i);
    const titleInput = getByLabelText(/Title/i);

    fireEvent.input(sprintSelect, { target: { value: "SPR-1" } });
    fireEvent.input(titleInput, { target: { value: "A valid title" } });

    const submitButton = getByRole("button", { name: "Create Task" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(getByText("API Error 500")).toBeInTheDocument();
    });

    const errorRegion = getByText("Failed");
    expect(errorRegion).toBeInTheDocument();

    const dismissBtn = getByRole("button", { name: "Clear error" });

    // Explicitly focus it to ensure focus behavior is correctly represented
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(queryByText("API Error 500")).not.toBeInTheDocument();
      // focus placement after error recovery: activeElement should not be a dead reference
      expect(document.activeElement).not.toBe(dismissBtn);
    });
  });
});
