export type TaskExecutionOutcome =
  | { kind: "completed"; blocker: null }
  | { kind: "blocked"; blocker: string }
  | { kind: "unknown"; blocker: null };

export interface TaskCodingClarificationContext {
  projectId?: string | null;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  sessionId?: string | null;
}

export const TASK_EXECUTION_OUTCOME_INSTRUCTIONS = [
  "## EXECUTION OUTCOME (Required)",
  "End the final response with exactly one outcome marker:",
  "- `CODE_UX_TASK_OUTCOME: completed` when the requested work is complete or legitimately requires no repository changes.",
  "- `CODE_UX_TASK_OUTCOME: blocked` when an external prerequisite, authorization, credential, or required input prevents the work.",
  "When blocked, add one following line: `CODE_UX_BLOCKER: <concise actionable reason>`.",
  "Do not report `completed` when the requested implementation was not performed.",
].join("\n");

export function buildTaskCodingOutcomeInstructions(
  context: TaskCodingClarificationContext,
): string {
  const scope = Object.entries(context)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const contextLine = scope
    ? `Current clarification context: ${scope}. Pass the applicable IDs unchanged.`
    : "Use the current project and task identifiers supplied by the runtime when requesting clarification.";

  return [
    "## BLOCKING CLARIFICATIONS",
    "Before reporting this coding task as blocked because requirements are ambiguous or a project-manager decision or input is required, call `request_clarification`.",
    contextLine,
    "Use a stable, task-specific deduplication key. Ask one concise, actionable Markdown question that identifies the exact blocker, summarizes the evidence already checked, and states the decision or missing input needed; include viable options and tradeoffs when they help the project manager answer.",
    "Do not ask questions that repository evidence can answer. Do not call `reply_to_clarification`; coding agents can only request clarification.",
    "After recording the clarification request, report the task as blocked with the clarification id and a concise actionable reason.",
    "",
    TASK_EXECUTION_OUTCOME_INSTRUCTIONS,
  ].join("\n");
}

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
