/**
 * Shared configuration value readers to standardize how primitive types
 * are parsed and validated across the codebase.
 */

/**
 * Parses a value as a boolean.
 * Handles boolean types and string "true"/"false" (case-insensitive).
 */
export const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return fallback;
};

/**
 * Parses a value as a string.
 */
export const readString = (value: unknown, fallback: string): string => {
  return typeof value === "string" ? value : fallback;
};

/**
 * Parses a value as an integer.
 * Handles number types and numeric strings.
 * Rounds the result to the nearest integer.
 */
export const readInteger = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

/**
 * Parses a value as a network port (1-65535).
 * Handles number types and numeric strings.
 */
export const readPortValue = (value: unknown, fallback: number | null = null): number | null => {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 65535) return fallback;
  return rounded;
};

/**
 * Legacy wrapper for readPortValue to match existing usage patterns
 * where fallback is mandatory and non-nullable.
 */
export const readPort = (value: unknown, fallback: number): number => {
  return readPortValue(value, fallback) as number;
};
