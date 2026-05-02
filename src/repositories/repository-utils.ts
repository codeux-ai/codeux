export function executeChunkedInQuery<T>(
  statementProvider: (sql: string) => { all: (...params: any[]) => any[] },
  params: {
    sqlPrefix: string;
    sqlSuffix?: string;
    items: string[];
    bindParamsBefore?: any[];
    bindParamsAfter?: any[];
  }
): T[] {
  const { sqlPrefix, items } = params;
  const sqlSuffix = params.sqlSuffix || "";
  const bindParamsBefore = params.bindParamsBefore || [];
  const bindParamsAfter = params.bindParamsAfter || [];

  if (items.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(items)];
  const results: T[] = [];
  const BUCKET_SIZES = [1, 2, 5, 10, 25, 50, 100];

  let i = 0;
  while (i < uniqueIds.length) {
    const remaining = uniqueIds.length - i;
    const bucketSize = BUCKET_SIZES.find((size) => size >= remaining) || 100;

    const chunk = uniqueIds.slice(i, i + bucketSize);

    // Pad with the last element if chunk is smaller than bucketSize
    while (chunk.length < bucketSize) {
      chunk.push(chunk[chunk.length - 1]!);
    }

    const placeholders = Array(bucketSize).fill("?").join(", ");
    const sql = `${sqlPrefix} IN (${placeholders}) ${sqlSuffix}`;
    const stmt = statementProvider(sql);

    const rows = stmt.all(...bindParamsBefore, ...chunk, ...bindParamsAfter) as T[];
    results.push(...rows);

    i += bucketSize === 100 && remaining > 100 ? 100 : remaining;
    if (remaining <= 100) {
      break; // we processed everything
    }
  }

  return results;
}

export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

export function toBoolean(value: number | string | null | undefined): boolean {
  return toNumber(value) > 0;
}

export function parsePayloadJson(value: string | null | undefined): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function requireRecord<T>(
  record: T | null | undefined,
  entityType: string,
  id: string
): T {
  if (!record) {
    throw new Error(`${entityType} not found: ${id}`);
  }
  return record;
}
