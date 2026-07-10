/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import type { ExecutionUsageBucketSummary } from "../../../types.js";
import { UsageChartMinimap } from "../components/UsageChartMinimap.js";

afterEach(() => {
  cleanup();
});

function createBuckets(count: number): ExecutionUsageBucketSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    bucketStart: `2026-06-0${(index % 9) + 1}T00:00:00.000Z`,
    bucketEnd: `2026-06-0${(index % 9) + 1}T01:00:00.000Z`,
    label: `b${index}`,
    usage: {
      invocationCount: index,
      activeTimeMs: 0,
      wallTimeMs: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: index * 100,
      reportedInvocationCount: 0,
      estimatedInvocationCount: 0,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0,
    },
  }));
}

function createDailyBuckets(labels: string[]): ExecutionUsageBucketSummary[] {
  return labels.map((label, index) => ({
    bucketStart: `2026-06-${String(index + 27).padStart(2, "0")}T00:00:00.000Z`,
    bucketEnd: `2026-06-${String(index + 28).padStart(2, "0")}T00:00:00.000Z`,
    label,
    usage: {
      invocationCount: index,
      activeTimeMs: 0,
      wallTimeMs: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: index * 100,
      reportedInvocationCount: 0,
      estimatedInvocationCount: 0,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      cachedInputCostUsd: 0,
      totalCostUsd: 0,
    },
  }));
}

function mockBoundingRect(element: HTMLElement, width = 1000) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 72,
    width,
    height: 72,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("UsageChartMinimap", () => {
  it("renders nothing with fewer than two buckets", () => {
    const { container } = render(
      <UsageChartMinimap buckets={createBuckets(1)} zoomRange={null} onZoomChange={vi.fn()} />,
    );
    const strip = container.querySelector("[data-testid='usage-chart-minimap']");
    expect(strip).toBeTruthy();
    expect(strip?.getAttribute("aria-label")).toBe("Chart minimap zoom region, full range of 1 bucket");
    expect(strip?.getAttribute("aria-describedby")).toBe("usage-chart-minimap-help");
    expect(strip?.getAttribute("aria-disabled")).toBe("true");
    expect(strip?.textContent).toContain("Zoom becomes available after the next bucket lands.");
  });

  it("emits a zoom range after a drag selection", () => {
    const onZoomChange = vi.fn();
    const onStatusChange = vi.fn();
    const { getByTestId } = render(
      <UsageChartMinimap buckets={createBuckets(11)} zoomRange={null} onZoomChange={onZoomChange} onStatusChange={onStatusChange} />,
    );

    const strip = getByTestId("usage-chart-minimap") as HTMLElement;
    mockBoundingRect(strip);
    strip.setPointerCapture = vi.fn();

    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 });

    expect(onZoomChange).toHaveBeenCalledWith({ start: 2, end: 6 });
    expect(onStatusChange).toHaveBeenCalledWith("Zoomed overview to b2 through b6, 5 of 11 buckets.");
  });

  it("clears the zoom on a simple click", () => {
    const onZoomChange = vi.fn();
    const onStatusChange = vi.fn();
    const { getByTestId } = render(
      <UsageChartMinimap buckets={createBuckets(11)} zoomRange={{ start: 2, end: 6 }} onZoomChange={onZoomChange} onStatusChange={onStatusChange} />,
    );

    const strip = getByTestId("usage-chart-minimap") as HTMLElement;
    mockBoundingRect(strip);
    strip.setPointerCapture = vi.fn();

    fireEvent.pointerDown(strip, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 400, pointerId: 1 });

    expect(onZoomChange).toHaveBeenCalledWith(null);
    expect(onStatusChange).toHaveBeenCalledWith("Zoom reset to the full 11-bucket range.");
  });

  it("announces keyboard pan and reset actions", () => {
    const onZoomChange = vi.fn();
    const onStatusChange = vi.fn();
    const { getByTestId } = render(
      <UsageChartMinimap buckets={createBuckets(11)} zoomRange={{ start: 2, end: 6 }} onZoomChange={onZoomChange} onStatusChange={onStatusChange} />,
    );

    const strip = getByTestId("usage-chart-minimap") as HTMLElement;

    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onZoomChange).toHaveBeenCalledWith({ start: 3, end: 7 });
    expect(onStatusChange).toHaveBeenCalledWith("Zoomed overview to b3 through b7, 5 of 11 buckets.");

    fireEvent.keyDown(strip, { key: "Escape" });
    expect(onZoomChange).toHaveBeenCalledWith(null);
    expect(onStatusChange).toHaveBeenCalledWith("Zoom reset to the full 11-bucket range.");
  });

  it("shows the zoom window summary when zoomed", () => {
    const { container } = render(
      <UsageChartMinimap buckets={createBuckets(10)} zoomRange={{ start: 2, end: 5 }} onZoomChange={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='usage-chart-minimap']")?.getAttribute("aria-label"))
      .toBe("Chart minimap zoom region, showing buckets 3 through 6 of 10");
    expect(container.textContent).toContain("4 of 10 buckets");
  });

  it("shows compact bucket labels for short daily windows", () => {
    const labels = ["Jun 27", "Jun 28", "Jun 29", "Jun 30", "Jul 1", "Jul 2", "Jul 3"];
    const { container } = render(
      <UsageChartMinimap buckets={createDailyBuckets(labels)} zoomRange={null} onZoomChange={vi.fn()} />,
    );

    expect(container.textContent).toContain("Overview - drag to zoom, arrow keys to pan, escape to reset");
    for (const label of labels) {
      expect(container.textContent).toContain(label);
    }
  });

  it("contains dense bucket sets without rendering a wide visible label grid", () => {
    const { getByTestId, container } = render(
      <UsageChartMinimap buckets={createBuckets(40)} zoomRange={null} onZoomChange={vi.fn()} />,
    );

    expect(getByTestId("usage-chart-minimap").classList.contains("overflow-hidden")).toBe(true);
    expect(container.querySelector('[style*="grid-template-columns"]')).toBeNull();
  });
});
