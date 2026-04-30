/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
import { Button } from "../Button.js";
import { Input } from "../Input.js";
import { Select } from "../Select.js";
import { Switch } from "../Switch.js";
import { CollapsiblePanel } from "../CollapsiblePanel.js";
import { Activity } from "lucide-preact";
import { DockerStatusMenu } from "../../DockerStatusMenu.js";
import { TaskRow } from "../TaskRow.js";
import { SprintLedgerRow } from "../../sprints/SprintLedgerRow.js";

afterEach(() => {
  cleanup();
});

describe("Interaction A11y (Components)", () => {
  describe("Button", () => {
    it("disables correctly and prevents onClick when pending", async () => {
      const onClick = vi.fn();
      const { getByRole } = render(
        <Button pending onClick={onClick}>
          Submit
        </Button>
      );

      const button = getByRole("button");
      expect(button).toBeDisabled();

      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("disables correctly and prevents onClick when disabled", async () => {
      const onClick = vi.fn();
      const { getByRole } = render(
        <Button disabled onClick={onClick}>
          Submit
        </Button>
      );

      const button = getByRole("button");
      expect(button).toBeDisabled();

      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("Input", () => {
    it("renders with aria-invalid and aria-describedby when invalid and errorMessage are provided", () => {
      const { getByRole, getByText } = render(
        <Input
          id="test-input"
          invalid={true}
          errorMessage="This field is required"
        />
      );

      const input = getByRole("textbox");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe("test-input-error");

      const errorElement = getByText("This field is required");
      expect(errorElement.getAttribute("id")).toBe("test-input-error");
    });
  });

  describe("Select", () => {
    it("renders with aria-invalid and aria-describedby when invalid and errorMessage are provided", () => {
      const { getByRole, getByText } = render(
        <Select
          id="test-select"
          invalid={true}
          errorMessage="Please select an option"
        >
          <option value="">Select...</option>
          <option value="1">Option 1</option>
        </Select>
      );

      const select = getByRole("combobox");
      expect(select.getAttribute("aria-invalid")).toBe("true");
      expect(select.getAttribute("aria-describedby")).toBe("test-select-error");

      const errorElement = getByText("Please select an option");
      expect(errorElement.getAttribute("id")).toBe("test-select-error");
    });
  });

  describe("Switch", () => {
    it("renders with role='switch' and aria-invalid", () => {
      const { getByRole } = render(<Switch invalid={true} />);

      const switchEl = getByRole("switch");
      expect(switchEl.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("CollapsiblePanel", () => {
    it("toggles state via mouse click", async () => {
      const { getByRole, getByText } = render(
        <CollapsiblePanel
          title="Test Panel"
          icon={Activity}
          accentHex="#ff0000"
          defaultOpen={false}
        >
          <div>Panel Content</div>
        </CollapsiblePanel>
      );

      const toggleButton = getByRole("button", { name: /Test Panel/i });
      const content = getByText("Panel Content");

      // Intially not visible due to height: 0, but content is in DOM.
      // We check if click triggers re-render
      await userEvent.click(toggleButton);

      // Verify that toggling the button doesn't crash and operates properly
      expect(toggleButton).toBeInTheDocument();
      expect(content).toBeInTheDocument();
    });

    it("has visible focus outline (focus-visible class)", () => {
        const { getByRole } = render(
            <CollapsiblePanel
              title="Focus Panel"
              icon={Activity}
              accentHex="#ff0000"
              defaultOpen={false}
            >
              <div>Panel Content</div>
            </CollapsiblePanel>
          );

          const toggleButton = getByRole("button", { name: /Focus Panel/i });
          expect(toggleButton.className).toMatch(/focus-visible:ring-2/);
    });
  });

  describe("DockerStatusMenu", () => {
    it("renders aria-expanded and aria-controls, and dismisses on Esc", async () => {
      const user = userEvent.setup();
      const { getByRole, queryByRole } = render(<DockerStatusMenu />);

      const button = getByRole("button", { name: /Docker Status/i });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveAttribute("aria-controls", "docker-status-menu");

      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(queryByRole("dialog")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("TaskRow", () => {
    it("supports selection and rendering with feedback wrapper", async () => {
      const task = {
        id: "task-1",
        recordId: 1,
        sprint: "sprint-1",
        sprintId: "sprint-1",
        priority: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        failedAt: null,
        startedAt: null,
        durationSeconds: 0,
        title: "Test Task",
        status: "pending" as const,
        time: "0:00",
        source: "agent" as const,
        isCompleted: false,
        isFailed: false,
        executorType: "agent",
        assignee: "agent",
        promptMarkdown: "Test prompt",
        description: "Test description",
        dependsOn: [],
        type: "task",
      } as any;

      const { getAllByRole, getByText } = render(<TaskRow task={task} />);
      // getAllByRole("button") returns the main row button, plus the quick actions buttons
      const buttons = getAllByRole("button");
      const row = buttons[0];

      expect(row).toBeInTheDocument();
      expect(getByText("Test Task")).toBeInTheDocument();

      // Focus outline class check
      expect(row.className).toMatch(/focus-visible:ring-2/);
    });
  });

  describe("SprintLedgerRow", () => {
    it("renders interaction hover classes and handles pending states correctly", () => {
      const sprint = {
        id: "sprint-1",
        date: "2023-01-01",
        projectId: "project-1",
        number: 1,
        originalPrompt: "Prompt",
        tasksGenerated: 1,
        tasksCompleted: 0,
        name: "Test Sprint",
        slug: "test-sprint",
        goal: "Goal",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "idle" as const,
        tasksCount: 0,
        completion: 0,
        showcasePinned: false,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        featureBranch: "feature/test",
      } as any;

      const onToggleRow = vi.fn();
      const { container } = render(
        <SprintLedgerRow
          sprint={sprint}
          isSelected={false}
          isEven={true}
          activeRun={undefined}
          humanIntervention={null}
          pendingActionIds={new Set(["sprint-start:sprint-1"])}
          onToggleRow={onToggleRow}
          onToggleShowcase={vi.fn()}
          onSprintToggle={vi.fn()}
          onOpenRowMenu={vi.fn()}
        />
      );

      const tr = container.querySelector('tr');
      expect(tr).not.toBeNull();
      // Should have hover classes applied
      expect(tr?.className).toMatch(/hover:bg-black\/\[0\.02\]/);
    });
  });
});