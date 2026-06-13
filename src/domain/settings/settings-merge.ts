import type { SettingsValueSource } from "../../contracts/settings-scope-types.js";

/**
 * Ensures a value is a record (plain object).
 */
export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Safely clones a JSON-compatible value.
 * Throws if it encounters a non-plain object or non-serializable type.
 */
export function safeClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    // Note: This also handles Date, etc. as objects if we don't check carefully.
    // For settings, we only expect primitives, arrays, and plain objects.
    if (typeof value === "function" || typeof value === "symbol") {
      throw new Error(`Unsupported type for settings: ${typeof value}`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeClone(item)) as unknown as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`Unsupported object shape for settings: ${proto?.constructor?.name || "Unknown"}`);
  }

  const result: Record<string, unknown> = Object.create(proto);
  for (const [key, val] of Object.entries(value)) {
    result[key] = safeClone(val);
  }

  return result as unknown as T;
}

/**
 * Recursively merges a patch into a base object.
 * Arrays are replaced rather than merged.
 * Nested objects are merged recursively.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) {
    return base;
  }

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch as T;
  }

  const baseRecord = toRecord(base);
  const patchRecord = toRecord(patch);
  const result: Record<string, unknown> = { ...baseRecord };

  for (const [key, value] of Object.entries(patchRecord)) {
    const current = result[key];
    
    if (Array.isArray(value)) {
      // Array replacement semantics: replace the whole array with a clone of the patch value
      result[key] = safeClone(value);
      continue;
    }
    
    if (value && typeof value === "object") {
      // Nested object merge semantics
      result[key] = deepMerge(current ?? {}, value);
      continue;
    }
    
    // Primitive or null replacement
    result[key] = value;
  }

  return result as T;
}

/**
 * Returns a patch that represents the difference between base and value.
 * If there is no difference, returns undefined.
 */
export function deepDiff(base: unknown, value: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(value)) {
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  }

  if (!base || typeof base !== "object" || !value || typeof value !== "object") {
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  }

  const baseRecord = toRecord(base);
  const valueRecord = toRecord(value);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(valueRecord)) {
    const nextDiff = deepDiff(baseRecord[key], valueRecord[key]);
    if (nextDiff !== undefined) {
      result[key] = nextDiff;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Flattens a nested settings object into a record of source metadata.
 * Arrays are treated as leaf values (not further flattened).
 */
export function flattenSources(
  value: unknown,
  source: SettingsValueSource,
  prefix = "",
  result: Record<string, SettingsValueSource> = {},
): Record<string, SettingsValueSource> {
  if (Array.isArray(value)) {
    result[prefix] = source;
    return result;
  }
  
  if (!value || typeof value !== "object") {
    if (prefix) {
      result[prefix] = source;
    }
    return result;
  }

  for (const [key, nested] of Object.entries(toRecord(value))) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(nested)) {
      result[nextPrefix] = source;
      continue;
    }
    if (nested && typeof nested === "object") {
      flattenSources(nested, source, nextPrefix, result);
      continue;
    }
    result[nextPrefix] = source;
  }

  return result;
}
