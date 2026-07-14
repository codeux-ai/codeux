/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCinematicWorkTool, type UseCinematicWorkToolOptions } from "../../../dashboard/src/v2/components/chat/cinematic/use-cinematic-work-tool.js";
import { AGENT_SCENE_TOOL_IDS } from "../../../dashboard/src/v2/lib/agent-scene-tools.js";

const baseOptions: UseCinematicWorkToolOptions = {
  active: false,
  activityKey: "invocation-alpha",
  reducedMotion: false,
};

describe("useCinematicWorkTool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/chat");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("selects a deterministic catalog tool immediately when activity becomes active", () => {
    const { result, rerender, unmount } = renderHook(
      (props: UseCinematicWorkToolOptions) => useCinematicWorkTool(props),
      { initialProps: baseOptions },
    );
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    rerender({ ...baseOptions, active: true });
    const firstSelection = result.current;
    expect(AGENT_SCENE_TOOL_IDS).toContain(firstSelection);
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    const repeatedActivity = renderHook(() => useCinematicWorkTool({ ...baseOptions, active: true }));
    expect(repeatedActivity.result.current).toBe(firstSelection);
  });

  it("rotates at the seven-second cadence without immediately repeating a tool", () => {
    const { result } = renderHook(() => useCinematicWorkTool({ ...baseOptions, active: true }));
    const initialTool = result.current;

    act(() => vi.advanceTimersByTime(6_999));
    expect(result.current).toBe(initialTool);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).not.toBe(initialTool);
    expect(AGENT_SCENE_TOOL_IDS).toContain(result.current);
  });

  it("keeps one identifiable tool static in reduced-motion mode", () => {
    const { result } = renderHook(() => useCinematicWorkTool({
      ...baseOptions,
      active: true,
      reducedMotion: true,
    }));
    const staticTool = result.current;

    expect(AGENT_SCENE_TOOL_IDS).toContain(staticTool);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(21_000));
    expect(result.current).toBe(staticTool);
  });

  it("gives validated stageTool overrides precedence and ignores unknown identifiers", () => {
    window.history.replaceState({}, "", "/chat?stageTool=torch");
    const { result, rerender } = renderHook(
      (props: UseCinematicWorkToolOptions) => useCinematicWorkTool(props),
      { initialProps: baseOptions },
    );

    expect(result.current).toBe("torch");
    expect(vi.getTimerCount()).toBe(0);

    window.history.replaceState({}, "", "/chat?stageTool=laser");
    rerender({ ...baseOptions, active: true });
    expect(AGENT_SCENE_TOOL_IDS).toContain(result.current);
    expect(result.current).not.toBe("laser");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("reinitializes predictably when the active activity is replaced", () => {
    const { result, rerender, unmount } = renderHook(
      (props: UseCinematicWorkToolOptions) => useCinematicWorkTool(props),
      { initialProps: { ...baseOptions, active: true } },
    );
    act(() => vi.advanceTimersByTime(7_000));

    rerender({ ...baseOptions, active: true, activityKey: "invocation-beta" });
    const replacementTool = result.current;
    expect(AGENT_SCENE_TOOL_IDS).toContain(replacementTool);
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    const repeatedReplacement = renderHook(() => useCinematicWorkTool({
      ...baseOptions,
      active: true,
      activityKey: "invocation-beta",
    }));
    expect(repeatedReplacement.result.current).toBe(replacementTool);
  });

  it("clears intervals on deactivation, activity and override changes, and unmount", () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { rerender, unmount } = renderHook(
      (props: UseCinematicWorkToolOptions) => useCinematicWorkTool(props),
      { initialProps: { ...baseOptions, active: true } },
    );
    expect(vi.getTimerCount()).toBe(1);

    rerender({ ...baseOptions, active: false });
    expect(vi.getTimerCount()).toBe(0);

    rerender({ ...baseOptions, active: true });
    rerender({ ...baseOptions, active: true, activityKey: "invocation-beta" });
    expect(vi.getTimerCount()).toBe(1);

    window.history.replaceState({}, "", "/chat?stageTool=wrench");
    rerender({ ...baseOptions, active: true, activityKey: "invocation-beta" });
    expect(vi.getTimerCount()).toBe(0);

    window.history.replaceState({}, "", "/chat");
    rerender({ ...baseOptions, active: true, activityKey: "invocation-beta" });
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(4);
  });
});
