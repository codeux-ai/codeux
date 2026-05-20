import { PlanningPayloadValidator, type PlanningPayloadValidatorOptions } from "./planning-payload-validator.js";
import type { PlannedSprintPayload } from "../contracts/project-management-types.js";
import { findAllJsonCandidates, type ExtractJsonResult, extractJsonFromText } from "../domain/llm/json-extraction.js";

export class PlanningParseError extends Error {
  constructor(message: string, public readonly attempts: number, public readonly rawContent: string) {
    super(message);
    this.name = "PlanningParseError";
    this.reason = message;
  }
  public readonly reason: string;
}


export function extractPlanningJsonFromText(text: string): ExtractJsonResult {
  const candidates = findAllJsonCandidates(text);

  let bestData: unknown = null;
  let bestSourceText = text;
  let bestScore = -1;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      let isPlanning = false;
      if (parsed && typeof parsed === "object") {
         if ("goal" in parsed && !("tasks" in parsed) && !("subtasks" in parsed) && Object.keys(parsed).length <= 2) isPlanning = true;
         if ("tasks" in parsed && Array.isArray(parsed.tasks)) isPlanning = true;
         if ("subtasks" in parsed && Array.isArray(parsed.subtasks)) isPlanning = true;
         if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && ("title" in parsed[0] || "description" in parsed[0] || "prompt" in parsed[0])) isPlanning = true;
      }

      if (isPlanning) {
        return { success: true, data: parsed, sourceText: candidate };
      }

      let foundPayload = null;
      const searchForPayload = (obj: any): any => {
        if (!obj || typeof obj !== "object") return null;

        let isPlanningLocal = false;
        if ("goal" in obj && !("tasks" in obj) && !("subtasks" in obj) && Object.keys(obj).length <= 2) isPlanningLocal = true;
        if ("tasks" in obj && Array.isArray(obj.tasks)) isPlanningLocal = true;
        if ("subtasks" in obj && Array.isArray(obj.subtasks)) isPlanningLocal = true;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object" && ("title" in obj[0] || "description" in obj[0] || "prompt" in obj[0])) isPlanningLocal = true;
        if (isPlanningLocal) return obj;

        const wrapperFields = ["response", "content", "message", "data", "text"];
        for (const field of wrapperFields) {
          if (field in obj) {
            const val = obj[field];
            if (typeof val === "string") {
              const innerTrimmed = val.trim();
              if (innerTrimmed.startsWith("{") || innerTrimmed.startsWith("[")) {
                try {
                  const parsedInner = JSON.parse(innerTrimmed);
                  const found = searchForPayload(parsedInner);
                  if (found) return found;
                } catch {}
              }
            } else if (typeof val === "object") {
              const found = searchForPayload(val);
              if (found) return found;
            }
          }
        }
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = searchForPayload(item);
            if (found) return found;
          }
        }
        return null;
      };

      foundPayload = searchForPayload(parsed);
      if (foundPayload) {
        if (bestScore < 2) {
          bestData = foundPayload;
          bestSourceText = candidate;
          bestScore = 2;
        }
        continue;
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as any).response === "string"
      ) {
        const inner = (parsed as any).response.trim();
        if (inner.startsWith("{") || inner.startsWith("[")) {
          try {
            const innerParsed = JSON.parse(inner);
            if (bestScore < 1) {
              bestData = innerParsed;
              bestSourceText = inner;
              bestScore = 1;
            }
            continue;
          } catch {}
        }
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as any).data) &&
        (parsed as any).data.length > 0 &&
        typeof (parsed as any).data[0].text === "string"
      ) {
        const inner = (parsed as any).data[0].text.trim();
        if (inner.startsWith("{") || inner.startsWith("[")) {
          try {
            const innerParsed = JSON.parse(inner);
            if (bestScore < 1) {
              bestData = innerParsed;
              bestSourceText = inner;
              bestScore = 1;
            }
            continue;
          } catch {}
        }
      }

      if (bestScore < 0) {
        bestData = parsed;
        bestSourceText = candidate;
        bestScore = 0;
      }
    } catch {
      // Ignored
    }
  }

  if (bestData !== null) {
      return { success: true, data: bestData, sourceText: bestSourceText };
  }

  return { success: false, error: new Error("Failed to extract valid JSON from text.") };
}

export function extractJsonLikeBlock(bodyMarkdown: string): string {
  const result = extractPlanningJsonFromText(bodyMarkdown);
  if (!result.success) {
    return bodyMarkdown.trim();
  }
  return JSON.stringify(result.data);
}

export function parsePlannedSprintReply(bodyMarkdown: string, options: PlanningPayloadValidatorOptions = {}): PlannedSprintPayload {
  const result = extractPlanningJsonFromText(bodyMarkdown);
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
    return validator.validate(payload, options);
  } catch (error) {
    throw new PlanningParseError(error instanceof Error ? error.message : String(error), 0, bodyMarkdown);
  }
}
