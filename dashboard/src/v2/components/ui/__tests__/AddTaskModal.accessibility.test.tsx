/** @vitest-environment happy-dom */
import { h } from "preact";
import { render, screen, waitFor } from "@testing-library/preact";
import { expect, test, describe, vi } from "vitest";
import { AddTaskModal } from "../AddTaskModal.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("AddTaskModal Accessibility", () => {
  const dummySprints = [{ id: "1", name: "Sprint 1", repositoryId: "r1", sprintMarkdownId: "m1", status: "active", createdAt: "now", updatedAt: "now" }];
  const dummyTasks: any[] = [];

  test("renders with accessible name and structure", () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0]).toHaveAttribute("aria-labelledby", "add-task-modal-title");
  });

  test("dependency search and options handle accessibility", async () => {
    render(<AddTaskModal sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    // "No existing tasks" status should have polite live region
    const statusRegion = screen.getAllByText(/No existing tasks in this sprint yet/i)[0];
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveAttribute("role", "status");
  });
});
