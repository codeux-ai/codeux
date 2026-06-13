import { extractJsonFromText } from "../llm/json-extraction.js";
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

/**
 * Normalizes and validates the raw text response from a QA review agent.
 * Extracts JSON, ensures required fields are present, and coerces types.
 */
export function normalizeQaReviewResult(bodyMarkdown: string): NormalizedQaReviewResult {
  const extraction = extractJsonFromText(bodyMarkdown);
  if (!extraction.success) {
    throw new Error(`Invalid JSON format: ${(extraction as any).error?.message || "Unknown error"}`);
  }

  const parsed = extraction.data;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Result must be a JSON object.");
  }

  const payload = parsed as Record<string, unknown>;

  if (payload.verdict !== "pass" && payload.verdict !== "changes_requested") {
    throw new Error("Missing or invalid 'verdict'. Must be 'pass' or 'changes_requested'.");
  }

  const verdict = payload.verdict as "pass" | "changes_requested";

  if (typeof payload.summary !== "string" || payload.summary.trim() === "") {
    throw new Error("Missing or invalid 'summary'. Must be a non-empty string.");
  }

  const summary = payload.summary.trim();

  const findings = Array.isArray(payload.findings)
    ? payload.findings.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const fixInstructions = typeof payload.fixInstructions === "string" && payload.fixInstructions.trim().length > 0
    ? payload.fixInstructions.trim()
    : null;
  const targetTaskKey = typeof payload.targetTaskKey === "string" && payload.targetTaskKey.trim().length > 0
    ? payload.targetTaskKey.trim()
    : null;
  const shouldHavePr = typeof payload.shouldHavePr === "boolean" ? payload.shouldHavePr : null;
  const followUpTasks = Array.isArray(payload.followUpTasks)
    ? payload.followUpTasks
      .map((entry) => normalizeFollowUpTask(entry))
      .filter((entry): entry is NormalizedQaFollowUpTask => entry !== null)
    : [];

  return {
    verdict,
    summary,
    findings,
    fixInstructions,
    targetTaskKey,
    shouldHavePr,
    followUpTasks,
    raw: payload,
  };
}

function normalizeFollowUpTask(value: unknown): NormalizedQaFollowUpTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as QaFollowUpTaskPayload;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const promptMarkdown = typeof payload.promptMarkdown === "string"
    ? payload.promptMarkdown.trim()
    : typeof payload.prompt === "string"
      ? payload.prompt.trim()
      : "";
  if (!title || !promptMarkdown) {
    return null;
  }

  const description = typeof payload.description === "string" && payload.description.trim().length > 0
    ? payload.description.trim()
    : null;
  const dependsOnTaskKeys = Array.isArray(payload.dependsOnTaskKeys)
    ? payload.dependsOnTaskKeys.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  
  // Normalize priority to known TaskPriority values, defaulting to "medium"
  let priority: TaskPriority = "medium";
  if (typeof payload.priority === "string") {
    const p = payload.priority.toLowerCase();
    if (p === "critical" || p === "high" || p === "medium" || p === "low") {
      priority = p as TaskPriority;
    }
  }

  return {
    title,
    promptMarkdown,
    description,
    dependsOnTaskKeys,
    priority,
  };
}
