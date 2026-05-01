import { PlanningPayloadValidator } from "./planning-payload-validator.js";
import type { PlannedSprintPayload } from "../contracts/project-management-types.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";

export class PlanningParseError extends Error {
  constructor(message: string, public readonly attempts: number, public readonly rawContent: string) {
    super(message);
    this.name = "PlanningParseError";
    this.reason = message;
  }
  public readonly reason: string;
}

export function extractJsonLikeBlock(bodyMarkdown: string): string {
  const result = extractJsonFromText(bodyMarkdown);
  if (!result.success) {
    return bodyMarkdown.trim();
  }
  return JSON.stringify(result.data);
}

export function parsePlannedSprintReply(bodyMarkdown: string): PlannedSprintPayload {
  const result = extractJsonFromText(bodyMarkdown);
  if (!result.success) {
    throw new PlanningParseError("Planning agent reply was not valid JSON.", 0, bodyMarkdown);
  }
  let payload: any = result.data;

  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as any).response === "string"
  ) {
    const inner = (payload as any).response.trim();
    if (inner.startsWith("{") || inner.startsWith("[")) {
      try {
        payload = JSON.parse(inner);
      } catch {}
    }
  }

  const validator = new PlanningPayloadValidator();
  try {
    return validator.validate(payload);
  } catch (error) {
    throw new PlanningParseError(error instanceof Error ? error.message : String(error), 0, bodyMarkdown);
  }
}
