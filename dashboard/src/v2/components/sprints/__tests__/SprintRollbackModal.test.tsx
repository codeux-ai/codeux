// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sprint } from "../../../types.js";
import { SprintRollbackModal } from "../SprintRollbackModal.js";
import { assessSprintRollback, createSprintRollback } from "../../../lib/project-api.js";
import { renderWithI18n } from "../../../../../../tests/dashboard/render-with-i18n.js";

expect.extend(matchers);

vi.mock("../../../lib/project-api.js", () => ({
  assessSprintRollback: vi.fn(),
  createSprintRollback: vi.fn(),
}));
vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T) => duration,
}));
vi.mock("gsap", () => ({ default: { fromTo: vi.fn(), set: vi.fn(), to: vi.fn() } }));

const sprint: Sprint = {
  id: "sprint-1",
  projectId: "project-1",
  number: 1,
  slug: "sprint-1",
  name: "Feature Sprint",
  isGeneratedName: false,
  originalPrompt: null,
  goal: "Build a feature",
  status: "completed",
  showcasePinned: true,
  startDate: null,
  endDate: null,
  featureBranch: "feature/sprint-1",
  baseCommitSha: "base",
  kind: "standard",
  rollbackSourceSprintId: null,
  rollbackMode: null,
  rollbackInstructions: null,
  rollbackSafetyReason: null,
  tasksCount: 1,
  completion: 100,
  linkedIssues: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  date: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SprintRollbackModal", () => {
  it("explains the automatic path and submits an empty scope", async () => {
    vi.mocked(assessSprintRollback).mockResolvedValue({
      sourceSprintId: sprint.id,
      eligible: true,
      recommendedMode: "automatic",
      reasons: ["Safe isolated merge."],
    });
    vi.mocked(createSprintRollback).mockResolvedValue({
      rollbackSprint: { ...sprint, id: "rollback-1", kind: "rollback", rollbackSourceSprintId: sprint.id, rollbackMode: "automatic" },
      mode: "automatic",
      assessment: { sourceSprintId: sprint.id, eligible: true, recommendedMode: "automatic", reasons: [] },
    });
    const onCreated = vi.fn();
    renderWithI18n(<SprintRollbackModal sprint={sprint} onClose={vi.fn()} onCreated={onCreated} />);

    expect(await screen.findByText("Safe automatic rollback available")).toBeInTheDocument();
    expect(screen.getByText(/local projects merge the branch locally/i)).toBeInTheDocument();
    expect(screen.getByText("No coding invocation will be started.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create rollback" }));
    await waitFor(() => expect(createSprintRollback).toHaveBeenCalledWith("project-1", "sprint-1", ""));
    expect(onCreated).toHaveBeenCalled();
  });

  it("switches to an agent rollback when instructions are entered", async () => {
    vi.mocked(assessSprintRollback).mockResolvedValue({
      sourceSprintId: sprint.id,
      eligible: true,
      recommendedMode: "automatic",
      reasons: ["Safe isolated merge."],
    });
    vi.mocked(createSprintRollback).mockResolvedValue({
      rollbackSprint: { ...sprint, id: "rollback-2", kind: "rollback", rollbackSourceSprintId: sprint.id, rollbackMode: "agent_assisted" },
      mode: "agent_assisted",
      assessment: { sourceSprintId: sprint.id, eligible: true, recommendedMode: "agent_assisted", reasons: [] },
    });
    renderWithI18n(<SprintRollbackModal sprint={sprint} onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText("Safe automatic rollback available");
    fireEvent.input(screen.getByRole("textbox", { name: /Rollback instructions/i }), {
      target: { value: "Remove only feature XY." },
    });
    expect(screen.getByText("A rollback coding invocation will be started.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start agent rollback" }));
    await waitFor(() => expect(createSprintRollback).toHaveBeenCalledWith("project-1", "sprint-1", "Remove only feature XY."));
  });

  it("preserves rollback API failures verbatim and recovers on a German retry", async () => {
    vi.mocked(assessSprintRollback).mockResolvedValue({
      sourceSprintId: sprint.id,
      eligible: true,
      recommendedMode: "automatic",
      reasons: ["Server safety assessment remains verbatim."],
    });
    vi.mocked(createSprintRollback)
      .mockRejectedValueOnce(new Error("Rollback API failure for branch feature/sprint-1"))
      .mockResolvedValueOnce({
        rollbackSprint: { ...sprint, id: "rollback-3", kind: "rollback", rollbackSourceSprintId: sprint.id, rollbackMode: "automatic" },
        mode: "automatic",
        assessment: { sourceSprintId: sprint.id, eligible: true, recommendedMode: "automatic", reasons: [] },
      });
    const onCreated = vi.fn();
    renderWithI18n(<SprintRollbackModal sprint={sprint} onClose={vi.fn()} onCreated={onCreated} />, {}, "de");

    expect(await screen.findByText("Sicherer automatischer Rollback verfügbar")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Server safety assessment remains verbatim.");
    fireEvent.click(screen.getByRole("button", { name: "Rollback erstellen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rollback API failure for branch feature/sprint-1");

    fireEvent.click(screen.getByRole("button", { name: "Rollback erstellen" }));
    await waitFor(() => expect(createSprintRollback).toHaveBeenCalledTimes(2));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
