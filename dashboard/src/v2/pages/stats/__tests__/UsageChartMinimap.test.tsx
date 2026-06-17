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
    expect(container.querySelector("[data-testid='usage-chart-minimap']")).toBeNull();
  });

  it("emits a zoom range after a drag selection", () => {
    const onZoomChange = vi.fn();
    const { getByTestId } = render(
      <UsageChartMinimap buckets={createBuckets(11)} zoomRange={null} onZoomChange={onZoomChange} />,
    );

    const strip = getByTestId("usage-chart-minimap") as HTMLElement;
    mockBoundingRect(strip);
    strip.setPointerCapture = vi.fn();

    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 });

    expect(onZoomChange).toHaveBeenCalledWith({ start: 2, end: 6 });
  });

  it("clears the zoom on a simple click", () => {
    const onZoomChange = vi.fn();
    const { getByTestId } = render(
      <UsageChartMinimap buckets={createBuckets(11)} zoomRange={{ start: 2, end: 6 }} onZoomChange={onZoomChange} />,
    );

    const strip = getByTestId("usage-chart-minimap") as HTMLElement;
    mockBoundingRect(strip);
    strip.setPointerCapture = vi.fn();

    fireEvent.pointerDown(strip, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 400, pointerId: 1 });

    expect(onZoomChange).toHaveBeenCalledWith(null);
  });

  it("shows the zoom window summary when zoomed", () => {
    const { container } = render(
      <UsageChartMinimap buckets={createBuckets(10)} zoomRange={{ start: 2, end: 5 }} onZoomChange={vi.fn()} />,
    );
    expect(container.textContent).toContain("4 of 10 buckets");
  });
});
