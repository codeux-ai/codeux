/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, describe, vi } from "vitest";
import { AddTaskModal } from "../AddTaskModal.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("AddTaskModal Accessibility", () => {
  const dummySprints = [{ id: "1", name: "Sprint 1", repositoryId: "r1", sprintMarkdownId: "m1", status: "active", createdAt: "now", updatedAt: "now" }];
  const dummyTasks: any[] = [];

  afterEach(() => {
    cleanup();
  });

  test("renders with accessible name and structure", () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0]).toHaveAttribute("aria-labelledby", "add-task-modal-title");

    // Check for fixed header/footer and scrollable body structure
    const formBody = document.getElementById("add-task-form-body");
    expect(formBody).toBeInTheDocument();
  });

  test("dependency search and options handle accessibility", async () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    expect(screen.getByText(/0 dependency options available. 0 selected./i)).toBeInTheDocument();

    // "No existing tasks" status should have polite live region
    const statusRegion = screen.getAllByText(/No existing tasks in this sprint yet/i)[0];
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveAttribute("role", "status");
  });

  test("applies FieldWrapper attributes to required form inputs", () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);
    const titleInput = screen.getAllByRole("textbox").find(el => el.id === "add-task-title");
    expect(titleInput).toHaveAttribute("aria-required", "true");
  });

  test("invalid submit focuses the first invalid field and scrolls inside the form body", async () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    const form = document.getElementById("add-task-form") as HTMLFormElement;
    const formBody = document.getElementById("add-task-form-body") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperty(formBody, "scrollTo", { value: scrollTo, configurable: true });

    fireEvent.submit(form);

    const titleInput = document.getElementById("add-task-title") as HTMLInputElement;
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Review required fields/i);
      expect(titleInput).toHaveAttribute("aria-invalid", "true");
      expect(titleInput.getAttribute("aria-errormessage")).toContain("add-task-title-error");
      expect(document.activeElement).toBe(titleInput);
      expect(scrollTo).toHaveBeenCalled();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
  });

  test("status, priority, and executor choices expose radio semantics", () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    expect(screen.getByRole("radiogroup", { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /pending/i })).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: /priority/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /medium/i })).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: /executor/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /auto/i })).toBeChecked();
  });

  test("dependency filtering announces result counts and preserves selected dependencies", async () => {
    const dependencyTasks = Array.from({ length: 6 }, (_, index) => ({
      recordId: `task-${index + 1}`,
      id: `T-${index + 1}`,
      sprintId: "1",
      title: index === 0 ? "Database migration" : `Follow up ${index + 1}`,
      priority: "medium",
    }));

    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dependencyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Database migration/i }));
    expect(screen.getByText(/Database migration added to dependencies./i)).toBeInTheDocument();
    expect(screen.getByText(/6 dependency options available. 1 selected./i)).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/Filter dependencies/i), { target: { value: "follow" } });

    await waitFor(() => {
      expect(screen.getByText(/5 dependency results match "follow". 1 selected./i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("checkbox", { name: /Database migration/i })).not.toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/Filter dependencies/i), { target: { value: "missing" } });
    await waitFor(() => {
      expect(screen.getByText(/No dependency results match "missing"/i)).toBeInTheDocument();
    });

    fireEvent.input(screen.getByLabelText(/Filter dependencies/i), { target: { value: "" } });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Database migration/i })).toBeChecked();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Database migration/i }));
    expect(screen.getByText(/Database migration removed from dependencies./i)).toBeInTheDocument();
  });
});
