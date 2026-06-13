import type { ProjectSettings } from "../../types.js";

/**
 * A type-safe way to represent a path into the settings object.
 * While we could use complex template literal types for full path safety,
 * for the dashboard's needs, a string with typed value inference is usually enough.
 */
export type SettingsPath = string;

/**
 * Retrieves a value from an object by a dot-separated path.
 *
 * @param obj The object to traverse.
 * @param path Dot-separated path (e.g., "aiProvider.strategy").
 * @returns The value at the path or undefined if not found.
 */
export function getValueByPath(obj: unknown, path: SettingsPath): unknown {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  return path.split(".").reduce((acc: any, part) => acc && acc[part], obj);
}

/**
 * Sets a value in an object at a dot-separated path, returning a new object (immutable).
 * Intermediate objects are created if they don't exist.
 *
 * @param obj The root object.
 * @param path Dot-separated path.
 * @param value The value to set.
 * @returns A new object with the value set.
 */
export function setValueByPath<T extends object>(obj: T, path: SettingsPath, value: unknown): T {
  const parts = path.split(".");
  const next = { ...obj } as any;
  let current = next;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    // Ensure we create a new object if it doesn't exist or is not an object
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) {
      current[part] = {};
    } else {
      current[part] = { ...current[part] };
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
  return next;
}

/**
 * Typed wrapper for updating project settings.
 */
export function updateProjectSettingsPath(
  settings: ProjectSettings,
  path: SettingsPath,
  value: unknown
): ProjectSettings {
  return setValueByPath(settings, path, value);
}
