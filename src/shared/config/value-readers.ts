/**
 * Utility functions for reading and validating primitive configuration values.
 * Standardizes how port, boolean, integer, and string types are parsed from
 * various sources (environment variables, JSON settings, CLI args).
 */

/**
 * Reads a boolean value, supporting boolean primitives and string representations.
 */
export const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
};

/**
 * Reads a string value, ensuring it's a valid string.
 */
export const readString = (value: unknown, fallback: string): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

/**
 * Reads an integer value, supporting number primitives and string representations.
 * Ensures the result is a finite integer.
 */
export const readInteger = (value: unknown, fallback: number): number => {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = Number.parseInt(value, 10);
  } else {
    return fallback;
  }

  if (Number.isFinite(parsed)) {
    return Math.round(parsed);
  }
  return fallback;
};

/**
 * Reads a port number (1-65535).
 * Supports number primitives and string representations.
 */
export const readPort = (value: unknown, fallback: number): number => {
  const parsed = readInteger(value, -1);
  if (parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};
