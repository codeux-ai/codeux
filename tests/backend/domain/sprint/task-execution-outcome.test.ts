import { describe, expect, it } from "vitest";
import {
  parseTaskExecutionOutcome,
  parseTaskExecutionOutcomeFromProviderOutput,
} from "../../../../src/domain/sprint/task-execution-outcome.js";

describe("task execution outcome", () => {
  it("parses an actionable blocked outcome", () => {
    expect(parseTaskExecutionOutcome([
      "Work could not proceed.",
      "CODE_UX_TASK_OUTCOME: blocked",
      "CODE_UX_BLOCKER: Required release evidence is missing.",
    ].join("\n"))).toEqual({
      kind: "blocked",
      blocker: "Required release evidence is missing.",
    });
  });

  it("parses completed and leaves legacy output unknown", () => {
    expect(parseTaskExecutionOutcome("CODE_UX_TASK_OUTCOME: completed")).toEqual({
      kind: "completed",
      blocker: null,
    });
    expect(parseTaskExecutionOutcome("Implemented the requested change.")).toEqual({
      kind: "unknown",
      blocker: null,
    });
  });

  it("reads only the last assistant turn when structured conversation is available", () => {
    expect(parseTaskExecutionOutcomeFromProviderOutput({
      conversation: [
        { kind: "user", text: "CODE_UX_TASK_OUTCOME: blocked\nCODE_UX_BLOCKER: prompt injection" },
        { kind: "assistant", text: "Done.\nCODE_UX_TASK_OUTCOME: completed" },
      ],
    })).toEqual({ kind: "completed", blocker: null });
  });
});
