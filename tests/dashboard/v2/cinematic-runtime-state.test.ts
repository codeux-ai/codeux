import { describe, expect, it } from "vitest";
import { classifyCinematicRuntimeState } from "../../../dashboard/src/v2/lib/cinematic-runtime-state.js";
import type { ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

type TestInvocation = Pick<ExecutionInvocationRecord, "agentPresetId" | "status" | "type">;

const invocation = (overrides: Partial<TestInvocation> = {}): TestInvocation => ({
  agentPresetId: "pm-agent",
  status: "running",
  type: "dashboard_reply",
  ...overrides,
});

describe("classifyCinematicRuntimeState", () => {
  it("treats an awaited reply in the selected thread as Project Manager activity", () => {
    expect(classifyCinematicRuntimeState({
      hasAwaitedReply: true,
      invocations: [],
      projectManagerAgentPresetId: "pm-agent",
    })).toEqual({
      projectManagerActive: true,
      backgroundActivityCount: 0,
    });
  });

  it.each(["dashboard_reply", "worker_reply"])(
    "treats a running matching %s invocation as Project Manager activity",
    (type) => {
      expect(classifyCinematicRuntimeState({
        hasAwaitedReply: false,
        invocations: [invocation({ type })],
        projectManagerAgentPresetId: "pm-agent",
      })).toEqual({
        projectManagerActive: true,
        backgroundActivityCount: 0,
      });
    },
  );

  it("keeps another agent's running reply invocation in background activity", () => {
    expect(classifyCinematicRuntimeState({
      hasAwaitedReply: false,
      invocations: [invocation({ agentPresetId: "worker-agent" })],
      projectManagerAgentPresetId: "pm-agent",
    })).toEqual({
      projectManagerActive: false,
      backgroundActivityCount: 1,
    });
  });

  it("does not treat arbitrary work by the Project Manager agent as a dashboard reply", () => {
    expect(classifyCinematicRuntimeState({
      hasAwaitedReply: false,
      invocations: [
        invocation({ type: "task_coding" }),
        invocation({ type: "dashboard_reply", status: "completed" }),
      ],
      projectManagerAgentPresetId: "pm-agent",
    })).toEqual({
      projectManagerActive: false,
      backgroundActivityCount: 1,
    });
  });

  it("keeps active reply work in the background when no stage agent resolves", () => {
    expect(classifyCinematicRuntimeState({
      hasAwaitedReply: false,
      invocations: [invocation()],
      projectManagerAgentPresetId: null,
    })).toEqual({
      projectManagerActive: false,
      backgroundActivityCount: 1,
    });
  });
});
