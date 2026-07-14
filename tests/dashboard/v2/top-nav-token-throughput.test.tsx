/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import type {
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputTotals,
  Sprint,
  Task,
} from "../../../dashboard/src/v2/types.js";
import { TelemetryStats } from "../../../dashboard/src/v2/components/top-nav/TelemetryStats.js";
import { useHeaderTokenThroughput } from "../../../dashboard/src/v2/hooks/use-header-token-throughput.js";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/hooks/use-header-token-throughput.js", () => ({
  useHeaderTokenThroughput: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-tasks.js", () => ({
  useProjectTasks: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/components/ui/RollingNumber.js", () => ({
  RollingNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

const makeTotals = (overrides: Partial<HeaderTokenThroughputTotals> = {}): HeaderTokenThroughputTotals => ({
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  invocationCount: 0,
  activeTimeMs: 0,
  tokensPerMinute: 0,
  ...overrides,
});

const makeSnapshot = (overrides: Partial<HeaderTokenThroughputSnapshot> = {}): HeaderTokenThroughputSnapshot => ({
  generatedAt: "2026-07-07T12:00:00.000Z",
  window: "20s",
  range: {
    window: "20s",
    label: "Last 20 seconds",
    resolution: "5sec",
    resolutionLabel: "5-second telemetry buckets",
    from: "2026-07-07T11:59:40.000Z",
    to: "2026-07-07T12:00:00.000Z",
    bucketCount: 4,
    isCustom: false,
  },
  app: makeTotals(),
  project: null,
  ...overrides,
});

const sprints: Sprint[] = [
  {
    id: "sprint-running",
    projectId: "project-1",
    name: "Running Sprint",
    number: 1,
    status: "running",
    createdAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T10:00:00.000Z",
  } as Sprint,
  {
    id: "sprint-idle",
    projectId: "project-1",
    name: "Idle Sprint",
    number: 2,
    status: "idle",
    createdAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T10:00:00.000Z",
  } as Sprint,
];

const tasks: Task[] = [
  { id: "T01", recordId: "task-1", sprintId: "sprint-running", status: "in_progress", title: "Running" } as Task,
  { id: "T02", recordId: "task-2", sprintId: "sprint-running", status: "pending", title: "Queued" } as Task,
  { id: "T03", recordId: "task-3", sprintId: "sprint-idle", status: "in_progress", title: "Ignored" } as Task,
];

function mockThroughput(overrides: {
  snapshot?: HeaderTokenThroughputSnapshot | null;
  loading?: boolean;
  error?: string | null;
}): void {
  vi.mocked(useHeaderTokenThroughput).mockReturnValue({
    snapshot: overrides.snapshot ?? null,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    refresh: vi.fn(),
  });
}

function countCurveSegments(path: string | null): number {
  return path?.match(/\bC\b/g)?.length ?? 0;
}

describe("TelemetryStats token throughput", () => {
  beforeEach(() => {
    vi.mocked(useProjectTasks).mockReturnValue({
      tasks,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    mockThroughput({
      snapshot: makeSnapshot({
        app: makeTotals({ totalTokens: 60000, invocationCount: 12, tokensPerMinute: 2400 }),
        project: {
          projectId: "project-1",
          projectName: "Project Alpha",
          ...makeTotals({ totalTokens: 9000, invocationCount: 4, tokensPerMinute: 450 }),
        },
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders app throughput as the primary header signal", () => {
    render(<TelemetryStats projectId="project-1" sprints={sprints} />);

    expect(screen.getByRole("group", { name: /2.4K tok\/min app throughput/i })).toBeInTheDocument();
    expect(screen.getByText("App")).toBeInTheDocument();
    expect(screen.getByText("2.4K")).toBeInTheDocument();
    expect(screen.queryByText("Project Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("450")).not.toBeInTheDocument();
    expect(screen.getByTestId("throughput-flux-app")).toHaveAttribute("data-direction", "flat");
    expect(countCurveSegments(screen.getByTestId("throughput-line-app").getAttribute("d"))).toBe(19);
    expect(screen.getByTestId("throughput-line-app")).toHaveAttribute("stroke-dashoffset", "0");
    expect(useHeaderTokenThroughput).toHaveBeenCalledWith(null, "20s");
  });

  it("animates the throughput strip upward when the next snapshot increases", async () => {
    const { rerender } = render(<TelemetryStats projectId="project-1" sprints={sprints} />);
    expect(screen.getByTestId("throughput-flux-app")).toHaveAttribute("data-direction", "flat");

    mockThroughput({
      snapshot: makeSnapshot({
        generatedAt: "2026-07-07T12:00:10.000Z",
        app: makeTotals({ totalTokens: 72000, invocationCount: 13, tokensPerMinute: 3200 }),
        project: {
          projectId: "project-1",
          projectName: "Project Alpha",
          ...makeTotals({ totalTokens: 9400, invocationCount: 4, tokensPerMinute: 420 }),
        },
      }),
    });

    rerender(<TelemetryStats projectId="project-1" sprints={sprints} />);

    await waitFor(() => {
      expect(screen.getByTestId("throughput-flux-app")).toHaveAttribute("data-direction", "up");
    });
    expect(screen.getByTestId("throughput-line-app")).toHaveAttribute("stroke", "#00E0A0");
  });

  it("keeps the throughput line green while the shape moves downward", async () => {
    const { rerender } = render(<TelemetryStats projectId="project-1" sprints={sprints} />);

    mockThroughput({
      snapshot: makeSnapshot({
        generatedAt: "2026-07-07T12:00:10.000Z",
        app: makeTotals({ totalTokens: 61000, invocationCount: 13, tokensPerMinute: 1400 }),
      }),
    });

    rerender(<TelemetryStats projectId="project-1" sprints={sprints} />);

    await waitFor(() => {
      expect(screen.getByTestId("throughput-flux-app")).toHaveAttribute("data-direction", "down");
    });
    expect(screen.getByTestId("throughput-line-app")).toHaveAttribute("stroke", "#00E0A0");
  });

  it("preserves running and queued counts for active running sprints only", () => {
    render(<TelemetryStats projectId="project-1" sprints={sprints} />);

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(useProjectTasks).toHaveBeenCalledWith("project-1", [], sprints, null, {
      enabled: true,
      view: "overview",
    });
  });

  it("keeps loading and empty throughput states stable", () => {
    mockThroughput({ snapshot: null, loading: true });
    const { rerender } = render(<TelemetryStats projectId="project-1" sprints={sprints} />);

    expect(screen.getByRole("group", { name: /Loading token telemetry/i })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(2);

    mockThroughput({ snapshot: makeSnapshot(), loading: false });
    rerender(<TelemetryStats projectId="project-1" sprints={sprints} />);

    expect(screen.getByRole("group", { name: /No app token telemetry in this window/i })).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText("No project tokens in this window")).not.toBeInTheDocument();
  });

  it("renders an error state without hiding task counts", () => {
    mockThroughput({ snapshot: null, error: "Request failed" });
    render(<TelemetryStats projectId="project-1" sprints={sprints} />);

    expect(screen.getByRole("group", { name: /Token telemetry unavailable/i })).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });
});
