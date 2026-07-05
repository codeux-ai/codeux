/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";

import { ExecutionTimelineProvider } from "../../../../hooks/ExecutionTimelineContext.js";
import type { QuicksprintTemplateRecord } from "../../../../../../src/contracts/quicksprint-types.js";
import type { PlanningRouteOption } from "../../../lib/sprint-composer-state.js";
import { QuicksprintPanel } from "../QuicksprintPanel.js";

const makeTemplate = (id: string): QuicksprintTemplateRecord => ({
  id,
  projectId: "project-1",
  name: `Template ${id}`,
  description: "A reusable quicksprint template.",
  icon: "Zap",
  category: "engineering",
  categoryColor: "ember",
  agentInstructionMarkdown: "Inspect the current repository and plan focused work.",
  defaultTaskCount: 5,
  isBuiltIn: true,
  purpose: "fullstack-js",
  purposeLabel: "Fullstack JS App",
  purposeDescription: "Default quicksprints for fullstack JavaScript applications.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("QuicksprintPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts a new quicksprint from a minimized planning overlay without aborting the active request", async () => {
    let capturedSignal: AbortSignal | undefined;
    let capturedShouldHandleResult: (() => boolean) | undefined;
    const onExecute = vi.fn((
      _templateId: string,
      _taskCount: number,
      _submitMode: "plan_only" | "plan_and_start",
      _additionalPrompt?: string,
      _routeOverride?: PlanningRouteOption | null,
      _modelOverride?: string | null,
      signal?: AbortSignal,
      options?: { shouldHandleResult?: () => boolean },
    ): Promise<void> => {
      capturedSignal = signal;
      capturedShouldHandleResult = options?.shouldHandleResult;
      return new Promise<void>(() => {});
    });

    render(
      <ExecutionTimelineProvider execution={null}>
        <QuicksprintPanel
          projectId="project-1"
          onClose={vi.fn()}
          onExecute={onExecute}
          templates={[makeTemplate("1")]}
          loading={false}
        />
      </ExecutionTimelineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Template 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan & Start" }));

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "New Quicksprint" }));

    expect(capturedSignal?.aborted).toBe(false);
    expect(capturedShouldHandleResult?.()).toBe(false);
    expect(screen.getByRole("button", { name: "Template 1" })).toBeInTheDocument();
  });
});
