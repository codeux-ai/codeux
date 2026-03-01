import type { CommandResult } from "./cli-process-runner.js";

const looksLikeRelativePath = (value: string): boolean => {
  if (!value || value.length > 180) return false;
  if (value.startsWith("/") || value.startsWith("~")) return false;
  if (value.includes("..")) return false;
  const cleaned = value.replace(/[.,;:!?]+$/g, "");
  return /[a-zA-Z0-9_-]+\//.test(cleaned) || /\.[a-zA-Z0-9]{1,6}$/.test(cleaned);
};

export const extractPathHints = (text: string): string[] => {
  const candidates = new Set<string>();
  const backtickMatches = text.match(/`[^`\n]+`/g) || [];
  for (const token of backtickMatches) {
    const normalized = token.slice(1, -1).trim();
    if (looksLikeRelativePath(normalized)) {
      candidates.add(normalized);
    }
  }
  const lineMatches = text.match(/(?:^|\n)\s*-\s+([^\n]+)/g) || [];
  for (const rawLine of lineMatches) {
    const normalized = rawLine.replace(/^\s*-\s+/, "").trim();
    if (looksLikeRelativePath(normalized)) {
      candidates.add(normalized);
    }
  }
  return Array.from(candidates);
};

export const isReadFileNotFoundToolError = (result: CommandResult): boolean => {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes("error executing tool read_file: file not found");
};

export const buildReadFileRetryPrompt = (basePrompt: string): string => {
  return [
    basePrompt,
    "",
    "## Retry Guidance",
    "Previous attempt failed with a file-not-found read.",
    "Before any read_file call, first enumerate files in the relevant area and use exact existing paths.",
    "Do not assume filenames; verify paths then continue implementation.",
  ].join("\n");
};
