/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { SprintComposer } from "../SprintComposer.js";
import { ExecutionTimelineProvider } from "../../../../hooks/ExecutionTimelineContext.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { DashboardLocale } from "../../../i18n/locales.js";
import "@testing-library/jest-dom/vitest";

const renderWithContext = (ui: any, locale: DashboardLocale = "en") => {
  return render(
    <DashboardI18nProvider initialLocale={locale} storage={null}>
      <ExecutionTimelineProvider execution={null}>
        {ui}
      </ExecutionTimelineProvider>
    </DashboardI18nProvider>
  );
};

describe("SprintComposer", () => {
  const defaultProps = {
    nextId: "SPRINT-1",
    virtualProviders: [],
    planningPresets: [],
    planningEta: 5000,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onImprovePrompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("fails validation and sets hasAttemptedSubmit without shaking under reduced motion", async () => {
    // Override window.matchMedia for reduced motion
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }) as any);

    const { container } = renderWithContext(<SprintComposer {...defaultProps} />);
    const submitBtn = screen.getByRole("button", { name: "Plan ahead with AI" });

    const input = screen.getByRole("textbox", { name: "Sprint Name" });
    await userEvent.clear(input);
    await userEvent.click(submitBtn);

    expect(screen.getByText("Sprint name is required")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // Test that the form-shake class is not applied due to reduced motion
    expect(input).not.toHaveClass("animate-form-shake");
  });

  it("fails validation and sets hasAttemptedSubmit WITH shaking under normal motion", async () => {
    // Override window.matchMedia for normal motion
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }) as any);

    renderWithContext(<SprintComposer {...defaultProps} />);
    const submitBtn = screen.getByRole("button", { name: "Plan ahead with AI" });

    const input = screen.getByRole("textbox", { name: "Sprint Name" });
    await userEvent.clear(input);
    await userEvent.click(submitBtn);

    expect(screen.getByText("Sprint name is required")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // Test that the form-shake class IS applied due to normal motion
    expect(input).toHaveClass("animate-form-shake");
  });

  it("handles very long sprint names and goals without throwing layout errors", async () => {
    renderWithContext(<SprintComposer {...defaultProps} />);
    const input = screen.getByRole("textbox", { name: "Sprint Name" });
    const goalInput = screen.getByPlaceholderText(/Describe the outcome/);
    fireEvent.input(input, { target: { value: "A very long sprint name ".repeat(20) } });
    fireEvent.input(goalInput, { target: { value: "A very long sprint goal ".repeat(50) } });
    expect(screen.getByRole("button", { name: "Plan ahead with AI" })).toBeInTheDocument();
  });

  it("shows retry failure and prompt-improve pending states", async () => {
    const improvePromptMock = vi.fn().mockRejectedValue(new Error("Network failure"));
    renderWithContext(<SprintComposer {...defaultProps} onImprovePrompt={improvePromptMock} />);

    const input = screen.getByRole("textbox", { name: "Sprint Name" });
    const goalInput = screen.getByPlaceholderText(/Describe the outcome/);

    fireEvent.input(input, { target: { value: "A new sprint" } });
    fireEvent.input(goalInput, { target: { value: "A new goal" } });

    const improveBtn = screen.getByRole("button", { name: "Plan ahead with AI" });
    fireEvent.click(improveBtn);

    // Expect to see the pending message
    await waitFor(() => {
        expect(screen.getAllByText("Refining prompt...").length).toBeGreaterThan(0);
    });

    // Expect to see the error message after rejection
    await waitFor(() => {
        expect(screen.queryAllByText(/Network failure/).length).toBeGreaterThan(0);
        expect(screen.queryByRole("button", { name: "Retry Improve" })).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("cancels pending requests", async () => {
    let resolveImprove: any;
    let isCanceled = false;
    const improvePromise = new Promise((res, rej) => {
        resolveImprove = res;
    });

    const improvePromptMock = vi.fn().mockImplementation((args) => {
        // mock to support signal
        if (args.signal) {
            args.signal.addEventListener('abort', () => { isCanceled = true; });
        }
        return improvePromise;
    });

    const onCancelMock = vi.fn();
    renderWithContext(<SprintComposer {...defaultProps} onImprovePrompt={improvePromptMock} onCancelPlanningRequest={onCancelMock} />);

    const input = screen.getByRole("textbox", { name: "Sprint Name" });
    const goalInput = screen.getByPlaceholderText(/Describe the outcome/);

    fireEvent.input(input, { target: { value: "A new sprint" } });
    fireEvent.input(goalInput, { target: { value: "A new goal" } });

    const improveBtn = screen.getByRole("button", { name: "Plan ahead with AI" });
    fireEvent.click(improveBtn);

    // Overlay is active, cancel it
    await waitFor(() => {
        expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    const cancelBtn = screen.getAllByRole("button", { name: "Cancel Active Request" })[0];
    fireEvent.click(cancelBtn);

    expect(onCancelMock).toHaveBeenCalled();
  });

  it("starts a new sprint from a minimized planning overlay without cancelling the active request", async () => {
    let capturedShouldHandleResult: (() => boolean) | undefined;
    const onSubmit = vi.fn((payload: { shouldHandleResult?: () => boolean }) => {
      capturedShouldHandleResult = payload.shouldHandleResult;
      return new Promise<void>(() => {});
    });
    const onCancelMock = vi.fn();
    const onStartNewSprint = vi.fn();

    renderWithContext(
      <SprintComposer
        {...defaultProps}
        onSubmit={onSubmit}
        onCancelPlanningRequest={onCancelMock}
        onStartNewSprint={onStartNewSprint}
      />,
    );

    fireEvent.input(screen.getByRole("textbox", { name: "Sprint Name" }), {
      target: { value: "Next runtime sweep" },
    });
    fireEvent.input(screen.getByPlaceholderText(/Describe the outcome/), {
      target: { value: "Plan the next independent sprint." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan & Start" }));

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "New Sprint" }));

    expect(onStartNewSprint).toHaveBeenCalled();
    expect(onCancelMock).not.toHaveBeenCalled();
    expect(capturedShouldHandleResult?.()).toBe(false);
  });

  it("shows German validation while preserving plan-only authoring content", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithContext(<SprintComposer {...defaultProps} onSubmit={onSubmit} />, "de");

    const nameInput = screen.getByRole("textbox", { name: "Sprintname" });
    await userEvent.clear(nameInput);
    await userEvent.click(screen.getByRole("button", { name: "Mit KI vorausplanen" }));

    expect(screen.getByText("Sprintname ist erforderlich")).toBeInTheDocument();

    const authoredName = "API-Härtung & Überprüfung";
    const authoredGoal = "Keep `POST /v2/jobs` unchanged; prüfe retries verbatim.";
    fireEvent.input(nameInput, { target: { value: authoredName } });
    fireEvent.input(screen.getByPlaceholderText(/gewünschten Endzustand/), { target: { value: authoredGoal } });
    fireEvent.click(screen.getByRole("button", { name: /^Nur planen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nur planen" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: authoredName,
      goal: authoredGoal,
      submitMode: "plan_only",
    });
  });

  it("localizes provider failure chrome while preserving the server error", async () => {
    const onImprovePrompt = vi.fn().mockRejectedValue(new Error("provider_id=codex-primary unavailable"));
    renderWithContext(<SprintComposer {...defaultProps} onImprovePrompt={onImprovePrompt} />, "de");

    fireEvent.input(screen.getByRole("textbox", { name: "Sprintname" }), { target: { value: "Fehlerpfad" } });
    fireEvent.input(screen.getByPlaceholderText(/gewünschten Endzustand/), { target: { value: "Keep payload exact." } });
    fireEvent.click(screen.getByRole("button", { name: "Mit KI vorausplanen" }));

    await waitFor(() => {
      expect(screen.getAllByText(/provider_id=codex-primary unavailable/).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Verbesserung erneut versuchen" })).toBeInTheDocument();
    });
  });

});
