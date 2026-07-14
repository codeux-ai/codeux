export type QaReviewFollowUpTaskPriority = "critical" | "high" | "medium" | "low";

export interface QaReviewFollowUpTask {
  title: string;
  promptMarkdown: string;
  description: string | null;
  dependsOnTaskKeys: string[];
  priority: QaReviewFollowUpTaskPriority;
}

/**
 * Backward-compatible QA metadata shared by Tasks, Sprints, and Live.
 *
 * The original fields remain required. Follow-up details are optional so rows
 * persisted before structured QA follow-ups remain readable without migration.
 */
export interface SprintReviewSummary {
  status: string;
  outcome: string | null;
  summary: string | null;
  findings: string[];
  reviewer: string | null;
  finishedAt: string | null;
  fixInstructions?: string;
  targetTaskKey?: string;
  followUpTasks?: QaReviewFollowUpTask[];
}
