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
      expect(titleInput).toHaveAttribute("aria-invalid", "true");
      expect(titleInput.getAttribute("aria-errormessage")).toContain("add-task-title-error");
      expect(document.activeElement).toBe(titleInput);
      expect(scrollTo).toHaveBeenCalled();
    });
  });
});
