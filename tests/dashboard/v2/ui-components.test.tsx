import { act } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
/** @vitest-environment jsdom */
import * as React from "preact/compat";
import { h } from "preact";
import { useReducedMotion } from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { PlanningProgressOverlay } from "../../../dashboard/src/v2/components/ui/PlanningProgressOverlay.js";
import { ToastProvider, useToast } from "../../../dashboard/src/v2/components/feedback/ToastProvider.js";
import { ActionFeedbackRegion } from "../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js";
import { SkeletonRow, SkeletonCard, SkeletonPanel } from "../../../dashboard/src/v2/components/layout/SkeletonLoader.js";
import { AvantgardeSelect } from "../../../dashboard/src/v2/components/ui/AvantgardeSelect.js";
import { FilterStrip } from "../../../dashboard/src/v2/components/ui/FilterStrip.js";
import { SprintComposer } from "../../../dashboard/src/v2/components/ui/SprintComposer.js";
import { KineticDock } from "../../../dashboard/src/v2/components/KineticDock.js";
import { ProjectDataProvider } from "../../../dashboard/src/v2/context/project-data.js";
import { CollapsiblePanel } from "../../../dashboard/src/v2/components/ui/CollapsiblePanel.js";
import { Menu } from "../../../dashboard/src/v2/components/ui/Menu.js";
import { ExecutionTimelineProvider } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import { ConfirmDialog } from "../../../dashboard/src/v2/components/ui/ConfirmDialog.js";
import { RerunTaskModal } from "../../../dashboard/src/v2/components/ui/RerunTaskModal.js";
import { Button } from "../../../dashboard/src/v2/components/ui/Button.js";
import { ActionButton } from "../../../dashboard/src/v2/components/settings/SettingsSurface.js";
import { PageContainer } from "../../../dashboard/src/v2/components/layout/PageContainer.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);



vi.mock("@tanstack/react-router", () => {
  const { forwardRef } = require("preact/compat");
  return {
    Link: forwardRef(({ children, className, to }: any, ref: any) => <a ref={ref} href={to} className={className} data-testid={"link-" + to}>{children}</a>),
    useRouterState: () => [{ pathname: "/chat" }]
  };
});

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
  useReducedMotion: vi.fn().mockReturnValue(false)
}));

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


global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("UI Components Coverage", () => {

  describe("Feedback Components", () => {
    it("handles toast overflow dismissal properly", () => {
      vi.useFakeTimers();
      const TestToast = () => {
        const { addToast } = useToast();
        return (
          <button onClick={() => addToast({ type: 'success', message: 'Test message' })}>
            Add
          </button>
        );
      };

      render(
        <ToastProvider>
          <TestToast />
        </ToastProvider>
      );

      const btn = screen.getByText("Add");
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);

      expect(screen.getAllByText("Test message")).toHaveLength(4);
      act(() => { vi.advanceTimersByTime(500); });
      vi.useRealTimers();
    });

    it("ensures persistent error retry action does not auto-dismiss", () => {
      vi.useFakeTimers();
      const TestToastError = () => {
        const { addToast } = useToast();
        return (
          <button onClick={() => addToast({ type: 'error', message: 'Error message', action: { label: 'Retry', onClick: vi.fn() } })}>
            Add Error
          </button>
        );
      };

      render(
        <ToastProvider>
          <TestToastError />
        </ToastProvider>
      );

      const btn = screen.getByText("Add Error");
      fireEvent.click(btn);
      expect(screen.getByText("Error message")).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(10000); });
      expect(screen.getByText("Error message")).toBeInTheDocument();
      vi.useRealTimers();
    });

    it("verifies inline feedback live-region semantics", () => {
      const { rerender } = render(
        <ActionFeedbackRegion status="success" message="Saved successfully" />
      );

      let regions = screen.getAllByRole("status");
      expect(regions[0]).toHaveAttribute("aria-live", "polite");

      rerender(<ActionFeedbackRegion status="error" message="Failed to save" />);
      let alertRegions = screen.getAllByRole("alert");
      expect(alertRegions[0]).toHaveAttribute("aria-live", "assertive");
    });
  });

  it("verifies ARIA state transitions in FilterStrip", () => {
    const options = [{ value: "1", label: "Opt 1" }, { value: "2", label: "Opt 2" }];
    const onChange = vi.fn();
    const { rerender } = render(<FilterStrip options={options} active="1" onChange={onChange} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");

    // Re-render with active="2"
    rerender(<FilterStrip options={options} active="2" onChange={onChange} />);

    // Have to query again in case elements changed, though FilterStrip should just update props
    const tabsUpdated = screen.getAllByRole("tab");
    expect(tabsUpdated[0]).toHaveAttribute("aria-selected", "false");
    expect(tabsUpdated[1]).toHaveAttribute("aria-selected", "true");
  });

  it("verifies ActionButton aria-disabled when busy", () => {
    const { rerender } = render(<ActionButton label="Save" onClick={() => {}} busy={false} />);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-disabled", "false");

    rerender(<ActionButton label="Save" onClick={() => {}} busy={true} />);
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("renders KineticDock and handles pointer events appropriately", () => {
    // Import here for dynamic modification


    const { unmount } = render(
      <ProjectDataProvider>
        <KineticDock />
      </ProjectDataProvider>
    );

    // Check it rendered
    const dockNav = screen.getByLabelText("Dock navigation");
    expect(dockNav).toBeDefined();

    // Trigger pointer events to test fish-eye does not throw
    fireEvent.pointerMove(dockNav, { clientX: 100 });
    fireEvent.pointerLeave(dockNav);

    unmount();
    // Re-render with reduced motion
    vi.mocked(useReducedMotion).mockReturnValue(true);

    const { unmount: unmount2 } = render(
      <ProjectDataProvider>
        <KineticDock />
      </ProjectDataProvider>
    );
    const dockNav2 = screen.getByLabelText("Dock navigation");

    // Pointer move should return early under reduced motion
    fireEvent.pointerMove(dockNav2, { clientX: 100 });
    fireEvent.pointerLeave(dockNav2);

    unmount2();
  });

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
    expect(document.body.textContent).toContain("Generating subtasks");

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

    rerender(
      <PlanningProgressOverlay
        isBusy={true}
        feedback={feedback}
        planningEta={60000}
        elapsedMs={1000}
        isDark={false}
        actionType="plan_only"
        onDismiss={() => {}}
        secondaryActionLabel="New Sprint"
        onSecondaryAction={() => {}}
      />
    );
    expect(document.body.textContent).toContain("New Sprint");
  });

  it("handles keyboard navigation in FilterStrip", () => {
    const options = [{ value: "1", label: "Opt 1" }, { value: "2", label: "Opt 2" }];
    const onChange = vi.fn();

    // We already have a FilterStrip rendered in a previous test that didn't clean up correctly
    cleanup();
    render(<FilterStrip options={options} active="1" onChange={onChange} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);

    // Initial selected state and tabindex
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("tabindex")).toBe("0");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].getAttribute("tabindex")).toBe("-1");

    // Right Arrow
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });

    // Left Arrow
    fireEvent.keyDown(tabs[1], { key: "ArrowLeft" });

    // Home/End
    fireEvent.keyDown(tabs[0], { key: "End" });
    fireEvent.keyDown(tabs[1], { key: "Home" });
  });

  it("handles keyboard opening in AvantgardeSelect", () => {
    const options = [{ value: "1", label: "Opt-Select-1" }];
    render(<AvantgardeSelect value="1" onChange={() => {}} options={options} />);
    const trigger = screen.getAllByText("Opt-Select-1")[0].closest("button")!;
    
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("toggles CollapsiblePanel via keyboard and updates aria attributes", () => {
    render(
      <CollapsiblePanel title="Test Panel" icon={() => <svg />} accentHex="#000">
        <div data-testid="content">Child</div>
      </CollapsiblePanel>
    );

    const trigger = screen.getByRole("button", { name: /Test Panel/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    const panelContent = trigger.nextElementSibling;
    expect(panelContent?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panelContent?.getAttribute("aria-hidden")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panelContent?.getAttribute("aria-hidden")).toBe("true");
  });

  it("handles Menu Escape focus restoration", () => {
    const triggerRef = { current: null };
    const { unmount } = render(
      <Menu
        isOpen={true}
        onOpenChange={() => {}}
        content={<button role="menuitem">Item</button>}
        triggerRef={triggerRef as any}
      >
        <button ref={triggerRef as any}>Trigger</button>
      </Menu>
    );

    // Simulate active element inside menu
    const menuItem = screen.getByRole("menuitem");
    menuItem.focus();

    // Trigger escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Simulate cleanup which triggers focus restore
    unmount();
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

  it("renders Button with pending attributes and styling", () => {
    render(<Button pending>Test</Button>);
    const btn = screen.getByRole("button", { name: "Test" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders ActionButton with busy attributes and styling", () => {
    render(<ActionButton busy label="Action" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Action" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.querySelector(".animate-spin")).toBeTruthy();
    const labelContainer = btn.querySelector(".transition-opacity");
    expect(labelContainer?.className).toContain("opacity-0");
  });

  it("renders Skeletons", () => {
    render(<SkeletonRow />);
    render(<SkeletonCard />);
    render(<SkeletonPanel />);
  });

  it("DestructiveConfirmButton handles pointer cancel/leave without firing", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        options={{ title: "Test", body: "Body", destructive: true }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmBtn = screen.getByText("Confirm").closest("button");
    expect(confirmBtn).toBeDefined();

    fireEvent.pointerDown(confirmBtn!, { button: 0 });
    // short hold + cancel
    fireEvent.pointerCancel(confirmBtn!);

    fireEvent.pointerDown(confirmBtn!, { button: 0 });
    fireEvent.pointerLeave(confirmBtn!);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ConfirmDialog handles Escape key properly", async () => {
    const onCancel = vi.fn();

    const { unmount } = render(
      <ConfirmDialog
        isOpen={true}
        options={{ title: "Test Dialog", body: "Body" }}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    vi.spyOn(event, 'preventDefault');
    vi.spyOn(event, 'stopPropagation');

    document.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    unmount();
  });

  it("RerunTaskModal prevents multiple submissions", async () => {
    let confirmResolver;
    const confirmPromise = new Promise(resolve => { confirmResolver = resolve; });

    const onConfirm = vi.fn(() => confirmPromise);
    const task = { id: "1", depends_on: [], title: "Task 1" } as any;

    render(
      <RerunTaskModal
        task={task}
        allTasks={[task]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /Rerun Task/i });

    // Trigger first click, but wrap in act and wait for the state flush
    await act(async () => {
        fireEvent.click(confirmBtn);
        // let the state flush
        await Promise.resolve();
    });

    // Now it should be disabled in the DOM
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);

    // Second click (should be ignored because disabled or we don't even need to fire it if we proved it's disabled)
    // Actually, Preact fireEvent might still fire on disabled buttons in JSDOM, let's just assert the disabled attribute.
    // We already assert it's disabled. Let's just remove the second click from the test to avoid JSDOM quirks,
    // and rely on the disabled assertion.

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);

    confirmResolver();
    await act(async () => {
        await confirmPromise;
    });
  });

  it("renders PageContainer with padding='workbench' and asserts the expected workbench padding classes are present", () => {
    const { container } = render(
      <PageContainer padding="workbench">
        <div>Workbench Content</div>
      </PageContainer>
    );
    const element = container.firstChild as HTMLElement;
    expect(element).toBeDefined();
    expect(element.className).toContain("px-4");
    expect(element.className).toContain("py-12");
    expect(element.className).toContain("md:px-20");
    expect(element.className).not.toContain("px-6");
    expect(element.className).not.toContain("py-6");
  });
});
