import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type WorkflowEvaluation = "applicable" | "pr_trigger_not_applicable" | "no_pr_trigger" | "unknown";

export interface PullRequestCiSupportResult {
  status: "applicable" | "not_applicable" | "unknown";
  reason:
    | "matching_pr_workflow_found"
    | "no_workflow_directory"
    | "no_workflow_files"
    | "no_pull_request_triggers"
    | "no_matching_pull_request_branches"
    | "workflow_directory_unreadable"
    | "workflow_file_unreadable"
    | "workflow_parse_uncertain";
}

interface ParsedKeyValue {
  key: string;
  value: string;
}

interface ParsedBranchFilters {
  branches: string[] | null;
  branchesIgnore: string[] | null;
}

interface YamlLine {
  indent: number;
  text: string;
}

export async function detectPullRequestCiSupport(
  repoPath: string,
  baseBranch: string,
): Promise<PullRequestCiSupportResult> {
  const workflowDirectory = path.join(repoPath, ".github", "workflows");

  try {
    await stat(repoPath);
  } catch {
    return { status: "unknown", reason: "workflow_directory_unreadable" };
  }

  let entries;
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { status: "not_applicable", reason: "no_workflow_directory" };
    }
    return { status: "unknown", reason: "workflow_directory_unreadable" };
  }

  const workflowFiles = entries
    .filter((entry) => entry.isFile() && /\.(yml|yaml)$/i.test(entry.name))
    .map((entry) => path.join(workflowDirectory, entry.name));

  if (workflowFiles.length === 0) {
    return { status: "not_applicable", reason: "no_workflow_files" };
  }

  let sawPrTrigger = false;
  let sawUnknown = false;

  const fileContents = await Promise.allSettled(
    workflowFiles.map((file) => readFile(file, "utf8")),
  );

  for (const result of fileContents) {
    if (result.status === "rejected") {
      sawUnknown = true;
      continue;
    }

    const evaluation = evaluateWorkflowFileForPullRequest(result.value, baseBranch);
    if (evaluation === "applicable") {
      return { status: "applicable", reason: "matching_pr_workflow_found" };
    }
    if (evaluation === "pr_trigger_not_applicable") {
      sawPrTrigger = true;
      continue;
    }
    if (evaluation === "unknown") {
      sawUnknown = true;
      continue;
    }
  }

  if (sawUnknown) {
    return {
      status: "unknown",
      reason: sawPrTrigger ? "workflow_parse_uncertain" : "workflow_file_unreadable",
    };
  }

  return {
    status: "not_applicable",
    reason: sawPrTrigger ? "no_matching_pull_request_branches" : "no_pull_request_triggers",
  };
}

function evaluateWorkflowFileForPullRequest(content: string, baseBranch: string): WorkflowEvaluation {
  const lines = toYamlLines(content);
  const onEntry = findTopLevelOnEntry(lines);
  if (!onEntry) {
    return "no_pr_trigger";
  }

  if (onEntry.value.length > 0) {
    return evaluateOnInlineValue(onEntry.value, baseBranch);
  }

  return evaluateOnBlock(lines, onEntry.index, onEntry.indent, baseBranch);
}

function toYamlLines(content: string): YamlLine[] {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((rawLine) => {
      const sanitized = stripInlineComment(rawLine);
      const indent = sanitized.match(/^\s*/)?.[0].length ?? 0;
      return {
        indent,
        text: sanitized.trim(),
      };
    });
}

function stripInlineComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function findTopLevelOnEntry(lines: YamlLine[]): { index: number; indent: number; value: string } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.indent !== 0 || line.text.length === 0) {
      continue;
    }
    const parsed = parseKeyValue(line.text);
    if (!parsed) {
      continue;
    }
    const key = stripWrappingQuotes(parsed.key);
    if (key === "on") {
      return { index, indent: line.indent, value: parsed.value.trim() };
    }
  }
  return null;
}

function evaluateOnInlineValue(value: string, baseBranch: string): WorkflowEvaluation {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return "unknown";
  }
  if (normalizedValue.startsWith("[")) {
    const items = parseFlowSequence(normalizedValue);
    if (!items) {
      return "unknown";
    }
    return items.some((item) => isPullRequestEvent(item)) ? "applicable" : "no_pr_trigger";
  }
  if (normalizedValue.startsWith("{")) {
    return evaluateOnFlowMapping(normalizedValue, baseBranch);
  }
  return isPullRequestEvent(stripWrappingQuotes(normalizedValue)) ? "applicable" : "no_pr_trigger";
}

function evaluateOnBlock(
  lines: YamlLine[],
  onIndex: number,
  onIndent: number,
  baseBranch: string,
): WorkflowEvaluation {
  let sawPrTrigger = false;

  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text.length === 0) {
      continue;
    }
    if (line.indent <= onIndent) {
      break;
    }

    if (line.text.startsWith("- ")) {
      const eventName = stripWrappingQuotes(line.text.slice(2).trim());
      if (isPullRequestEvent(eventName)) {
        return "applicable";
      }
      continue;
    }

    const parsed = parseKeyValue(line.text);
    if (!parsed) {
      continue;
    }

    const eventName = stripWrappingQuotes(parsed.key);
    if (!isPullRequestEvent(eventName)) {
      continue;
    }

    sawPrTrigger = true;
    const eventEndIndex = findBlockEndIndex(lines, index + 1, line.indent);
    const eventEvaluation = evaluateEventConfig(lines, index, eventEndIndex, line.indent, parsed.value, baseBranch);
    if (eventEvaluation === "applicable") {
      return "applicable";
    }
    if (eventEvaluation === "unknown") {
      return "unknown";
    }

    index = eventEndIndex - 1;
  }

  return sawPrTrigger ? "pr_trigger_not_applicable" : "no_pr_trigger";
}

function evaluateOnFlowMapping(value: string, baseBranch: string): WorkflowEvaluation {
  const body = trimBraces(value);
  if (body === null) {
    return "unknown";
  }

  const entries = splitTopLevel(body, ",");
  let sawPrTrigger = false;
  for (const entry of entries) {
    const parsed = parseKeyValue(entry.trim());
    if (!parsed) {
      continue;
    }
    const eventName = stripWrappingQuotes(parsed.key);
    if (!isPullRequestEvent(eventName)) {
      continue;
    }
    sawPrTrigger = true;
    const evaluation = evaluateInlineEventValue(parsed.value.trim(), baseBranch);
    if (evaluation === "applicable") {
      return "applicable";
    }
    if (evaluation === "unknown") {
      return "unknown";
    }
  }

  return sawPrTrigger ? "pr_trigger_not_applicable" : "no_pr_trigger";
}

function evaluateEventConfig(
  lines: YamlLine[],
  eventIndex: number,
  eventEndIndex: number,
  eventIndent: number,
  inlineValue: string,
  baseBranch: string,
): WorkflowEvaluation {
  const trimmedValue = inlineValue.trim();
  if (trimmedValue.length > 0) {
    return evaluateInlineEventValue(trimmedValue, baseBranch);
  }

  const filters = extractBranchFiltersFromBlock(lines, eventIndex + 1, eventEndIndex, eventIndent);
  if (!filters) {
    return "applicable";
  }
  return evaluateBranchFilters(filters, baseBranch) ? "applicable" : "pr_trigger_not_applicable";
}

function evaluateInlineEventValue(value: string, baseBranch: string): WorkflowEvaluation {
  if (value === "{}" || value === "null" || value === "~") {
    return "applicable";
  }
  if (value.startsWith("[")) {
    const items = parseFlowSequence(value);
    return items ? "applicable" : "unknown";
  }
  if (!value.startsWith("{")) {
    return "applicable";
  }

  const filters = extractBranchFiltersFromFlowMapping(value);
  if (!filters) {
    return "unknown";
  }
  return evaluateBranchFilters(filters, baseBranch) ? "applicable" : "pr_trigger_not_applicable";
}

function extractBranchFiltersFromBlock(
  lines: YamlLine[],
  startIndex: number,
  endIndex: number,
  eventIndent: number,
): ParsedBranchFilters | null {
  let branches: string[] | null = null;
  let branchesIgnore: string[] | null = null;

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index];
    if (line.text.length === 0 || line.indent <= eventIndent) {
      continue;
    }

    const parsed = parseKeyValue(line.text);
    if (!parsed) {
      continue;
    }

    const key = stripWrappingQuotes(parsed.key);
    if (key !== "branches" && key !== "branches-ignore") {
      continue;
    }

    const patterns = parsePatternValue(lines, index, endIndex, line.indent, parsed.value);
    if (patterns === null) {
      return null;
    }

    if (key === "branches") {
      branches = patterns;
    } else {
      branchesIgnore = patterns;
    }

    index = findBlockEndIndex(lines, index + 1, line.indent) - 1;
  }

  if (branches === null && branchesIgnore === null) {
    return null;
  }
  return { branches, branchesIgnore };
}

function extractBranchFiltersFromFlowMapping(value: string): ParsedBranchFilters | null {
  const body = trimBraces(value);
  if (body === null) {
    return null;
  }

  let branches: string[] | null = null;
  let branchesIgnore: string[] | null = null;

  for (const entry of splitTopLevel(body, ",")) {
    const parsed = parseKeyValue(entry.trim());
    if (!parsed) {
      continue;
    }
    const key = stripWrappingQuotes(parsed.key);
    if (key !== "branches" && key !== "branches-ignore") {
      continue;
    }
    const patterns = parseInlinePatternList(parsed.value.trim());
    if (patterns === null) {
      return null;
    }
    if (key === "branches") {
      branches = patterns;
    } else {
      branchesIgnore = patterns;
    }
  }

  return { branches, branchesIgnore };
}

function parsePatternValue(
  lines: YamlLine[],
  index: number,
  endIndex: number,
  keyIndent: number,
  inlineValue: string,
): string[] | null {
  const trimmedValue = inlineValue.trim();
  if (trimmedValue.length > 0) {
    return parseInlinePatternList(trimmedValue);
  }

  const patterns: string[] = [];
  for (let cursor = index + 1; cursor < endIndex; cursor += 1) {
    const line = lines[cursor];
    if (line.text.length === 0) {
      continue;
    }
    if (line.indent <= keyIndent) {
      break;
    }
    if (!line.text.startsWith("- ")) {
      return null;
    }
    patterns.push(stripWrappingQuotes(line.text.slice(2).trim()));
  }

  return patterns;
}

function parseInlinePatternList(value: string): string[] | null {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("[")) {
    return parseFlowSequence(trimmedValue);
  }
  if (trimmedValue.startsWith("{")) {
    return null;
  }
  return [stripWrappingQuotes(trimmedValue)];
}

function evaluateBranchFilters(filters: ParsedBranchFilters, baseBranch: string): boolean {
  const { branches, branchesIgnore } = filters;
  if (branches && branches.length > 0 && !matchesBranchPatterns(branches, baseBranch)) {
    return false;
  }
  if (branchesIgnore && branchesIgnore.some((pattern) => matchesGithubBranchPattern(pattern, baseBranch))) {
    return false;
  }
  return true;
}

function matchesBranchPatterns(patterns: string[], branch: string): boolean {
  let matched = false;
  let sawPositive = false;

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (pattern.length === 0) {
      continue;
    }
    const isNegative = pattern.startsWith("!");
    const effectivePattern = isNegative ? pattern.slice(1) : pattern;
    if (!effectivePattern) {
      continue;
    }
    const currentMatch = matchesGithubBranchPattern(effectivePattern, branch);
    if (!isNegative) {
      sawPositive = true;
      if (currentMatch) {
        matched = true;
      }
      continue;
    }
    if (currentMatch) {
      matched = false;
    }
  }

  return sawPositive ? matched : false;
}

function matchesGithubBranchPattern(pattern: string, branch: string): boolean {
  const regex = new RegExp(`^${patternToRegex(pattern)}$`);
  return regex.test(branch);
}

function patternToRegex(pattern: string): string {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        regex += ".*";
        index += 1;
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegexChar(char);
  }
  return regex;
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+*?.-]/.test(char) ? `\\${char}` : char;
}

function parseKeyValue(text: string): ParsedKeyValue | null {
  const separatorIndex = text.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    key: text.slice(0, separatorIndex).trim(),
    value: text.slice(separatorIndex + 1).trim(),
  };
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPullRequestEvent(eventName: string): boolean {
  return eventName === "pull_request" || eventName === "pull_request_target";
}

function parseFlowSequence(value: string): string[] | null {
  const body = trimBrackets(value);
  if (body === null) {
    return null;
  }
  return splitTopLevel(body, ",")
    .map((item) => stripWrappingQuotes(item.trim()))
    .filter((item) => item.length > 0);
}

function trimBraces(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function trimBrackets(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function splitTopLevel(value: string, separator: string): string[] {
  const items: string[] = [];
  let current = "";
  let squareDepth = 0;
  let braceDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "[") {
        squareDepth += 1;
      } else if (char === "]") {
        squareDepth = Math.max(0, squareDepth - 1);
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === separator && squareDepth === 0 && braceDepth === 0) {
        items.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }

  items.push(current);
  return items;
}

function findBlockEndIndex(lines: YamlLine[], startIndex: number, parentIndent: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text.length === 0) {
      continue;
    }
    if (line.indent <= parentIndent) {
      return index;
    }
  }
  return lines.length;
}
