/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/preact";
import gsap from "gsap";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((_target: unknown, vars?: { onComplete?: () => void }) => {
      vars?.onComplete?.();
    }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  },
}));

vi.mock("../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: vi.fn(() => ({ execution: { connections: [] } })),
}));

import { QuicksprintPanel } from "../../../dashboard/src/v2/components/quicksprint/QuicksprintPanel.js";

describe("QuicksprintPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(Date.now());
      return 0;
    };
    const cancelAnimationFrame = () => undefined;

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: requestAnimationFrame,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: cancelAnimationFrame,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: requestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: cancelAnimationFrame,
    });
  });

  const fullstackPurpose = {
    purpose: "fullstack-js-app",
    purposeLabel: "Fullstack JS App",
    purposeDescription: "Default Quicksprint templates for JavaScript and TypeScript products spanning frontend, backend, data, and UX surfaces.",
  };

  const pythonPurpose = {
    purpose: "python-service",
    purposeLabel: "Python Service",
    purposeDescription: "Purpose set for backend-heavy Python services.",
  };

  const mockTemplates = [
    ...Array.from({ length: 13 }, (_, index) => ({
      id: `tpl-${index + 1}`,
      name: index === 0 ? "API Tests" : `Default Template ${index + 1}`,
      description: `Generate template ${index + 1}`,
      icon: index % 2 === 0 ? "Zap" : "Sparkles",
      category: index % 2 === 0 ? "testing" : "engineering",
      categoryColor: index % 2 === 0 ? "#ef4444" : "#22c55e",
      agentInstructionMarkdown: "Write tests",
      defaultTaskCount: 5,
      isBuiltIn: true,
      agentPresetId: undefined,
      ...fullstackPurpose,
    })),
    {
      id: "tpl-python",
      name: "Python Service Audit",
      description: "Audit a Python service",
      icon: "Sparkles",
      category: "engineering",
      categoryColor: "#22c55e",
      agentInstructionMarkdown: "Inspect a Python codebase",
      defaultTaskCount: 4,
      isBuiltIn: true,
      agentPresetId: undefined,
      ...pythonPurpose,
    },
    {
      id: "tpl-custom-1",
      name: "Custom Sprint Flow",
      description: "Reusable custom sprint flow",
      icon: "Zap",
      category: "custom",
      categoryColor: "#f59e0b",
      agentInstructionMarkdown: "Custom instructions",
      defaultTaskCount: 3,
      isBuiltIn: false,
      agentPresetId: undefined,
    },
    {
      id: "tpl-custom-2",
      name: "Custom Review Flow",
      description: "Custom review and QA flow",
      icon: "Compass",
      category: "custom",
      categoryColor: "#0ea5e9",
      agentInstructionMarkdown: "Custom review instructions",
      defaultTaskCount: 4,
      isBuiltIn: false,
      agentPresetId: undefined,
    },
  ];

  const defaultProps = {
    projectId: "proj-1",
    onClose: vi.fn(),
    onExecute: vi.fn(),
    templates: mockTemplates,
    loading: false,
    virtualProviders: [],
    agentPresets: [],
  };

  it("renders browse phase initially", () => {
    const { getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);
    expect(getByText("Launch A Quicksprint.")).toBeInTheDocument();
    expect(getByText("API Tests")).toBeInTheDocument();
    expect(queryByText("Python Service Audit")).not.toBeInTheDocument();
  });

  it("navigates to configure phase when template is selected", () => {
    const { getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);
    const templateCard = getByText("API Tests");
    fireEvent.click(templateCard);

    expect(queryByText("Launch A Quicksprint.")).not.toBeInTheDocument();
    expect(getByText("Configure Quicksprint")).toBeInTheDocument();
    expect(getByText("Plan & Start")).toBeInTheDocument();
    expect(getByText("API Tests selected. Configure the quicksprint before planning.", { selector: "p" })).toBeInTheDocument();
  });

  it("keeps template selection context and restores focus when returning to browse", async () => {
    const { getByRole, getByText } = render(<QuicksprintPanel {...defaultProps} />);

    fireEvent.click(getByText("API Tests"));

    const configureHeading = getByRole("heading", { name: "API Tests" });
    await waitFor(() => {
      expect(document.activeElement).toBe(configureHeading);
    });

    fireEvent.click(getByRole("button", { name: "Back to quicksprint templates" }));

    const browseHeading = await waitFor(() => getByRole("heading", { name: "Launch A Quicksprint." }));
    await waitFor(() => {
      expect(document.activeElement).toBe(browseHeading);
    });
    expect(getByRole("button", { name: "API Tests" })).toHaveAttribute("aria-pressed", "true");
    expect(getByText("Returned to templates. API Tests remains selected.", { selector: "p" })).toBeInTheDocument();
  });

  it("exposes stable prompt preview expansion semantics", () => {
    const { getByRole, getByText } = render(<QuicksprintPanel {...defaultProps} />);

    fireEvent.click(getByRole("button", { name: "API Tests" }));

    const toggle = getByRole("button", { name: "View Combined Prompt" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "quicksprint-combined-prompt-tpl-1");

    const promptRegion = getByRole("region", { name: "Combined quicksprint prompt" });
    expect(promptRegion).toHaveAttribute("id", "quicksprint-combined-prompt-tpl-1");
    expect(promptRegion).toHaveClass("max-h-0");
    expect(promptRegion).toHaveAttribute("data-motion-contract", "expansionCollapse");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(promptRegion).toHaveClass("max-h-[600px]");
    expect(promptRegion.textContent).toContain("Write tests");
    expect(getByText("Combined prompt preview expanded.", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(getByText("Combined prompt preview collapsed.", { selector: "p" })).toBeInTheDocument();
  });

  it("clamps oversized template defaults when the subtask slider loads", async () => {
    const mockOnExecute = vi.fn().mockResolvedValue(undefined);
    const oversizedTemplate = {
      ...mockTemplates[0],
      id: "tpl-oversized",
      name: "Oversized Template",
      defaultTaskCount: 100,
    };

    const { getByText, getByRole } = render(
      <QuicksprintPanel
        {...defaultProps}
        onExecute={mockOnExecute}
        templates={[oversizedTemplate]}
      />
    );

    fireEvent.click(getByText("Oversized Template"));

    const slider = getByRole("slider", { name: "Subtask count" });
    expect(slider).toHaveValue("30");
    expect(slider).toHaveAttribute("aria-valuetext", "30 subtasks");

    fireEvent.click(getByText("Plan Only"));

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalled();
    });
    expect(mockOnExecute.mock.calls[0]?.[1]).toBe(30);
  });

  it("supports unlimited subtasks and disables the slider interaction state", async () => {
    const mockOnExecute = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByRole, container } = render(
      <QuicksprintPanel {...defaultProps} onExecute={mockOnExecute} />
    );

    fireEvent.click(getByText("API Tests"));

    expect(getByText("30")).toBeInTheDocument();

    const noLimitToggle = getByRole("checkbox", { name: /no limit/i });
    expect(noLimitToggle).not.toBeChecked();

    fireEvent.click(noLimitToggle);

    expect(noLimitToggle).toBeChecked();
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();

    fireEvent.click(getByText("Plan & Start"));

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalled();
    });
    expect(mockOnExecute.mock.calls[0]?.[7]).toMatchObject({ noTaskLimit: true });
  });

  it("announces provider route and model override changes", async () => {
    const { getByText, queryByText } = render(
      <QuicksprintPanel
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

    fireEvent.click(getByText("API Tests"));

    expect(getByText("Default Route (Codex Primary)")).toBeInTheDocument();
    expect(getByText("Default Model (gpt-5.5)")).toBeInTheDocument();
    expect(document.body.querySelector('img[src="/lobe-icons/codex-color.svg"]')).toBeInTheDocument();
    expect(queryByText("Virtual Codex Worker")).not.toBeInTheDocument();

    fireEvent.click(getByText("Default Route (Codex Primary)"));
    await waitFor(() => {
      expect(getByText("Codex Primary")).toBeInTheDocument();
    });
    expect(document.body.querySelectorAll('img[src="/lobe-icons/codex-color.svg"]').length).toBeGreaterThan(1);

    fireEvent.click(getByText("Codex Primary"));

    await waitFor(() => {
      expect(getByText("Planning route changed to Codex Primary.", { selector: "p" })).toBeInTheDocument();
    });

    const modelTrigger = getByText("Default (gpt-5.5)");
    expect(modelTrigger).toBeInTheDocument();
    fireEvent.click(modelTrigger);
    await waitFor(() => {
      expect(getByText("gpt-5.4")).toBeInTheDocument();
    });
    fireEvent.click(getByText("gpt-5.4"));

    await waitFor(() => {
      expect(getByText("Model override changed to gpt-5.4.", { selector: "p" })).toBeInTheDocument();
    });
  });

  it("filters default templates by purpose", async () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    expect(getByText("API Tests")).toBeInTheDocument();
    expect(queryByText("Python Service Audit")).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Default template purpose" }));
    fireEvent.click(getByText("Python Service"));

    await waitFor(() => {
      expect(getByText("Python Service Audit")).toBeInTheDocument();
    });
    expect(queryByText("API Tests")).not.toBeInTheDocument();
    expect(getByText("Default template purpose changed to Python Service.", { selector: "p" })).toBeInTheDocument();
  });

  it("renders the large default template catalog in an accessible scroll rail", () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    const templateRail = getByRole("region", { name: "quicksprint templates" });
    expect(templateRail).toBeInTheDocument();
    expect(templateRail).toHaveAttribute("tabindex", "0");
    expect(templateRail).not.toHaveClass("touch-pan-x");
    expect(templateRail).toHaveClass("touch-auto");
    expect(templateRail).toHaveClass("overscroll-x-contain");

    const scrollLeft = getByRole("button", { name: "Scroll quicksprint templates left" });
    const scrollRight = getByRole("button", { name: "Scroll quicksprint templates right" });
    expect(scrollLeft).toBeDisabled();
    expect(scrollRight).not.toBeDisabled();

    expect(within(templateRail).getByRole("button", { name: "API Tests" })).toBeInTheDocument();
    for (let index = 2; index <= 13; index += 1) {
      expect(within(templateRail).getByRole("button", { name: `Default Template ${index}` })).toBeInTheDocument();
    }
    expect(within(templateRail).getByRole("button", { name: "Custom Sprint Flow" })).toBeInTheDocument();
    expect(within(templateRail).getByRole("button", { name: "Custom Review Flow" })).toBeInTheDocument();

    fireEvent.click(within(templateRail).getByRole("button", { name: "Default Template 13" }));

    expect(queryByText("Launch A Quicksprint.")).not.toBeInTheDocument();
    expect(getByText("Configure Quicksprint")).toBeInTheDocument();
  });

  it("scrolls the template rail without triggering template selection", () => {
    const { container, getByRole, queryByText } = render(<QuicksprintPanel {...defaultProps} />);
    const builtinRail = container.querySelector('[data-qs-template-rail="quicksprint-template-rail"]') as HTMLDivElement;
    const scrollBy = vi.fn();
    Object.defineProperty(builtinRail, "scrollBy", {
      value: scrollBy,
      configurable: true,
    });

    fireEvent.click(getByRole("button", { name: "Scroll quicksprint templates right" }));

    expect(scrollBy).toHaveBeenCalled();
    expect(queryByText("Configure Quicksprint")).not.toBeInTheDocument();
  });

  it("passes vertical wheel gestures over the template rail to the page scroller", () => {
    const { getByRole } = render(<QuicksprintPanel {...defaultProps} />);
    const templateRail = getByRole("region", { name: "quicksprint templates" });
    const pageScroller = document.scrollingElement as HTMLElement;
    Object.defineProperty(pageScroller, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(pageScroller, "clientHeight", { value: 480, configurable: true });
    pageScroller.scrollTop = 100;

    fireEvent.wheel(templateRail, { deltaY: 96, deltaX: 0, deltaMode: 0 });
    expect(pageScroller.scrollTop).toBe(196);

    fireEvent.wheel(templateRail, { deltaY: 0, deltaX: 96, deltaMode: 0 });
    expect(pageScroller.scrollTop).toBe(196);
  });

  it("renders custom templates in the shared rail with edit and selection affordances", async () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    const templateRail = getByRole("region", { name: "quicksprint templates" });
    expect(templateRail).toBeInTheDocument();

    expect(within(templateRail).getByRole("button", { name: "Custom Sprint Flow" })).toBeInTheDocument();
    expect(within(templateRail).getByRole("button", { name: "Custom Review Flow" })).toBeInTheDocument();

    const editCustomSprint = within(templateRail).getByRole("button", { name: "Edit Custom Sprint Flow template" });
    expect(editCustomSprint).toHaveAttribute("title", "Edit template");

    fireEvent.click(editCustomSprint);

    await waitFor(() => {
      expect(getByText("Edit Template")).toBeInTheDocument();
    });
    expect(queryByText("Configure Quicksprint")).not.toBeInTheDocument();
    expect(queryByText("New Template")).not.toBeInTheDocument();
  });

  it("skips the empty default rail when a project only has custom quicksprint templates", () => {
    const customOnlyTemplates = mockTemplates.filter((template) => !template.isBuiltIn);
    const { getByRole, getByText, queryByRole, queryByText } = render(
      <QuicksprintPanel {...defaultProps} templates={customOnlyTemplates} />
    );

    expect(queryByText("Default Templates")).not.toBeInTheDocument();
    expect(queryByRole("region", { name: "default templates" })).not.toBeInTheDocument();
    expect(queryByRole("region", { name: "custom templates" })).not.toBeInTheDocument();

    const templateRail = getByRole("region", { name: "quicksprint templates" });
    expect(templateRail).toBeInTheDocument();
    expect(getByText("Custom Sprint Flow")).toBeInTheDocument();
    expect(getByText("Custom Review Flow")).toBeInTheDocument();
  });

  it("selects custom templates from the rail", () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    fireEvent.click(within(getByRole("region", { name: "quicksprint templates" })).getByRole("button", { name: "Custom Review Flow" }));

    expect(queryByText("Launch A Quicksprint.")).not.toBeInTheDocument();
    expect(getByText("Configure Quicksprint")).toBeInTheDocument();
  });

  it("preserves the empty template browse path", () => {
    const { getByRole, getByText, queryByRole } = render(
      <QuicksprintPanel {...defaultProps} templates={[]} />
    );

    expect(queryByRole("region", { name: "quicksprint templates" })).not.toBeInTheDocument();
    expect(getByText("Create your first custom template")).toBeInTheDocument();
    expect(getByRole("button", { name: "New Template" })).toBeInTheDocument();
  });

  it("confirms destructive template deletion with the shared dialog", async () => {
    vi.useFakeTimers();
    const onDeleteTemplate = vi.fn().mockResolvedValue(undefined);
    const { getByRole, getByText, queryByRole } = render(
      <QuicksprintPanel {...defaultProps} onDeleteTemplate={onDeleteTemplate} />
    );
    const templateRail = getByRole("region", { name: "quicksprint templates" });

    fireEvent.click(within(templateRail).getByRole("button", { name: "Delete Custom Sprint Flow template" }));

    expect(getByRole("dialog", { name: "Delete Custom Sprint Flow?" })).toBeInTheDocument();
    expect(getByText("Delete Custom Sprint Flow from this project's custom templates.")).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(queryByRole("dialog", { name: "Delete Custom Sprint Flow?" })).not.toBeInTheDocument();
    });
    expect(onDeleteTemplate).not.toHaveBeenCalled();

    fireEvent.click(within(templateRail).getByRole("button", { name: "Delete API Tests template" }));
    expect(getByRole("dialog", { name: "Delete API Tests?" })).toBeInTheDocument();
    expect(getByText("Delete API Tests from this project by hiding the default template. The shared bundled template remains available outside this project.")).toBeInTheDocument();

    const confirmButton = getByRole("button", { name: "Hold to Delete API Tests" });
    fireEvent.pointerDown(confirmButton, { button: 0, pointerId: 1 });
    vi.advanceTimersByTime(1000);
    await waitFor(() => {
      expect(onDeleteTemplate).toHaveBeenCalledWith("tpl-1");
    });
    await waitFor(() => {
      expect(queryByRole("dialog", { name: "Delete API Tests?" })).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(within(templateRail).getByRole("button", { name: "Delete API Tests template" }));
    expect(window.confirm).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows planning overlay on execute and allows dismiss", async () => {
    let resolveExecute: () => void;
    const executePromise = new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
    const mockOnExecute = vi.fn(() => executePromise);

    const { getByText, queryByText, queryByRole, queryAllByText } = render(
      <QuicksprintPanel {...defaultProps} onExecute={mockOnExecute} />
    );

    const templateCard = getByText("API Tests");
    fireEvent.click(templateCard);

    const execBtn = getByText("Plan & Start");
    fireEvent.click(execBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(getByText("Quicksprint in motion")).toBeInTheDocument();
    });

    expect(mockOnExecute).toHaveBeenCalled();

    // Dismiss overlay
    const closeBtn = getByText("Minimize");
    fireEvent.click(closeBtn);

    // Overlay should disappear
    await waitFor(() => {
      expect(queryByText("Quicksprint in motion")).not.toBeInTheDocument();
    });
    expect(queryByRole("button", { name: "Minimize" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "New Quicksprint" })).toBeInTheDocument();
    expect(queryByRole("button", { name: "Cancel Request" })).toBeInTheDocument();
    expect(queryAllByText("Cancel Active Request")).toHaveLength(0);

    // We didn't cancel, so we can now resolve the execution
    resolveExecute!();
  });

  it("blocks duplicate planning submissions and announces cancellation", async () => {
    let capturedSignal: AbortSignal | null = null;
    const executePromise = new Promise<void>(() => undefined);
    const mockOnExecute = vi.fn((_templateId, _taskCount, _mode, _prompt, _route, _model, signal: AbortSignal) => {
      capturedSignal = signal;
      return executePromise;
    });

    const { getByRole, getByText, queryByText } = render(
      <QuicksprintPanel {...defaultProps} onExecute={mockOnExecute} />
    );

    fireEvent.click(getByRole("button", { name: "API Tests" }));
    const planOnlyButton = getByRole("button", { name: "Plan Only" });
    fireEvent.click(planOnlyButton);
    fireEvent.click(planOnlyButton);

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalledTimes(1);
    });

    expect(getByRole("button", { name: "Plan & Start" })).toBeDisabled();
    expect(getByRole("button", { name: "Plan Only" })).toBeDisabled();
    expect(getByRole("button", { name: "Plan Only" })).toHaveAttribute("aria-describedby", "quicksprint-submit-blocked-tpl-1");
    expect(getByText("A quicksprint planning request is already running. Cancel it or wait for it to finish before submitting again.")).toBeInTheDocument();
    expect(getByRole("button", { name: "Back to quicksprint templates" })).toBeDisabled();
    expect(getByRole("textbox")).toBeDisabled();
    expect(getByRole("checkbox", { name: /no limit/i })).toBeDisabled();
    expect(getByText("Planning only")).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel Quicksprint Request" })).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Cancel Request" }));

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
    expect(getByText("Cancelled plan only request for API Tests.", { selector: "p" })).toBeInTheDocument();
    expect(queryByText("Planning only")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(getByRole("heading", { name: "API Tests" }));
  });

  it("opens tokenized reduced-motion-safe template pickers with accessible options", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { getByRole, queryByRole } = render(<QuicksprintPanel {...defaultProps} />);
    const templateRail = getByRole("region", { name: "quicksprint templates" });

    fireEvent.click(within(templateRail).getByRole("button", { name: "Edit Custom Sprint Flow template" }));

    const iconTrigger = await waitFor(() => getByRole("button", { name: "Pick template icon, current icon Zap" }));
    fireEvent.click(iconTrigger);

    const iconDialog = getByRole("dialog", { name: "Icon picker" });
    expect(iconDialog).toHaveStyle({ "--qs-picker-enter-duration": "0ms" });
    expect(iconDialog.getAttribute("style")).not.toContain("qs-picker-in");

    const zapOption = getByRole("button", { name: "Use Zap icon" });
    expect(zapOption).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(queryByRole("dialog", { name: "Icon picker" })).not.toBeInTheDocument();
    });

    const colorTrigger = getByRole("button", { name: "Pick template tag color, current color #f59e0b" });
    fireEvent.click(colorTrigger);

    const colorDialog = getByRole("dialog", { name: "Color picker" });
    expect(colorDialog).toHaveStyle({ "--qs-picker-enter-duration": "0ms" });
    expect(getByRole("button", { name: "Use amber tag color" })).toHaveAttribute("aria-pressed", "false");

    const colorBackdrop = Array.from(document.querySelectorAll('div[aria-hidden="true"]')).find((element) =>
      element.className.includes("z-[9998]"),
    );
    expect(colorBackdrop).toBeDefined();
    fireEvent.click(colorBackdrop!);
    await waitFor(() => {
      expect(queryByRole("dialog", { name: "Color picker" })).not.toBeInTheDocument();
    });
  });

  it("renders phase animation through reduced-motion-safe tokens", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<QuicksprintPanel {...defaultProps} />);

    const gsapCalls = vi.mocked(gsap.fromTo).mock.calls;
    expect(gsapCalls.some((call) => {
      const tweenVars = call[2] as { duration?: number };
      return tweenVars.duration === 0;
    })).toBe(true);
    const panel = document.querySelector("section");
    expect(panel).toHaveStyle({
      "--interaction-list-reveal-duration": "0ms",
      "--interaction-expansion-collapse-duration": "0ms",
    });
  });

  it("opens a fresh quicksprint without cancelling the previous planning request", async () => {
    let resolveFirstExecute: () => void;
    let resolveSecondExecute: () => void;
    const firstExecutePromise = new Promise<void>((resolve) => {
      resolveFirstExecute = resolve;
    });
    const secondExecutePromise = new Promise<void>((resolve) => {
      resolveSecondExecute = resolve;
    });
    const mockOnExecute = vi
      .fn()
      .mockReturnValueOnce(firstExecutePromise)
      .mockReturnValueOnce(secondExecutePromise);
    const mockOnClose = vi.fn();

    const { getByText } = render(
      <QuicksprintPanel {...defaultProps} onExecute={mockOnExecute} onClose={mockOnClose} />
    );

    fireEvent.click(getByText("API Tests"));
    const firstSubmitButton = getByText("Plan & Start");
    fireEvent.click(firstSubmitButton);

    await waitFor(() => {
      expect(getByText("Quicksprint in motion")).toBeInTheDocument();
    });
    const firstSignal = mockOnExecute.mock.calls[0]?.[6] as AbortSignal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);

    const planningDialog = getByText("Quicksprint in motion").closest("[role='dialog']");
    expect(planningDialog).toBeInTheDocument();
    fireEvent.click(within(planningDialog as HTMLElement).getByText("New Quicksprint"));

    expect(firstSignal.aborted).toBe(false);
    expect(getByText("Opened a new quicksprint while the previous plan and start request continues in the background.", { selector: "p" })).toBeInTheDocument();
    expect(getByText("Launch A Quicksprint.")).toBeInTheDocument();

    fireEvent.click(getByText("API Tests"));
    const secondSubmitButton = getByText("Plan & Start");
    expect(secondSubmitButton).not.toBeDisabled();
    fireEvent.click(secondSubmitButton);

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalledTimes(2);
    });

    resolveFirstExecute!();
    await Promise.resolve();
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(secondSubmitButton).toBeDisabled();

    resolveSecondExecute!();
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });
});
