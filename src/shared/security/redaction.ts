const SENSITIVE_KEYS_LIST = [
  "apiKey", "token", "authorization", "password", "secret",
  "githubToken", "gitlabToken", "jiraToken",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
  "GH_TOKEN", "GITLAB_TOKEN"
];

const SENSITIVE_KEYS = new Set(SENSITIVE_KEYS_LIST.map((key) => key.toLowerCase()));
const SENSITIVE_KEYS_REGEX_STR = SENSITIVE_KEYS_LIST.join("|");

const JSON_SECRET_PATTERN = new RegExp(`"(${SENSITIVE_KEYS_REGEX_STR})"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`, "gi");
const ENV_ASSIGNMENT_PATTERN = new RegExp(`\\b(${SENSITIVE_KEYS_REGEX_STR})\\s*=\\s*(['"]?)[^\\s'"\\\\]+\\2`, "gi");
const AUTH_TOKEN_PATTERN = /(Authorization:\s*(?:Bearer|Basic|token)\s+)[^\s"'\\]+/gi;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82,})\b/g;
const GITLAB_TOKEN_PATTERN = /\b(?:glpat-[A-Za-z0-9_\-]{20,})\b/g;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)(?:[^:@"\/]+:[^:@"\/]+)@/gi;

export const isSensitiveKey = (key: string): boolean => {
  return SENSITIVE_KEYS.has(key.toLowerCase());
};

export const redactText = (value: string): string => {
  if (!value) {
    return value;
  }

  let sanitized = value.replace(JSON_SECRET_PATTERN, '"$1": "[REDACTED]"');
  sanitized = sanitized.replace(ENV_ASSIGNMENT_PATTERN, '$1=$2[REDACTED]$2');
  sanitized = sanitized.replace(AUTH_TOKEN_PATTERN, '$1[REDACTED]');
  sanitized = sanitized.replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@');
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(GITLAB_TOKEN_PATTERN, '[REDACTED]');

  return sanitized;
};

export const redactMetadata = (value: unknown, keyName: string = ""): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactMetadata(item, keyName));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactMetadata(item, key)])
    );
  }

  if (typeof value === "string") {
    if (isSensitiveKey(keyName)) {
      return "[REDACTED]";
    }
    return redactText(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
};
