const BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN =
  /^fatal:\s+your current branch 'code-ux-bootstrap-[^']+' does not have any commits yet\s*$/i;
const QWEN_LEGACY_OPENAI_LOGGING_WARNING_LINE_PATTERN =
  /^Warning:\s+Legacy setting 'enableOpenAILogging' will be ignored in .*?\.qwen\/settings\.json\.\s+Please use 'model\.enableOpenAILogging' instead\.\s*$/i;
const QWEN_LEGACY_OPENAI_LOGGING_WARNING_TEXT_PATTERN =
  /\s*Warning:\s+Legacy setting 'enableOpenAILogging' will be ignored in .*?\.qwen\/settings\.json\.\s+Please use 'model\.enableOpenAILogging' instead\./gi;

const SENSITIVE_KEYS_LIST = [
  "apiKey", "token", "authorization", "password", "secret",
  "githubToken", "gitlabToken", "jiraToken",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
  "GH_TOKEN", "GITLAB_TOKEN"
];
const SENSITIVE_KEYS_REGEX_STR = SENSITIVE_KEYS_LIST.join("|");

const JSON_SECRET_PATTERN = new RegExp(`"(${SENSITIVE_KEYS_REGEX_STR})"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`, "gi");
const ENV_ASSIGNMENT_PATTERN = new RegExp(`\\b(${SENSITIVE_KEYS_REGEX_STR})\\s*=\\s*(['"]?)[^\\s'"\\\\]+\\2`, "gi");
const BEARER_TOKEN_PATTERN = /(Authorization:\s*Bearer\s+)[^\s"'\\]+/gi;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82,})\b/g;
const GITLAB_TOKEN_PATTERN = /\b(?:glpat-[A-Za-z0-9_\-]{20,})\b/g;

export const sanitizeInvocationOutputText = (value: string): string => {
  if (!value) {
    return value;
  }

  let sanitized = value.replace(JSON_SECRET_PATTERN, '"$1": "[REDACTED]"');
  sanitized = sanitized.replace(ENV_ASSIGNMENT_PATTERN, '$1=$2[REDACTED]$2');
  sanitized = sanitized.replace(BEARER_TOKEN_PATTERN, '$1[REDACTED]');
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(GITLAB_TOKEN_PATTERN, '[REDACTED]');

  const lines = sanitized.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    return !BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN.test(trimmed)
      && !QWEN_LEGACY_OPENAI_LOGGING_WARNING_LINE_PATTERN.test(trimmed);
  });
  return filtered.join("\n").replace(QWEN_LEGACY_OPENAI_LOGGING_WARNING_TEXT_PATTERN, "").trim();
};
