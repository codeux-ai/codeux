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
