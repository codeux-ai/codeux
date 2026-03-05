export enum WatchLoopState {
  RUNNING = "RUNNING",
  CHECKPOINT = "CHECKPOINT",
  FINISHED = "FINISHED",
}

export interface WatchLoopContext {
  allFinished: boolean;
  outputIntervalReached: boolean;
}

export function determineNextState(context: WatchLoopContext): WatchLoopState {
  if (context.allFinished) {
    return WatchLoopState.FINISHED;
  }
  if (context.outputIntervalReached) {
    return WatchLoopState.CHECKPOINT;
  }
  return WatchLoopState.RUNNING;
}
