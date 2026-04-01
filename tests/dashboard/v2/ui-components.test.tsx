/** @vitest-environment jsdom */
import * as React from "preact/compat";
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { PlanningProgressOverlay } from "../../../dashboard/src/v2/components/ui/PlanningProgressOverlay.js";
import { ListSkeleton, StatCardSkeleton, ChatMessageSkeleton } from "../../../dashboard/src/v2/components/ui/ListSkeletons.js";
import { AvantgardeSelect } from "../../../dashboard/src/v2/components/ui/AvantgardeSelect.js";
import { SprintComposer } from "../../../dashboard/src/v2/components/ui/SprintComposer.js";
import { ExecutionTimelineProvider } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";

vi.mock("../../../dashboard/src/v2/lib/sprint-composer-state.js", () => ({
  useSprintComposerState: vi.fn(() => ({
    name: "Test Sprint",
    goal: "Test Goal",
    setName: vi.fn(),
    setGoal: vi.fn(),
    submitMode: "plan_and_start",
    setSubmitMode: vi.fn(),
    availableModes: [{ id: "plan_and_start", label: "Plan & Start", icon: () => null, description: "desc" }],
    routeOverride: null,
    setRouteOverride: vi.fn(),
    modelOverride: null,
    setModelOverride: vi.fn(),
    planningAgentPresetId: null,
    setPlanningAgentPresetId: vi.fn(),
    isEditing: false,
    hasTasks: false,
  })),
  toPlanningOverrides: vi.fn(),
  resolveSubmitOriginalPrompt: vi.fn(),
}));

describe("UI Components Coverage", () => {
  it("renders PlanningProgressOverlay in various states", () => {
    const feedback = { shipType: "container" as const, shipProgress: 0.5, text: "Test Message" };
    const { rerender } = render(
      <PlanningProgressOverlay 
        isBusy={false} 
        feedback={null} 
        planningEta={10000} 
        elapsedMs={0} 
        isDark={false} 
        actionType="plan_only" 
        onDismiss={() => {}} 
      />
    );
    expect(document.body.textContent).not.toContain("Test Message");

    rerender(
      <PlanningProgressOverlay 
        isBusy={true} 
        feedback={feedback} 
        planningEta={60000} 
        elapsedMs={1000} 
        isDark={false} 
        actionType="plan_only" 
        onDismiss={() => {}} 
      />
    );
    expect(document.body.textContent).toContain("Test Message");
    expect(document.body.textContent).toContain("Planning in motion");

    rerender(
      <PlanningProgressOverlay 
        isBusy={true} 
        feedback={{ ...feedback, shipType: "wooden" }} 
        planningEta={60000} 
        elapsedMs={1000} 
        isDark={true} 
        actionType="improve" 
        themeAccent="ember"
        onCancel={() => {}}
        onDismiss={() => {}} 
      />
    );
    expect(document.body.textContent).toContain("The Planning agent is researching your codebase");

    rerender(
      <PlanningProgressOverlay 
        isBusy={true} 
        feedback={feedback} 
        planningEta={60000} 
        elapsedMs={1000} 
        isDark={false} 
        actionType="quicksprint" 
        onDismiss={() => {}} 
      />
    );
    expect(document.body.textContent).toContain("Quicksprint in motion");
  });

  it("handles keyboard opening in AvantgardeSelect", () => {
    const options = [{ value: "1", label: "Opt 1" }];
    render(<AvantgardeSelect value="1" onChange={() => {}} options={options} />);
    const trigger = screen.getByText("Opt 1").closest("button")!;
    
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("renders SprintComposer", () => {
    const mockExecution = { connections: [], invocations: [], activeInvocationId: null };
    render(
      <ExecutionTimelineProvider execution={mockExecution as any}>
        <SprintComposer 
          nextId="SPR-1" 
          virtualProviders={[]} 
          planningPresets={[]} 
          planningEta={60000} 
          onClose={() => {}} 
          onSubmit={async () => {}} 
        />
      </ExecutionTimelineProvider>
    );
    expect(screen.getByText("Sprint Composer")).toBeDefined();
  });

  it("renders Skeletons", () => {
    render(<ListSkeleton count={3} />);
    render(<StatCardSkeleton />);
    render(<ChatMessageSkeleton />);
  });
});
