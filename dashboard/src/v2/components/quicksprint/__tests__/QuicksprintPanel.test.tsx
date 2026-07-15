/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";

import { ExecutionTimelineProvider } from "../../../../hooks/ExecutionTimelineContext.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
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
      <DashboardI18nProvider initialLocale="en" storage={null}>
        <ExecutionTimelineProvider execution={null}>
          <QuicksprintPanel
          projectId="project-1"
          onClose={vi.fn()}
          onExecute={onExecute}
          templates={[makeTemplate("1")]}
          loading={false}
          />
        </ExecutionTimelineProvider>
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Template 1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Plan & Start" }).pop()!);

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "New Quicksprint" }));

    expect(capturedSignal?.aborted).toBe(false);
    expect(capturedShouldHandleResult?.()).toBe(false);
    expect(screen.getByRole("button", { name: "Template 1" })).toBeInTheDocument();
  });

  it("schedules a configured quicksprint with an after-sprint-end anchor", async () => {
    const onSchedule = vi.fn().mockResolvedValue(undefined);

    render(
      <DashboardI18nProvider initialLocale="en" storage={null}>
        <ExecutionTimelineProvider execution={null}>
          <QuicksprintPanel
          projectId="project-1"
          onClose={vi.fn()}
          onExecute={vi.fn()}
          onSchedule={onSchedule}
          scheduleAnchorSprintOptions={[{ id: "source-sprint-1", label: "Release prep" }]}
          templates={[makeTemplate("1")]}
          loading={false}
          />
        </ExecutionTimelineProvider>
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Template 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /no limit/i }));
    fireEvent.input(screen.getByPlaceholderText(/Add extra context or requirements/i), {
      target: { value: "Only include deployment follow-ups." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan Later" }));
    fireEvent.click(screen.getByRole("button", { name: "After End" }));
    fireEvent.click(screen.getByRole("button", { name: /quicksprint source sprint/i }));
    fireEvent.click(screen.getByText("Release prep"));
    fireEvent.input(screen.getByRole("spinbutton", { name: /offset minutes/i }), { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      expect(onSchedule).toHaveBeenCalledTimes(1);
    });
    expect(onSchedule.mock.calls[0]?.[0]).toMatchObject({
      templateId: "1",
      taskCount: 5,
      noTaskLimit: true,
      submitMode: "plan_only",
      additionalPrompt: "Only include deployment follow-ups.",
      schedule: {
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint-1",
          offsetMinutes: 30,
        },
      },
    });
  });

  it("executes a template from German chrome without translating execution inputs", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <ExecutionTimelineProvider execution={null}>
          <QuicksprintPanel
            projectId="project-1"
            onClose={vi.fn()}
            onExecute={onExecute}
            templates={[makeTemplate("1")]}
            loading={false}
          />
        </ExecutionTimelineProvider>
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Template 1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Template 1 ausgewählt. Konfigurieren Sie den Quicksprint vor der Planung.");
    fireEvent.input(screen.getByPlaceholderText(/Zusätzlichen Kontext/), {
      target: { value: "Preserve `npm test -- --runInBand` exactly." },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Planen & starten" }).pop()!);

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith(
      "1",
      5,
      "plan_and_start",
      "Preserve `npm test -- --runInBand` exactly.",
      null,
      null,
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it("keeps provider failures verbatim inside German execution feedback", async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error("provider_id=codex-primary unavailable"));
    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <ExecutionTimelineProvider execution={null}>
          <QuicksprintPanel
            projectId="project-1"
            onClose={vi.fn()}
            onExecute={onExecute}
            templates={[makeTemplate("1")]}
            loading={false}
          />
        </ExecutionTimelineProvider>
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Template 1" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Planen & starten" }).pop()!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Planung für Template 1 fehlgeschlagen: provider_id=codex-primary unavailable",
      );
    });
  });
});
