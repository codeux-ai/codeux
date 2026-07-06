import type { ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";

export type ManagementErrorKind = "validation" | "runtime";

export class ManagementValidationError extends Error {
  readonly kind = "validation" as const;

  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ManagementValidationError";
  }
}

export function isManagementValidationError(error: unknown): error is ManagementValidationError {
  return error instanceof ManagementValidationError;
}

export function managementValidationError(message: string, field?: string): ManagementValidationError {
  return new ManagementValidationError(message, field);
}

export function formatManagementErrorEnvelope(
  domain: string,
  action: string,
  error: unknown,
): ManagementResponseEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const kind: ManagementErrorKind = isManagementValidationError(error) ? "validation" : "runtime";
  const result: Record<string, unknown> = {
    status: "error",
    domain,
    action,
    message,
    errorType: kind,
  };
  if (isManagementValidationError(error) && error.field) {
    result.field = error.field;
  }
  return { result };
}

export function parseRequiredString(payload: Record<string, unknown>, key: string, customError?: string): string {
  const val = payload[key];
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0) return trimmed;
  }
  throw managementValidationError(customError || `${key} is required`, key);
}

export function parseRequiredStringAlias(
  payload: Record<string, unknown>,
  primaryKey: string,
  aliasKey: string,
  customError?: string,
): string {
  const primary = parseOptionalString(payload, primaryKey);
  const alias = parseOptionalString(payload, aliasKey);
  if (primary) return primary;
  if (alias) return alias;
  throw managementValidationError(customError || `${primaryKey} or ${aliasKey} is required`, primaryKey);
}

export function parseOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const val = payload[key];
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export function parseOptionalNullableString(payload: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in payload)) {
    return undefined;
  }
  if (payload[key] === null) {
    return null;
  }
  return parseOptionalString(payload, key);
}

export function parseOptionalStringAlias(
  payload: Record<string, unknown>,
  primaryKey: string,
  aliasKey: string,
): string | undefined {
  return parseOptionalString(payload, primaryKey) || parseOptionalString(payload, aliasKey);
}

export function parseOptionalStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const val = payload[key];
  if (!Array.isArray(val)) return undefined;

  const strings = val
    .filter(item => typeof item === "string")
    .map(item => (item as string).trim())
    .filter(item => item.length > 0);

  return strings.length > 0 ? strings : undefined;
}

export function parseOptionalNumber(payload: Record<string, unknown>, key: string, min?: number, max?: number): number | undefined {
  const val = payload[key];
  if (typeof val !== "number" || !Number.isFinite(val)) return undefined;
  if (min !== undefined && val < min) return undefined;
  if (max !== undefined && val > max) return undefined;
  return val;
}

export function parseOptionalBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const val = payload[key];
  return typeof val === "boolean" ? val : undefined;
}

export function parseOptionalObject<T>(payload: Record<string, unknown>, key: string): T | undefined {
  const val = payload[key];
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return val as T;
  }
  return undefined;
}

export function parseRequiredObject<T>(payload: Record<string, unknown>, key: string, customError?: string): T {
  const val = payload[key];
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return val as T;
  }
  throw managementValidationError(customError || `${key} object is required`, key);
}

export function parseRequiredPresentValue(payload: Record<string, unknown>, key: string, customError?: string): unknown {
  if (!(key in payload)) {
    throw managementValidationError(customError || `${key} is required`, key);
  }
  return payload[key];
}

export function parseOptionalEnum<T extends string>(payload: Record<string, unknown>, key: string, validValues: readonly T[]): T | undefined {
  const val = payload[key];
  if (typeof val === "string") {
    const normalized = val.trim().toLowerCase() as T;
    if (validValues.includes(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

export function parseOptionalEnumStrict<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  validValues: readonly T[],
): T | undefined {
  if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
    return undefined;
  }
  const value = parseOptionalEnum(payload, key, validValues);
  if (value !== undefined) {
    return value;
  }
  throw managementValidationError(`Invalid value for ${key}. Must be one of: ${validValues.join(", ")}`, key);
}

export function parseOptionalIntegerStrict(
  payload: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
    return undefined;
  }

  const value = payload[key];
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw managementValidationError(`Invalid value for ${key}. Must be a valid integer.`, key);
    }
    parsed = Number(trimmed);
  } else {
    throw managementValidationError(`Invalid value for ${key}. Must be a valid integer.`, key);
  }

  if (!Number.isFinite(parsed)) {
    throw managementValidationError(`Invalid value for ${key}. Must be a valid integer.`, key);
  }

  const integer = Math.floor(parsed);
  if (options.min !== undefined && integer < options.min) {
    throw managementValidationError(`Invalid value for ${key}. Must be at least ${options.min}.`, key);
  }
  if (options.max !== undefined && integer > options.max) {
    throw managementValidationError(`Invalid value for ${key}. Must be at most ${options.max}.`, key);
  }

  return integer;
}
