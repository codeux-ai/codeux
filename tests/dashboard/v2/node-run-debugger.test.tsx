/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeRunDebugger } from "../../../dashboard/src/v2/components/nodes/NodeRunDebugger.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

afterEach(cleanup);

describe("NodeRunDebugger approvals", () => {
  it("shows a pending approval and dispatches one explicit decision", async () => {
    const onApprovalDecision = vi.fn();
    render(<DashboardI18nProvider storage={null}><NodeRunDebugger
      runs={[{ id: "run-1", flowId: "flow-1", projectId: "project-1", version: 1, publicationId: "publication-1", status: "approval_waiting", policy: {} as never, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: "xi-1", triggerType: "manual", triggerPayload: null, input: {}, output: {}, errorMessage: null, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
      selectedRunId="run-1" nodeRuns={[]} attempts={[]}
      approvals={[{ id: "approval-1", projectId: "project-1", flowId: "flow-1", runId: "run-1", nodeId: "send", logicalItem: "email-1", status: "pending", request: {}, decision: null, requestedAt: "2026-01-01T00:00:00.000Z", decidedAt: null, decidedBy: null, expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
      onSelectRun={() => undefined} onRefresh={() => undefined} onCancel={() => undefined} onRetry={() => undefined}
      onApprovalDecision={onApprovalDecision}
    /></DashboardI18nProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Approve & continue" }));
    expect(onApprovalDecision).toHaveBeenCalledOnce();
    expect(onApprovalDecision).toHaveBeenCalledWith("approval-1", "approve");
  });

  it("localizes cancellation and scheduling while preserving provider output", async () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    render(<DashboardI18nProvider initialLocale="de" storage={null}><NodeRunDebugger
      runs={[
        { id: "run-2", flowId: "flow-1", projectId: "project-1", version: 4, publicationId: "publication-1", status: "running", policy: {} as never, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: "xi-2", triggerType: "provider_webhook", triggerPayload: null, input: {}, output: { providerText: "PROVIDER_OUTPUT_MUST_STAY_ENGLISH" }, errorMessage: null, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "run-3", flowId: "flow-1", projectId: "project-1", version: 3, publicationId: "publication-1", status: "failed", policy: {} as never, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: null, triggerType: "manual", triggerPayload: null, input: {}, output: {}, errorMessage: "PROVIDER_FAILURE_VERBATIM", startedAt: null, finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ]}
      selectedRunId="run-2" nodeRuns={[]} attempts={[]}
      onSelectRun={() => undefined} onRefresh={() => undefined} onCancel={onCancel} onRetry={onRetry}
    /></DashboardI18nProvider>);

    expect(screen.getByText("Wird ausgeführt · v4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planen" })).toHaveAttribute("href", "/scheduler");
    expect(screen.getByText(/PROVIDER_OUTPUT_MUST_STAY_ENGLISH/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onCancel).toHaveBeenCalledOnce();

    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps German safe retry wired to the existing retry command", async () => {
    const onRetry = vi.fn();
    render(<DashboardI18nProvider initialLocale="de" storage={null}><NodeRunDebugger
      runs={[{ id: "run-3", flowId: "flow-1", projectId: "project-1", version: 3, publicationId: "publication-1", status: "failed", policy: {} as never, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, cancelRequestedAt: null, executionInvocationId: null, triggerType: "manual", triggerPayload: null, input: {}, output: {}, errorMessage: "PROVIDER_FAILURE_VERBATIM", startedAt: null, finishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]}
      selectedRunId="run-3" nodeRuns={[]} attempts={[]}
      onSelectRun={() => undefined} onRefresh={() => undefined} onCancel={() => undefined} onRetry={onRetry}
    /></DashboardI18nProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Sicher wiederholen" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
