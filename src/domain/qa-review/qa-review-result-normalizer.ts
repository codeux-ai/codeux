import { extractJsonFromText } from "../llm/json-extraction.js";
import type {
  NormalizedQaReviewResult,
  QaFollowUpTaskPayload,
  NormalizedQaFollowUpTask
} from "./qa-review-types.js";

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

  const verdict = payload.verdict;

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

export function normalizeFollowUpTask(value: unknown): NormalizedQaFollowUpTask | null {
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
  const priority = payload.priority === "critical" || payload.priority === "high" || payload.priority === "low"
    ? payload.priority
    : "medium";

  return {
    title,
    promptMarkdown,
    description,
    dependsOnTaskKeys,
    priority,
  };
}
