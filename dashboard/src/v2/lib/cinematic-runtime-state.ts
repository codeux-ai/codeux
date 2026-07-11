import type { ExecutionInvocationRecord } from "../types.js";

type CinematicInvocation = Pick<
  ExecutionInvocationRecord,
  "agentPresetId" | "status" | "type"
>;

export interface CinematicRuntimeStateInput {
  hasAwaitedReply: boolean;
  invocations: readonly CinematicInvocation[];
  projectManagerAgentPresetId: string | null | undefined;
}

export interface CinematicRuntimeState {
  projectManagerActive: boolean;
  backgroundActivityCount: number;
}

const isActiveInvocation = (invocation: CinematicInvocation): boolean => (
  invocation.status === "running"
);

const isProjectManagerInvocation = (
  invocation: CinematicInvocation,
  projectManagerAgentPresetId: string | null | undefined,
): boolean => Boolean(
  projectManagerAgentPresetId
    && invocation.agentPresetId === projectManagerAgentPresetId
    && (invocation.type === "dashboard_reply" || invocation.type === "worker_reply")
);

/**
 * Separates the selected thread's Project Manager work from unrelated project
 * execution. Only active reply invocations owned by the resolved stage agent
 * can move the cinematic stage into its working state.
 */
export const classifyCinematicRuntimeState = (
  input: CinematicRuntimeStateInput,
): CinematicRuntimeState => {
  let projectManagerInvocationActive = false;
  let backgroundActivityCount = 0;

  for (const invocation of input.invocations) {
    if (!isActiveInvocation(invocation)) {
      continue;
    }
    if (isProjectManagerInvocation(invocation, input.projectManagerAgentPresetId)) {
      projectManagerInvocationActive = true;
    } else {
      backgroundActivityCount += 1;
    }
  }

  return {
    projectManagerActive: input.hasAwaitedReply || projectManagerInvocationActive,
    backgroundActivityCount,
  };
};
