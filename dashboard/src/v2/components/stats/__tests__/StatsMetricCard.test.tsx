/** @vitest-environment jsdom */
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsMetricCard } from "../StatsMetricCard.js";
import { STATS_COLORS } from "../../../lib/stats/color-tokens.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-reduced-motion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/use-reduced-motion.js")>()),
  useReducedMotion: () => true,
}));

afterEach(() => {
  cleanup();
});

describe("StatsMetricCard", () => {
  it("keeps long metric content visible and exposes a stable accessible article name", () => {
    const label = "Exceptionally Long Provider Throughput Metric";
    const value = "provider/model-name-with-an-uninterrupted-value-1234567890";
    const detail = "Long supporting telemetry copy that must wrap without widening the dashboard page";
    const secondaryDetail = "Reported by a provider with a very long operational identifier";
    const qualityHint = "Estimated telemetry mix";

    render(
      <StatsMetricCard
        label={label}
        value={value}
        detail={detail}
        secondaryDetail={secondaryDetail}
        qualityHint={qualityHint}
        accentHex={STATS_COLORS.signal}
        sparkline={[2, 8, 5]}
        signalLabel="Throughput"
      />,
    );

    const card = screen.getByRole("article", { name: `${label}: ${value}: ${detail}` });
    expect(card).toHaveClass("min-w-0", "max-w-full");
    expect(card).toHaveTextContent(secondaryDetail);
    expect(card).toHaveTextContent(qualityHint);
    expect(screen.getByRole("img", { name: `${label} throughput sparkline across the selected window. 3 points; high 8; low 2.` })).toHaveAttribute("data-reduced-motion", "true");
  });

  it("uses an explicit accessible empty state when a metric has no sparkline data", () => {
    render(
      <StatsMetricCard
        label="Cache Rate"
        value="—"
        detail="No prompt-token telemetry"
        accentHex={STATS_COLORS.amber}
        signalLabel="Efficiency"
      />,
    );

    expect(screen.getByRole("img", { name: "Cache Rate has no efficiency sparkline data for the selected window." })).toHaveTextContent("No sparkline data");
  });
});
