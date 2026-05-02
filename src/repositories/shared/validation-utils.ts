import type { DatabaseAdapter } from "../db/database-adapter.js";

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
