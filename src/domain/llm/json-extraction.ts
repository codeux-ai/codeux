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

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return { success: true, data: parsed, sourceText: candidate };
    } catch {
      // Ignored
    }
  }

  return { success: false, error: new Error("Failed to extract valid JSON from text.") };
}
