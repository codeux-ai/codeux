import type { PreviewEnvironmentVariable } from "../contracts/app-types.js";

const PREVIEW_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PREVIEW_ENV_VARS = 100;
const MAX_PREVIEW_ENV_KEY_LENGTH = 128;
const MAX_PREVIEW_ENV_VALUE_LENGTH = 4096;

const RESERVED_PREVIEW_ENV_KEYS = new Set([
  "HOME",
  "HOST",
  "PORT",
  "DASHBOARD_PORT",
  "SPRINT_PREVIEW_PORT",
  "SPRINT_PREVIEW_PRIMARY_CONTAINER_PORT",
  "SPRINT_PREVIEW_PRIMARY_HOST_PORT",
  "SPRINT_PREVIEW_CONTAINER_PORTS",
  "SPRINT_PREVIEW_HOST_PORTS",
  "SPRINT_PREVIEW_PORT_MAPPINGS",
  "SPRINT_PREVIEW_PROXY_PORT",
  "SPRINT_PREVIEW_WORKSPACE",
  "SPRINT_PREVIEW_WORKTREE",
  "SPRINT_PREVIEW_INSTALL_COMMAND",
  "SPRINT_PREVIEW_BUILD_COMMAND",
  "SPRINT_PREVIEW_RUN_COMMAND",
  "SPRINT_PREVIEW_SOURCE_COMMIT",
  "CODE_UX_GIT_USER_NAME",
  "CODE_UX_GIT_USER_EMAIL",
]);

export function isReservedPreviewEnvironmentKey(key: string): boolean {
  return RESERVED_PREVIEW_ENV_KEYS.has(key) || key.startsWith("SPRINT_PREVIEW_");
}

export function isValidPreviewEnvironmentKey(key: string): boolean {
  return key.length > 0
    && key.length <= MAX_PREVIEW_ENV_KEY_LENGTH
    && PREVIEW_ENV_KEY_PATTERN.test(key)
    && !isReservedPreviewEnvironmentKey(key);
}

export function sanitizePreviewEnvironmentVariables(input: unknown): PreviewEnvironmentVariable[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const byKey = new Map<string, PreviewEnvironmentVariable>();
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Partial<PreviewEnvironmentVariable>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const value = typeof raw.value === "string" ? raw.value : "";
    if (!isValidPreviewEnvironmentKey(key)) {
      continue;
    }
    if (value.includes("\n") || value.includes("\r") || value.length > MAX_PREVIEW_ENV_VALUE_LENGTH) {
      continue;
    }
    byKey.delete(key);
    byKey.set(key, {
      key,
      value,
      enabled: raw.enabled !== false,
    });
    if (byKey.size >= MAX_PREVIEW_ENV_VARS) {
      break;
    }
  }

  return [...byKey.values()];
}

export function mergePreviewEnvironmentVariables(
  defaults: PreviewEnvironmentVariable[],
  overrides: PreviewEnvironmentVariable[],
): Array<{ key: string; value: string }> {
  const merged = new Map<string, string>();
  for (const variable of sanitizePreviewEnvironmentVariables(defaults)) {
    if (variable.enabled !== false) {
      merged.set(variable.key, variable.value);
    }
  }
  for (const variable of sanitizePreviewEnvironmentVariables(overrides)) {
    if (variable.enabled === false) {
      merged.delete(variable.key);
    } else {
      merged.set(variable.key, variable.value);
    }
  }
  return [...merged].map(([key, value]) => ({ key, value }));
}
