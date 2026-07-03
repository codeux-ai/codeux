/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/preact";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
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

  it("renders provider instance route labels, default models, and brand icons", async () => {
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
  });

  it("renders the large default template catalog in an accessible scroll rail", () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    const defaultRail = getByRole("region", { name: "default templates" });
    expect(defaultRail).toBeInTheDocument();
    expect(defaultRail).toHaveAttribute("tabindex", "0");

    const scrollLeft = getByRole("button", { name: "Scroll default templates left" });
    const scrollRight = getByRole("button", { name: "Scroll default templates right" });
    expect(scrollLeft).toBeDisabled();
    expect(scrollRight).not.toBeDisabled();

    expect(within(defaultRail).getAllByRole("button")).toHaveLength(13);
    expect(within(defaultRail).getByRole("button", { name: "API Tests" })).toBeInTheDocument();
    for (let index = 2; index <= 13; index += 1) {
      expect(within(defaultRail).getByRole("button", { name: `Default Template ${index}` })).toBeInTheDocument();
    }

    fireEvent.click(within(defaultRail).getByRole("button", { name: "Default Template 13" }));

    expect(queryByText("Launch A Quicksprint.")).not.toBeInTheDocument();
    expect(getByText("Configure Quicksprint")).toBeInTheDocument();
  });

  it("scrolls the built-in rail without triggering template selection", () => {
    const { container, getByRole, queryByText } = render(<QuicksprintPanel {...defaultProps} />);
    const builtinRail = container.querySelector('[data-qs-template-rail="builtin-template-rail"]') as HTMLDivElement;
    const scrollBy = vi.fn();
    Object.defineProperty(builtinRail, "scrollBy", {
      value: scrollBy,
      configurable: true,
    });

    fireEvent.click(getByRole("button", { name: "Scroll default templates right" }));

    expect(scrollBy).toHaveBeenCalled();
    expect(queryByText("Configure Quicksprint")).not.toBeInTheDocument();
  });

  it("renders custom templates in an accessible rail with edit and selection affordances", async () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    const customRail = getByRole("region", { name: "custom templates" });
    expect(customRail).toBeInTheDocument();

    expect(getByRole("button", { name: "Scroll custom templates left" })).toBeDisabled();
    expect(getByRole("button", { name: "Scroll custom templates right" })).toBeDisabled();
    expect(within(customRail).getByRole("button", { name: "Custom Sprint Flow" })).toBeInTheDocument();
    expect(within(customRail).getByRole("button", { name: "Custom Review Flow" })).toBeInTheDocument();

    const editCustomSprint = within(customRail).getByRole("button", { name: "Edit Custom Sprint Flow template" });
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

    const customRail = getByRole("region", { name: "custom templates" });
    expect(customRail).toBeInTheDocument();
    expect(getByText("Custom Sprint Flow")).toBeInTheDocument();
    expect(getByText("Custom Review Flow")).toBeInTheDocument();
  });

  it("selects custom templates from the rail", () => {
    const { getByRole, getByText, queryByText } = render(<QuicksprintPanel {...defaultProps} />);

    fireEvent.click(within(getByRole("region", { name: "custom templates" })).getByRole("button", { name: "Custom Review Flow" }));

    expect(queryByText("Launch A Quicksprint.")).not.toBeInTheDocument();
    expect(getByText("Configure Quicksprint")).toBeInTheDocument();
  });

  it("preserves the empty custom template browse path", () => {
    const { getByRole, getByText, queryByRole } = render(
      <QuicksprintPanel {...defaultProps} templates={mockTemplates.filter((template) => template.isBuiltIn)} />
    );

    expect(queryByRole("region", { name: "custom templates" })).not.toBeInTheDocument();
    expect(getByText("Create your first custom template")).toBeInTheDocument();
    expect(getByRole("button", { name: "New Template" })).toBeInTheDocument();
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
    expect(queryByRole("button", { name: "New Quicksprint" })).not.toBeInTheDocument();
    expect(queryAllByText("Cancel Active Request")).toHaveLength(0);

    // We didn't cancel, so we can now resolve the execution
    resolveExecute!();
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

    fireEvent.click(getByText("New Quicksprint"));

    expect(firstSignal.aborted).toBe(false);
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
