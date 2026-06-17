export function parseRequiredString(payload: Record<string, unknown>, key: string, customError?: string): string {
  const val = payload[key];
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0) return trimmed;
  }
  throw new Error(customError || `${key} is required`);
}

export function parseOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const val = payload[key];
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
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