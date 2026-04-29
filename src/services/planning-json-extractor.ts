import { PlanningPayloadValidator, type PlannedSprintPayload } from "./planning-payload-validator.js";
export function extractJsonLikeBlock(bodyMarkdown: string): string {
  const trimmed = bodyMarkdown.trim();

  // Strategy 1: Look for a fenced code block whose content looks like JSON.
  // Skip fenced blocks that capture code examples inside JSON string values
  // (e.g. ```ts ... ``` embedded in promptMarkdown fields).
  const fenceRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  let fencedMatch: RegExpExecArray | null;
  const fencedCandidates: string[] = [];
  while ((fencedMatch = fenceRegex.exec(trimmed)) !== null) {
    const fencedContent = fencedMatch[1]?.trim();
    if (fencedContent && (fencedContent.startsWith("{") || fencedContent.startsWith("["))) {
      fencedCandidates.push(fencedContent);
    }
  }

  // Helper to check if a parsed object looks like a planning payload.
  const isPlanningPayload = (parsed: any): boolean => {
    if (!parsed) return false;
    if (typeof parsed !== "object") return false;

    // Direct improve prompt result
    if ("goal" in parsed && !("tasks" in parsed) && !("subtasks" in parsed) && Object.keys(parsed).length <= 2) {
      return true;
    }

    // Direct plan result
    if ("tasks" in parsed && Array.isArray(parsed.tasks)) return true;
    if ("subtasks" in parsed && Array.isArray(parsed.subtasks)) return true;

    // Top-level array of tasks
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      if (first && typeof first === "object" && ("title" in first || "description" in first || "prompt" in first)) {
        return true;
      }
    }

    return false;
  };

  // Helper to recursively search an object for a planning payload
  const searchForPayload = (obj: any): any => {
    if (!obj || typeof obj !== "object") return null;

    if (isPlanningPayload(obj)) return obj;

    // Check common wrapper fields for stringified JSON or nested objects
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
            } catch {
              // Ignore invalid JSON in wrapper field
            }
          }
        } else if (typeof val === "object") {
          const found = searchForPayload(val);
          if (found) return found;
        }
      }
    }

    // If it's an array, search elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = searchForPayload(item);
        if (found) return found;
      }
    }

    return null;
  };


  // Strategy 2: Find all balanced brace/bracket blocks.
  const findAllBalancedJson = (openChar: "{" | "[", closeChar: "}" | "]"): string[] => {
    const candidates: string[] = [];
    let searchFrom = 0;
    while (searchFrom < trimmed.length) {
      const start = trimmed.indexOf(openChar, searchFrom);
      if (start < 0) break;

      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIndex = -1;
      for (let index = start; index < trimmed.length; index += 1) {
        const char = trimmed[index]!;
        if (inString) {
          if (escaped) { escaped = false; continue; }
          if (char === "\\") { escaped = true; continue; }
          if (char === "\"") { inString = false; }
          continue;
        }
        if (char === "\"") { inString = true; continue; }
        if (char === openChar) { depth += 1; continue; }
        if (char === closeChar) {
          depth -= 1;
          if (depth === 0) { endIndex = index; break; }
        }
      }

      if (endIndex >= 0) {
        const candidate = trimmed.slice(start, endIndex + 1);
        try {
          JSON.parse(candidate);
          candidates.push(candidate);
        } catch {
          // Not valid JSON
        }
      }
      searchFrom = start + 1;
    }
    return candidates;
  };

  const allCandidates = [
    ...fencedCandidates,
    ...findAllBalancedJson("{", "}"),
    ...findAllBalancedJson("[", "]"),
    trimmed
  ];

  // Try to find an exact schema match recursively first
  for (const candidate of allCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const foundPayload = searchForPayload(parsed);
      if (foundPayload) {
        return JSON.stringify(foundPayload);
      }
    } catch {
      // Not valid JSON or parsing failed
    }
  }

  // Fallback: If no strict schema match is found, just unwrap common envelopes
  // from the first valid JSON candidate (legacy behavior)
  for (const candidate of allCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof parsed.response === "string"
      ) {
        const inner = parsed.response.trim();
        if (inner.startsWith("{") || inner.startsWith("[")) {
          try {
            JSON.parse(inner);
            return inner;
          } catch {
            // inner response isn't valid JSON on its own — fall through
          }
        }
      }
      return candidate;
    } catch {
      // Not valid JSON
    }
  }

  return trimmed;
}


export function parsePlannedSprintReply(bodyMarkdown: string): PlannedSprintPayload {
  const rawJson = extractJsonLikeBlock(bodyMarkdown);
  let payload: any;
  try {
    payload = JSON.parse(rawJson);
  } catch (error) {
    throw new Error("Planning agent reply was not valid JSON.");
  }

  const validator = new PlanningPayloadValidator();
  return validator.validate(payload);
}
