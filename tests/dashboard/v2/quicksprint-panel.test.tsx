/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
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

  const mockTemplates = [
    {
      id: "tpl-1",
      name: "API Tests",
      description: "Generate API tests",
      icon: "Zap",
      category: "testing",
      categoryColor: "#ef4444",
      agentInstructionMarkdown: "Write tests",
      defaultTaskCount: 5,
      isBuiltIn: true,
      agentPresetId: undefined,
      purpose: "fullstack-js-app",
      purposeLabel: "Fullstack JS App",
      purposeDescription: "Default Quicksprint templates for JavaScript and TypeScript products spanning frontend, backend, data, and UX surfaces.",
    },
    {
      id: "tpl-2",
      name: "Python Service Audit",
      description: "Audit a Python service",
      icon: "Sparkles",
      category: "engineering",
      categoryColor: "#22c55e",
      agentInstructionMarkdown: "Inspect a Python codebase",
      defaultTaskCount: 4,
      isBuiltIn: true,
      agentPresetId: undefined,
      purpose: "python-service",
      purposeLabel: "Python Service",
      purposeDescription: "Purpose set for backend-heavy Python services.",
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
});
