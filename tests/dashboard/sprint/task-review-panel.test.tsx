/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TaskReviewPanel } from "../../../dashboard/src/v2/components/sprint/TaskReviewPanel";

expect.extend(matchers);

describe("TaskReviewPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render when status is not QA_REVIEW_FAILED", () => {
    const { container } = render(<TaskReviewPanel task={{ status: "completed" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders with fallback text when qa_review reason is missing", () => {
    render(<TaskReviewPanel task={{ status: "QA_REVIEW_FAILED" }} />);
    const panel = screen.getByTestId("task-review-panel");
    const reason = screen.getByTestId("qa-error-reason");
    expect(panel).toBeInTheDocument();
    expect(reason).toHaveTextContent("Review parsing failed");
  });

  it("renders provided error reason from qa_review object", () => {
    render(
      <TaskReviewPanel
        task={{
          status: "QA_REVIEW_FAILED",
          qa_review: { error_reason: "Specific parsing syntax error at line 42" }
        }}
      />
    );
    const reason = screen.getByTestId("qa-error-reason");
    expect(reason).toHaveTextContent("Specific parsing syntax error at line 42");
  });
});
