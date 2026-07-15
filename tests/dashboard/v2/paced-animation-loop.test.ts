import { describe, expect, it, vi } from "vitest";
import {
  startPacedAnimationLoop,
  type AnimationLoopScheduler,
} from "../../../dashboard/src/v2/lib/paced-animation-loop.js";

const createScheduler = () => {
  const animationFrames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const scheduler: AnimationLoopScheduler = {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      animationFrames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      animationFrames.delete(id);
    }),
    setTimeout: vi.fn((callback: () => void) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      timers.delete(id);
    }),
  };

  return { scheduler, animationFrames, timers };
};

describe("startPacedAnimationLoop", () => {
  it("waits for the frame interval before requesting the next paint frame", () => {
    const { scheduler, animationFrames, timers } = createScheduler();
    const renderFrame = vi.fn();

    const stop = startPacedAnimationLoop(renderFrame, 20, scheduler);
    expect(animationFrames.size).toBe(1);

    const firstFrame = [...animationFrames.values()][0]!;
    animationFrames.clear();
    firstFrame(100);

    expect(renderFrame).toHaveBeenCalledWith(100);
    expect(animationFrames.size).toBe(0);
    expect(timers.size).toBe(1);
    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 50);

    const intervalElapsed = [...timers.values()][0]!;
    timers.clear();
    intervalElapsed();
    expect(animationFrames.size).toBe(1);

    stop();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(animationFrames.size).toBe(0);
  });

  it("cancels a pending timer and never schedules another frame", () => {
    const { scheduler, animationFrames, timers } = createScheduler();
    const stop = startPacedAnimationLoop(vi.fn(), 20, scheduler);

    const firstFrame = [...animationFrames.values()][0]!;
    animationFrames.clear();
    firstFrame(100);
    expect(timers.size).toBe(1);

    stop();
    expect(scheduler.clearTimeout).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });
});
