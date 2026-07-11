export type TaskExecutionOutcome =
  | { kind: "completed"; blocker: null }
  | { kind: "blocked"; blocker: string }
  | { kind: "unknown"; blocker: null };

export const TASK_EXECUTION_OUTCOME_INSTRUCTIONS = [
  "## EXECUTION OUTCOME (Required)",
  "End the final response with exactly one outcome marker:",
  "- `CODE_UX_TASK_OUTCOME: completed` when the requested work is complete or legitimately requires no repository changes.",
  "- `CODE_UX_TASK_OUTCOME: blocked` when an external prerequisite, authorization, credential, or required input prevents the work.",
  "When blocked, add one following line: `CODE_UX_BLOCKER: <concise actionable reason>`.",
  "Do not report `completed` when the requested implementation was not performed.",
].join("\n");

const OUTCOME_PATTERN = /^CODE_UX_TASK_OUTCOME:\s*(completed|blocked)\s*$/im;
const BLOCKER_PATTERN = /^CODE_UX_BLOCKER:\s*(.+)\s*$/im;

export function parseTaskExecutionOutcome(text: string): TaskExecutionOutcome {
  const outcome = OUTCOME_PATTERN.exec(text)?.[1]?.toLowerCase();
  if (outcome === "completed") {
    return { kind: "completed", blocker: null };
  }
  if (outcome === "blocked") {
    const blocker = BLOCKER_PATTERN.exec(text)?.[1]?.trim();
    return {
      kind: "blocked",
      blocker: blocker || "The coding agent reported an external blocker without a specific reason.",
    };
  }
  return { kind: "unknown", blocker: null };
}

export function parseTaskExecutionOutcomeFromProviderOutput(input: {
  conversation?: Array<{ kind: string; text: string }>;
  text?: string;
  stdout?: string;
  stderr?: string;
}): TaskExecutionOutcome {
  const assistantText = input.conversation
    ? [...input.conversation].reverse().find((turn) => turn.kind === "assistant")?.text
    : undefined;
  if (assistantText !== undefined) {
    return parseTaskExecutionOutcome(assistantText);
  }
  return parseTaskExecutionOutcome(
    input.text?.trim()
      || [input.stdout, input.stderr].filter(Boolean).join("\n"),
  );
}
