/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TaskStatusBadge } from "../../../dashboard/src/v2/components/sprint/TaskStatusBadge";

expect.extend(matchers);

describe("TaskStatusBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders pending status correctly", () => {
    render(<TaskStatusBadge status="pending" />);
    const badge = screen.getByTestId("task-status-badge");
    expect(badge).toHaveTextContent("Pending");
  });

  it("renders completed status correctly", () => {
    render(<TaskStatusBadge status="completed" />);
    const badge = screen.getByTestId("task-status-badge");
    expect(badge).toHaveTextContent("Completed");
    expect(badge).not.toHaveTextContent("QA Failed");
  });

  it("renders distinct QA_REVIEW_FAILED status treatment and never as completed", () => {
    render(<TaskStatusBadge status="QA_REVIEW_FAILED" />);
    const badge = screen.getByTestId("task-status-badge");
    expect(badge).toHaveTextContent("QA Failed");
    expect(badge).not.toHaveTextContent("Completed");
    expect(badge.className).toContain("text-red-800");
  });
});
