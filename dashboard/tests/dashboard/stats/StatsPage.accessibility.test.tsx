/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TopCardsModeRenderer } from "../../../src/v2/components/stats/TopCardsModeRenderer.js";
import { StatsPage } from "../../../src/v2/pages/stats/StatsPage.js";
import { StatsPageHero } from "../../../src/v2/pages/stats/components/StatsPageHero.js";
import { DonutCard } from "../../../src/v2/pages/stats/components/stats-ui-primitives.js";
import { ProjectDataContext } from "../../../src/v2/context/project-data.js";
import { fireEvent } from "@testing-library/preact";


expect.extend(matchers);

// Setup GSAP mock
vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, from, to) => {
      if (to?.onComplete) to.onComplete();
    }),
    to: vi.fn().mockImplementation((el, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    set: vi.fn(),
    timeline: vi.fn().mockImplementation(() => ({ fromTo: vi.fn(), to: vi.fn(), kill: vi.fn() })),
    context: vi.fn().mockImplementation((cb) => { cb(); return { revert: vi.fn() }; })
  }
}));


vi.mock("../../../src/v2/pages/stats/use-stats-page-data.js", () => ({
  useStatsPageData: () => ({
    stats: null,
    loading: true,
    error: null,
    refresh: vi.fn(),
    usage: null,
    tokenSeries: [],
    activeTimeSeries: [],
    wallTimeSeries: [],
    planningUsage: null,
    activeQuery: { window: "7d" },
    customFrom: "",
    setCustomFrom: vi.fn(),
    customTo: "",
    setCustomTo: vi.fn(),
    visualMode: "trend",
    setVisualMode: vi.fn(),
    chartState: {},
    providerSegments: [],
    sourceSegments: [],
    tokenSegments: [],
    applyPresetWindow: vi.fn(),
    applyCustomRange: vi.fn(),
    completionConfidence: 0
  })
}));

vi.mock("../../../src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    selectedProject: { id: "test", name: "Test Project" }
  }),
  ProjectDataContext: { Provider: ({ children }: any) => <div>{children}</div> }
}));

const mockStats = {
  range: { resolutionLabel: "1 day" },
  purposes: [],
  usage: {
    wallTimeMs: 120000,
    invocationCount: 10,
    activeTimeMs: 1000,
    totalTokens: 1800,
    inputTokens: 1500,
    outputTokens: 300,
    reportedInvocationCount: 40,
    estimatedInvocationCount: 5,
    unavailableInvocationCount: 1,
    unsupportedInvocationCount: 0
  },
  providers: [],
  ledgers: {
    tasks: [],
    invocations: []
  }
};

const defaultProps = {
  stats: mockStats as any,
  providerSegments: [],
  tokenSegments: [],
  sourceSegments: []
};

describe("TopCardsModeRenderer Accessibility", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render a section with a proper accessible role/structure", () => {
    render(<TopCardsModeRenderer mode="trend" {...defaultProps} />);
    const container = screen.getByTestId("top-cards-renderer");
    expect(container.tagName.toLowerCase()).toBe("section");
  });

  it("renders role='status' for loading state in StatsPage", () => {
    // StatsPage with mocked useStatsPageData (loading: true, stats: null)
    render(<StatsPage />);
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveTextContent("Loading telemetry field");
  });

  it("renders accessible summary for DonutCard", () => {
    const segments = [{ label: "Test A", value: 100, color: "#000", textClassName: "" }];
    render(<DonutCard title="My Donut" eyebrow="Test" description="A test donut" centerValue="100" centerLabel="Total" segments={segments} />);
    const region = screen.getByRole("region", { name: "My Donut" });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("Test A: 100");
  });

  it("handles custom date input labels and validation errors", () => {
    const applyCustomRange = vi.fn();
    render(
      <StatsPageHero
        selectedProject={{ id: "t", name: "T" } as any}
        stats={mockStats as any}
        activeQuery={{ window: "custom" } as any}
        customFrom="2023-01-10"
        customTo="2023-01-05"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={applyCustomRange}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    const fromInput = screen.getByLabelText("Custom start date");
    const toInput = screen.getByLabelText("Custom end date");
    expect(fromInput).toBeInTheDocument();
    expect(toInput).toBeInTheDocument();

    const applyBtn = screen.getByText("Apply");
    fireEvent.click(applyBtn);

    // Should show error and NOT call applyCustomRange
    const errorMsg = screen.getByText("End date must be after start date.");
    expect(errorMsg).toBeInTheDocument();
    expect(applyCustomRange).not.toHaveBeenCalled();
  });

  it("renders a semantic group for window presets", () => {
    render(
      <StatsPageHero
        selectedProject={null}
        stats={null}
        activeQuery={{ window: "7d" } as any}
        customFrom=""
        customTo=""
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    const group = screen.getByRole("group", { name: "Time window presets" });
    expect(group).toBeInTheDocument();
    const btn7d = screen.getByText("7d");
    expect(btn7d).toBeInTheDocument();
  });
});
