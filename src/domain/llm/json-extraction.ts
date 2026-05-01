export type ExtractJsonResult =
  | { success: true; data: unknown; sourceText?: string }
  | { success: false; error: Error };

export function findAllJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const MAX_CANDIDATES = 50;

  const fenceRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  let fencedMatch: RegExpExecArray | null;
  while ((fencedMatch = fenceRegex.exec(trimmed)) !== null) {
    const fencedContent = fencedMatch[1]?.trim();
    if (fencedContent && (fencedContent.startsWith("{") || fencedContent.startsWith("["))) {
      candidates.push(fencedContent);
    }
  }

  const findAllBalancedJson = (openChar: "{" | "[", closeChar: "}" | "]"): string[] => {
    const localCandidates: string[] = [];
    let searchFrom = 0;
    while (searchFrom < trimmed.length && localCandidates.length < MAX_CANDIDATES) {
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
          localCandidates.push(candidate);
        } catch {
          // Not valid JSON
        }
      }
      searchFrom = start + 1;
    }
    return localCandidates;
  };

  candidates.push(...findAllBalancedJson("{", "}"));
  candidates.push(...findAllBalancedJson("[", "]"));

  return candidates;
}

export function extractJsonFromText(text: string): ExtractJsonResult {
  const candidates = findAllJsonCandidates(text);

  let bestData: unknown = null;
  let bestSourceText = text;
  let bestScore = -1;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      // Is it a direct planning payload?
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

      // Is it wrapped?
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
