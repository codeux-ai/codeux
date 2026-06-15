import type { TaskPriority } from "../../contracts/project-management-types.js";
export interface QaReviewResultPayload {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
  fixInstructions?: unknown;
  targetTaskKey?: unknown;
  shouldHavePr?: unknown;
  followUpTasks?: unknown;
}

export interface QaFollowUpTaskPayload {
  title?: unknown;
  promptMarkdown?: unknown;
  prompt?: unknown;
  description?: unknown;
  dependsOnTaskKeys?: unknown;
  priority?: unknown;
}

export interface NormalizedQaFollowUpTask {
  title: string;
  promptMarkdown: string;
  description: string | null;
  dependsOnTaskKeys: string[];
  priority: TaskPriority;
}

export interface NormalizedQaReviewResult {
  verdict: "pass" | "changes_requested";
  summary: string;
  findings: string[];
  fixInstructions: string | null;
  targetTaskKey: string | null;
  shouldHavePr: boolean | null;
  followUpTasks: NormalizedQaFollowUpTask[];
  raw: Record<string, unknown>;
}
export type QaReviewErrorCode =
  | 'API_TIMEOUT'
  | 'PARSE_FAILURE'
  | 'TRANSPORT_ERROR'
  | 'AUTH_FAILURE'
  | 'SCHEMA_VIOLATION'
  | 'UNKNOWN';

export class QaReviewError extends Error {
  constructor(
    public readonly code: QaReviewErrorCode,
    message: string,
    public readonly isRetryable: boolean,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = "QaReviewError";
  }
}

export function parseQaError(error: unknown): QaReviewError {
  if (error instanceof QaReviewError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  let code: QaReviewErrorCode = 'UNKNOWN';
  let isRetryable = false;

  if (
    lowerMessage.includes("json") ||
    lowerMessage.includes("validation") ||
    lowerMessage.includes("failed to extract valid json") ||
    lowerMessage.includes("must be 'pass'") ||
    lowerMessage.includes("must be a non-empty string") ||
    lowerMessage.includes("must be a json object")
  ) {
    code = 'PARSE_FAILURE';
    isRetryable = false;
  } else if (lowerMessage.includes("timeout")) {
    code = 'API_TIMEOUT';
    isRetryable = true;
  } else if (lowerMessage.includes("network") || lowerMessage.includes("fetch") || lowerMessage.includes("econnrefused")) {
    code = 'TRANSPORT_ERROR';
    isRetryable = true;
  } else if (lowerMessage.includes("unauthorized") || lowerMessage.includes("forbidden") || lowerMessage.includes("401") || lowerMessage.includes("403")) {
    code = 'AUTH_FAILURE';
    isRetryable = false;
  } else if (lowerMessage.includes("schema")) {
    code = 'SCHEMA_VIOLATION';
    isRetryable = false;
  }

  return new QaReviewError(
    code,
    message,
    isRetryable,
    error instanceof Error ? { name: error.name, stack: error.stack } : { raw: error }
  );
}
