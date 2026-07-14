const SENSITIVE_KEYS_LIST = [
  "apiKey", "token", "authorization", "password", "secret",
  "credentialValue", "replacementValue", "rotationValue",
  "anthropicApiKey", "codexApiKey", "geminiApiKey", "jiraApiToken", "julesApiKey",
  "openaiCompatibleApiKey", "openRouterApiKey", "providerApiKey", "qwenApiKey",
  "githubToken", "gitlabToken", "jiraToken",
  "anthropicAuthToken", "openCodeApiKey", "antigravityApiKey", "dashscopeApiKey",
  "bailianCodingPlanApiKey", "ollamaApiKey", "otelExporterOtlpHeaders",
  "ANTHROPIC_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "JIRA_API_TOKEN",
  "JULES_API_KEY", "OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY", "OPENROUTER_API_KEY",
  "QWEN_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN", "GLAB_TOKEN",
  "ANTHROPIC_AUTH_TOKEN", "OPENCODE_API_KEY", "ANTIGRAVITY_API_KEY", "DASHSCOPE_API_KEY",
  "BAILIAN_CODING_PLAN_API_KEY", "OLLAMA_API_KEY", "OTEL_EXPORTER_OTLP_HEADERS"
];

const SENSITIVE_KEYS = new Set(SENSITIVE_KEYS_LIST.map((key) => key.toLowerCase()));
const SENSITIVE_KEYS_REGEX_STR = SENSITIVE_KEYS_LIST.join("|");
const SENSITIVE_KEY_FRAGMENT_PATTERN = /(?:api[-_]?key|token|authorization|password|secret)/i;

const JSON_SECRET_PATTERN = new RegExp(`"(${SENSITIVE_KEYS_REGEX_STR})"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`, "gi");
const TOML_SECRET_PATTERN = new RegExp(`"(${SENSITIVE_KEYS_REGEX_STR})"\\s*=\\s*"(?:[^"\\\\]|\\\\.)*"`, "gi");
const ENV_ASSIGNMENT_PATTERN = new RegExp(`\\b(${SENSITIVE_KEYS_REGEX_STR})\\s*=\\s*(['"]?)[^\\s'"\\\\]+\\2`, "gi");
const AUTH_TOKEN_PATTERN = /(Authorization:\s*(?:Bearer|Basic|token)\s+)[^\s"'\\]+/gi;
const AUTH_EQUALS_TOKEN_PATTERN = /\b(Authorization\s*=\s*(?:Bearer|Basic|token)\s+)[^,\s"'\\}]+/gi;
const AUTH_JSON_TOKEN_PATTERN = /("Authorization"\s*:\s*"(?:Bearer|Basic|token)\s+)(?:[^"\\]|\\.)*(")/gi;
const AUTH_TOML_TOKEN_PATTERN = /("Authorization"\s*=\s*"(?:Bearer|Basic|token)\s+)(?:[^"\\]|\\.)*(")/gi;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g;
const GITLAB_TOKEN_PATTERN = /\b(?:glpat-[A-Za-z0-9_\-]{20,})\b/g;
const JIRA_TOKEN_PATTERN = /\b(?:ATATT3xFfGF0[A-Za-z0-9_\-=]{20,})\b/g;
const OPENAI_COMPATIBLE_TOKEN_PATTERN = /\b(?:sk|sess|sk-proj|sk-or-v1)-[A-Za-z0-9_-]{16,}\b/g;
const SLACK_TOKEN_PATTERN = /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/gi;
const PROVIDER_SESSION_TOKEN_PATTERN = /\b(?:claude|codex|qwen|gemini|opencode|antigravity|agy|anthropic)[-_]?(?:session|auth|access|refresh)[-_]?(?:token|id)?[:=][A-Za-z0-9._~+/=-]{16,}\b/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)(?:[^:@"\/]+:[^:@"\/]+)@/gi;

export const isSensitiveKey = (key: string): boolean => {
  return SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEY_FRAGMENT_PATTERN.test(key);
};

export const redactText = (value: string): string => {
  if (!value) {
    return value;
  }

  let sanitized = value.replace(AUTH_TOKEN_PATTERN, '$1[REDACTED]');
  sanitized = sanitized.replace(AUTH_EQUALS_TOKEN_PATTERN, '$1[REDACTED]');
  sanitized = sanitized.replace(AUTH_JSON_TOKEN_PATTERN, '$1[REDACTED]$2');
  sanitized = sanitized.replace(AUTH_TOML_TOKEN_PATTERN, '$1[REDACTED]$2');
  sanitized = sanitized.replace(JSON_SECRET_PATTERN, '"$1": "[REDACTED]"');
  sanitized = sanitized.replace(TOML_SECRET_PATTERN, '"$1" = "[REDACTED]"');
  sanitized = sanitized.replace(ENV_ASSIGNMENT_PATTERN, '$1=$2[REDACTED]$2');
  sanitized = sanitized.replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@');
  sanitized = sanitized.replace(GITHUB_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(GITLAB_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(JIRA_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(OPENAI_COMPATIBLE_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(SLACK_TOKEN_PATTERN, '[REDACTED]');
  sanitized = sanitized.replace(PROVIDER_SESSION_TOKEN_PATTERN, '[REDACTED]');

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
