export interface AnimationLoopScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

/**
 * Run an animation on browser paint frames without continuously polling RAF.
 *
 * Some software-rendered and no-vsync environments resolve RAF callbacks as
 * quickly as the CPU allows. Waiting on a timer before requesting the next
 * frame keeps those environments bounded while preserving paint alignment.
 */
export const startPacedAnimationLoop = (
  renderFrame: FrameRequestCallback,
  framesPerSecond = 20,
  scheduler: AnimationLoopScheduler = window,
): (() => void) => {
  const frameInterval = 1000 / Math.max(1, framesPerSecond);
  let animationFrameId: number | null = null;
  let timerId: number | null = null;
  let stopped = false;

  const requestNextFrame = (): void => {
    if (stopped) return;
    animationFrameId = scheduler.requestAnimationFrame(runFrame);
  };

  const runFrame: FrameRequestCallback = (timestamp) => {
    animationFrameId = null;
    if (stopped) return;

    renderFrame(timestamp);
    timerId = scheduler.setTimeout(() => {
      timerId = null;
      requestNextFrame();
    }, frameInterval);
  };

  requestNextFrame();

  return () => {
    stopped = true;
    if (animationFrameId !== null) scheduler.cancelAnimationFrame(animationFrameId);
    if (timerId !== null) scheduler.clearTimeout(timerId);
  };
};
