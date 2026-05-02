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
        localCandidates.push(candidate);
      }
      searchFrom = start + 1;
    }
    return localCandidates;
  };

  candidates.push(...findAllBalancedJson("{", "}"));
  candidates.push(...findAllBalancedJson("[", "]"));

  candidates.sort((a, b) => b.length - a.length);

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

      // Is it wrapped?
      let foundPayload = null;
      const searchForPayload = (obj: any): any => {
        if (!obj || typeof obj !== "object") return null;

        const wrapperFields = ["response", "content", "message", "data", "text"];
        for (const field of wrapperFields) {
          if (field in obj) {
            const val = obj[field];
            if (typeof val === "string") {
              const innerTrimmed = val.trim();
              if (innerTrimmed.startsWith("{") || innerTrimmed.startsWith("[")) {
                try {
                  const parsedInner = JSON.parse(innerTrimmed);
                  // We only do one level deep of wrapper unboxing here to prevent infinite recurse
                  if (parsedInner && typeof parsedInner === "object") return parsedInner;
                } catch {}
              }
            } else if (typeof val === "object") {
              if (val && !Array.isArray(val)) return val;
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

      if (bestScore >= 0) {
        break;
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
