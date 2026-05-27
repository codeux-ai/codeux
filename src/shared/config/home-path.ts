import os from "os";
import * as path from "path";

const WINDOWS_ENV_VAR_PATTERN = /%([^%]+)%/g;

const expandWindowsEnvVars = (input: string): string => {
  return input.replace(WINDOWS_ENV_VAR_PATTERN, (match, name) => {
    const value = process.env[name];
    return typeof value === "string" ? value : match;
  });
};

const expandPosixEnvVars = (input: string): string => {
  if (!input.includes("$")) return input;
  return input
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (match, name) => process.env[name] ?? match)
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, name) => process.env[name] ?? match);
};

/**
 * Resolves a user-supplied path to an absolute filesystem path, with consistent
 * behavior across Linux, macOS, and Windows.
 *
 * Handles:
 *  - "~" and "~/..." (Unix-style home reference) on every platform
 *  - "~\..." (Windows-style backslash after tilde)
 *  - "%USERPROFILE%", "%APPDATA%", "%LOCALAPPDATA%" and other Windows env vars
 *  - "$HOME", "${VAR}" POSIX env vars
 *  - Absolute paths (returned unchanged after normalization)
 *  - Empty/whitespace input (returns "")
 *
 * The result is normalized to use the current OS path separator.
 */
export const expandHomePath = (input: string): string => {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const withWindowsExpanded = trimmed.includes("%")
    ? expandWindowsEnvVars(trimmed)
    : trimmed;
  const withAllVarsExpanded = expandPosixEnvVars(withWindowsExpanded);

  if (withAllVarsExpanded === "~") {
    return os.homedir();
  }

  if (withAllVarsExpanded.startsWith("~/") || withAllVarsExpanded.startsWith("~\\")) {
    return path.join(os.homedir(), withAllVarsExpanded.slice(2));
  }

  return path.normalize(withAllVarsExpanded);
};

/**
 * Like {@link expandHomePath} but resolves relative paths against a base directory.
 * Used when configuration values may be either absolute, home-relative, or
 * project-relative.
 */
export const resolveUserPath = (basePath: string, input: string): string => {
  const expanded = expandHomePath(input);
  if (!expanded) {
    return "";
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(basePath, expanded);
};
