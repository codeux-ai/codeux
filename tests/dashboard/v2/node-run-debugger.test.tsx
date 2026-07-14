/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeRunDebugger } from "../../../dashboard/src/v2/components/nodes/NodeRunDebugger.js";

afterEach(cleanup);

describe("NodeRunDebugger approvals", () => {
  it("shows a pending approval and dispatches one explicit decision", async () => {
    const onApprovalDecision = vi.fn();
    render(<NodeRunDebugger
      runs={[{ id: "run-1", flowId: "flow-1", projectId: "project-1", version: 1, publicationId: "publication-1", status: "approval_waiting", policy: {} as never, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: "xi-1", triggerType: "manual", triggerPayload: null, input: {}, output: {}, errorMessage: null, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
      selectedRunId="run-1" nodeRuns={[]} attempts={[]}
      approvals={[{ id: "approval-1", projectId: "project-1", flowId: "flow-1", runId: "run-1", nodeId: "send", logicalItem: "email-1", status: "pending", request: {}, decision: null, requestedAt: "2026-01-01T00:00:00.000Z", decidedAt: null, decidedBy: null, expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
      onSelectRun={() => undefined} onRefresh={() => undefined} onCancel={() => undefined} onRetry={() => undefined}
      onApprovalDecision={onApprovalDecision}
    />);
    await userEvent.click(screen.getByRole("button", { name: "Approve & continue" }));
    expect(onApprovalDecision).toHaveBeenCalledOnce();
    expect(onApprovalDecision).toHaveBeenCalledWith("approval-1", "approve");
  });
});
