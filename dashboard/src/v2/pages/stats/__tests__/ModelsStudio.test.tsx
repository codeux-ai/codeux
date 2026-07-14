/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import { ModelsStudio } from "../components/ModelsStudio.js";
import type { ExecutionModelStatsSummary, ExecutionUsageTotals } from "../../../types.js";
import { StatsI18nProvider } from "../stats-i18n.js";

afterEach(() => {
  cleanup();
});

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis(), fromTo: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), kill: vi.fn() })),
  },
}));

const usage: ExecutionUsageTotals = {
  invocationCount: 12,
  activeTimeMs: 720000,
  wallTimeMs: 0,
  inputTokens: 4000,
  cachedInputTokens: 6000,
  outputTokens: 2400,
  reasoningOutputTokens: 600,
  totalTokens: 13000,
  inputCostUsd: 0,
  outputCostUsd: 0,
  cachedInputCostUsd: 0,
  totalCostUsd: 0,
  reportedInvocationCount: 12,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
};

function createUsage(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return { ...usage, ...overrides };
}

function createModel(overrides: Partial<ExecutionModelStatsSummary> = {}): ExecutionModelStatsSummary {
  return {
    id: "claude::claude-opus-4-8",
    provider: "claude",
    model: "claude-opus-4-8",
    label: "claude-opus-4-8",
    usage,
    statusCounts: { completed: 11, failed: 1, cancelled: 0, running: 0, paused: 0 },
    successRate: 11 / 12,
    duration: { sampleCount: 12, avgMs: 42000, p50Ms: 38000, p95Ms: 95000, maxMs: 120000 },
    lastActivityAt: "2026-06-09T18:30:00.000Z",
    ...overrides,
  };
}

const model = createModel({
  id: "claude::claude-opus-4-8",
  provider: "claude",
  model: "claude-opus-4-8",
  label: "claude-opus-4-8",
  usage: createUsage({ totalCostUsd: 55.4093 }),
  statusCounts: { completed: 11, failed: 1, cancelled: 0, running: 0, paused: 0 },
  successRate: 11 / 12,
  duration: { sampleCount: 12, avgMs: 42000, p50Ms: 38000, p95Ms: 95000, maxMs: 120000 },
  lastActivityAt: "2026-06-09T18:30:00.000Z",
});

describe("ModelsStudio", () => {
  it("renders the leaderboard with efficiency metrics and highlights", () => {
    const { container } = render(
      <ModelsStudio
        stats={{ models: [model] } as any}
      />,
    );

    expect(screen.getByText("Model performance & efficiency")).toBeTruthy();
    expect(screen.getByText("Model Leaderboard")).toBeTruthy();
    expect(screen.getByText("Window Volume")).toBeTruthy();
    expect(screen.getByText("Sort: tokens desc")).toBeTruthy();
    expect(screen.getAllByText("claude-opus-4-8").length).toBeGreaterThan(0);

    // Efficiency derivations: cache hit 6000/(4000+6000)=60%, success 92%
    expect(container.textContent).toContain("60%");
    expect(container.textContent).toContain("92%");
    expect(container.textContent).toContain("Latency");
    expect(container.textContent).toContain("Token-Flow Anatomy");
    expect(container.textContent).toContain("Efficiency Highlights");
    expect(container.textContent).toContain("Most Reliable");
    expect(container.textContent).toContain("$55.41");
    expect(container.textContent).toContain("$4,262.25");
    expect(container.textContent).toContain("$4.62/call");

    const modelCard = screen.getByLabelText("claude-opus-4-8 model leaderboard rank 1");
    expect(modelCard.className).toContain("stats-surface-panel");
    expect(modelCard.className).not.toMatch(/shadow|backdrop|hover:-?translate|hover:scale|rounded-\[2\.2rem\]/);

    const highlightTile = screen.getByText("Volume Leader").closest(".stats-surface-subpanel");
    expect(highlightTile).toBeTruthy();
    expect(highlightTile?.className).not.toMatch(/shadow|backdrop|hover:-?translate|hover:scale|rounded-\[2\.2rem\]/);
  });

  it("orders the leaderboard by token volume and labels rank chips clearly", () => {
    const small = createModel({
      id: "codex::small",
      provider: "codex",
      model: "codex-small",
      label: "codex-small",
      usage: createUsage({ totalTokens: 2000, invocationCount: 8 }),
    });
    const large = createModel({
      id: "gemini::large",
      provider: "gemini",
      model: "gemini-large",
      label: "gemini-large",
      usage: createUsage({ totalTokens: 22000, invocationCount: 8 }),
    });

    const { container } = render(<ModelsStudio stats={{ models: [small, large] } as any} />);
    const text = container.textContent || "";

    expect(text.indexOf("gemini-large")).toBeLessThan(text.indexOf("codex-small"));
    expect(screen.getByLabelText("gemini-large model leaderboard rank 1")).toBeTruthy();
    expect(screen.getByLabelText("codex-small model leaderboard rank 2")).toBeTruthy();
    expect(container.textContent).toContain("Sort: tokens desc");
  });

  it("keeps long labels readable and renders critical success tone", () => {
    const longLabel = "provider-family-preview-2026-very-long-model-name-with-reasoning-and-cache-routing";
    const { container } = render(
      <ModelsStudio
        stats={{
          models: [
            createModel({
              id: "long::label",
              provider: "open-code",
              model: longLabel,
              label: longLabel,
              successRate: 0.5,
              statusCounts: { completed: 1, failed: 1, cancelled: 0, running: 0, paused: 0 },
              usage: createUsage({ invocationCount: 2, totalTokens: 6400 }),
            }),
          ],
        } as any}
      />,
    );

    expect(screen.getAllByText(longLabel).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Low sample");
    expect(container.textContent).toContain("Leaderboard placement is based on limited invocation telemetry.");
    expect(container.innerHTML).toContain("--stats-negative-text");
  });

  it("renders sparse model telemetry intentionally when duration and token volume are missing", () => {
    const { container } = render(
      <ModelsStudio
        stats={{
          models: [
            createModel({
              id: "sparse::model",
              provider: "codex",
              model: "sparse-model",
              label: "sparse-model",
              usage: createUsage({
                invocationCount: 0,
                activeTimeMs: 0,
                inputTokens: 0,
                cachedInputTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0,
                reportedInvocationCount: 0,
              }),
              duration: { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
              successRate: null,
              statusCounts: { completed: 0, failed: 0, cancelled: 0, running: 0, paused: 0 },
            }),
          ],
        } as any}
      />,
    );

    expect(container.textContent).toContain("No calls yet");
    expect(container.textContent).toContain("No model has duration samples yet");
    expect(container.textContent).toContain("Models are present, but none reported token volume");
    expect(container.textContent).toContain("Latency percentiles will appear after this model records duration samples.");
    expect(container.textContent).toContain("pending outcomes");
  });

  it("renders an empty state when no models reported", () => {
    render(<ModelsStudio stats={{ models: [] } as any} />);
    expect(screen.getByText("No model telemetry yet")).toBeTruthy();
    expect(screen.getByText(/volume, latency, cache, and reasoning comparisons/i)).toBeTruthy();
  });

  it("tolerates snapshots without a models field", () => {
    render(<ModelsStudio stats={{} as any} />);
    expect(screen.getByText("No model telemetry yet")).toBeTruthy();
  });

  it("renders German model comparisons with locale formatting and verbatim model identifiers", () => {
    render(
      <StatsI18nProvider locale="de">
        <ModelsStudio stats={{ models: [model] } as any} />
      </StatsI18nProvider>,
    );

    expect(screen.getByText("Modellleistung und Effizienz")).toBeTruthy();
    expect(screen.getByText("Modellrangliste")).toBeTruthy();
    expect(screen.getAllByText("claude-opus-4-8").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("claude-opus-4-8, Rang 1 der Modellrangliste")).toBeTruthy();
    expect(screen.getAllByText(/55,41\s*\$/).length).toBeGreaterThan(0);
    expect(screen.getByText("Sortierung: Tokens absteigend")).toBeTruthy();
    expect(screen.getByText("$ / 1 Mio. Tok.")).toBeTruthy();
    expect(screen.getAllByText("Schlussfolgerung").length).toBeGreaterThan(0);
    expect(screen.getByText("Ausgabe / Eingabe")).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
    expect(screen.queryByText("Output / Input")).toBeNull();
  });
});
