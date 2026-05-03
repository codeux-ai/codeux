import type { DatabaseAdapter } from "../db/database-adapter.js";

export function requireEntities<T extends { id: string }>(
  db: DatabaseAdapter,
  entityName: string,
  tableName: string,
  ids: string[],
  selectFields: string = "id",
  extraChecks?: (row: T) => void
): void {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return;

  const chunkSize = 500;
  const foundIds = new Set<string>();
  const rows: T[] = [];

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    // better-sqlite3 requires the array elements to be passed correctly, avoiding "named parameter" issues
    const chunkRows = db.prepare(`SELECT ${selectFields} FROM ${tableName} WHERE id IN (${placeholders})`).all(...chunk) as T[];
    for (const row of chunkRows) {
      foundIds.add(row.id);
      rows.push(row);
    }
  }

  for (const id of uniqueIds) {
    if (!foundIds.has(id)) {
      throw new Error(`${entityName} not found: ${id}`);
    }
  }

  if (extraChecks) {
    for (const row of rows) {
      extraChecks(row);
    }
  }
}

export function requireEntity<T extends { id: string }>(
  db: DatabaseAdapter,
  entityName: string,
  tableName: string,
  id: string,
  selectFields: string = "id",
  extraChecks?: (row: T) => void
): void {
  const row = db.prepare(`SELECT ${selectFields} FROM ${tableName} WHERE id = ?`).get(id) as T | undefined;
  if (!row) {
    throw new Error(`${entityName} not found: ${id}`);
  }
  if (extraChecks) {
    extraChecks(row);
  }
}

export function requireEntityByGetter<T>(
  entityName: string,
  id: string,
  getter: (id: string) => T | null,
  extraChecks?: (entity: T) => void
): T {
  const entity = getter(id);
  if (!entity) {
    throw new Error(`${entityName} not found: ${id}`);
  }
  if (extraChecks) {
    extraChecks(entity);
  }
  return entity;
}
