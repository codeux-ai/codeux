/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { useRouteProjectSelection } from "../use-route-project-selection.js";

describe("useRouteProjectSelection", () => {
  it("consumes a deep-linked project once and does not let a stale tab reclaim selection", async () => {
    let routeProjectId: string | null = "project-b";
    let selectedProjectId: string | null = "project-a";
    let resolveSelection: (() => void) | null = null;
    const selectProject = vi.fn(() => new Promise<void>((resolve) => {
      resolveSelection = resolve;
    }));

    const { result, rerender } = renderHook(() => useRouteProjectSelection(
      routeProjectId,
      selectedProjectId,
      selectProject,
    ));

    expect(result.current.routeProjectReady).toBe(false);
    await waitFor(() => expect(selectProject).toHaveBeenCalledTimes(1));
    selectedProjectId = "project-b";
    await act(async () => {
      resolveSelection?.();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.routeProjectReady).toBe(true);

    // Simulate another tab or page changing the shared selected project while
    // this mounted tab still has ?projectId=project-b in its URL.
    selectedProjectId = "project-c";
    rerender();

    expect(result.current.routeProjectReady).toBe(true);
    expect(selectProject).toHaveBeenCalledTimes(1);

    // A real route change remains actionable and is consumed once as well.
    routeProjectId = "project-d";
    rerender();
    expect(result.current.routeProjectReady).toBe(false);
    await waitFor(() => expect(selectProject).toHaveBeenCalledTimes(2));
  });

  it("does not dispatch when the deep-linked project is already selected", async () => {
    const selectProject = vi.fn(async () => undefined);
    const { result } = renderHook(() => useRouteProjectSelection(
      "project-a",
      "project-a",
      selectProject,
    ));

    expect(result.current.routeProjectReady).toBe(true);
    await act(async () => Promise.resolve());
    expect(selectProject).not.toHaveBeenCalled();
  });
});
