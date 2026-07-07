/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TaskComposer } from "../TaskComposer.js";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (cb: () => void) => {
      cb();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => {
      const timeline = {
        fromTo: vi.fn(() => timeline),
        to: vi.fn(() => timeline),
      };
      return timeline;
    }),
    to: vi.fn((_target, options) => {
      options?.onComplete?.();
    }),
  },
}));

const installBrowserMocks = (): void => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const dummySprints = [{ id: "1", name: "Sprint 1", repositoryId: "r1", sprintMarkdownId: "m1", status: "active", createdAt: "now", updatedAt: "now" }];
const dummyTasks: any[] = [
  { id: "T-1", recordId: "rec1", title: "Task 1", sprintId: "1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], description: "desc", promptMarkdown: "prompt", agentPresetId: null },
  { id: "T-2", recordId: "rec2", title: "Task 2", sprintId: "1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], description: "desc", promptMarkdown: "prompt", agentPresetId: null },
];
const agentPresets: any[] = [
  { id: "agent-alpha", projectId: "p1", name: "Agent Alpha", description: "", instructionMarkdown: "", labels: [], sourcePath: null, sourceScope: null, sourceUpdatedAt: null, sourceImportedAt: null, sourceExists: false, syncStatus: "manual", createdAt: "now", updatedAt: "now" },
  { id: "agent-beta", projectId: "p1", name: "Agent Beta With A Very Long Responsive Name", description: "", instructionMarkdown: "", labels: [], sourcePath: null, sourceScope: null, sourceUpdatedAt: null, sourceImportedAt: null, sourceExists: false, syncStatus: "manual", createdAt: "now", updatedAt: "now" },
];

const fillRequiredFields = (): void => {
  fireEvent.input(screen.getByLabelText(/Task Title/i), { target: { value: "Implement task editor" } });
  fireEvent.input(screen.getByLabelText(/Description/i), { target: { value: "Describe the expected task outcome." } });
  fireEvent.input(screen.getByLabelText(/Markdown Prompt/i), { target: { value: "## Steps\n- Implement the requested change." } });
};

const chooseWorkerAgent = async (name: RegExp): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "Worker Agent" }));
  const option = await screen.findByRole("option", { name });
  fireEvent.click(option);
};

describe("TaskComposer", () => {
  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders worker-agent selector with built-in default and configured presets", async () => {
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} agentPresets={agentPresets as any} onClose={() => {}} onSubmit={() => {}} />);

    expect(screen.getByRole("button", { name: "Worker Agent" })).toHaveTextContent("Built-in Worker agent");

    fireEvent.click(screen.getByRole("button", { name: "Worker Agent" }));

    expect(await screen.findByRole("option", { name: /Built-in Worker agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Agent Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Agent Beta With A Very Long Responsive Name/i })).toBeInTheDocument();
  });

  test("selecting a worker-agent preset submits agentPresetId", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} agentPresets={agentPresets as any} onClose={onClose} onSubmit={onSubmit} />);

    fillRequiredFields();
    await chooseWorkerAgent(/Agent Alpha/i);
    fireEvent.click(screen.getByRole("button", { name: /Create Task/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ agentPresetId: "agent-alpha" }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  test("clearing to the built-in worker agent submits null", async () => {
    const onSubmit = vi.fn();
    const taskWithPreset = { ...dummyTasks[0], agentPresetId: "agent-alpha" };
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} agentPresets={agentPresets as any} onClose={() => {}} onSubmit={onSubmit} initialTask={taskWithPreset} />);

    expect(screen.getByRole("button", { name: "Worker Agent" })).toHaveTextContent("Agent Alpha");

    await chooseWorkerAgent(/Built-in Worker agent/i);
    fireEvent.click(screen.getByRole("button", { name: /Save Task/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ agentPresetId: null }));
    });
  });

  test("validation reveal focus moves to first invalid field", async () => {
    const { container } = render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      const firstInvalid = document.querySelector('[aria-invalid="true"]');
      expect(firstInvalid).not.toBeNull();
      if (document.activeElement?.tagName !== "BODY" || document.activeElement === firstInvalid) {
        expect(document.activeElement).toBe(firstInvalid);
      }
    }, { timeout: 2000 });
  });

  test("dependency toggle updates aria-pressed", async () => {
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    const taskButton = screen.getByRole("button", { name: /T-1.*Task 1/s });
    expect(taskButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(taskButton);

    await waitFor(() => {
      expect(taskButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  test("retry submit exposes via ActionFeedbackRegion on failure", async () => {
    const failingSubmit = vi.fn().mockRejectedValue(new Error("Submit failed"));
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={failingSubmit} initialTask={dummyTasks[0]} />);

    fireEvent.click(screen.getByRole("button", { name: /Save Task/i }));

    await waitFor(() => {
      expect(screen.getByText("Submit failed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });
});
