export type ListWindowOption = 10 | 20 | 50 | 100 | "All";

export const LIST_WINDOW_OPTIONS: readonly ListWindowOption[] = [10, 20, 50, 100, "All"] as const;

export const DEFAULT_LIST_WINDOW: ListWindowOption = 20;

export function resolveListWindow(
  option: ListWindowOption,
  totalItems: number
): number {
  if (option === "All") {
    return totalItems;
  }
  return Math.min(option, totalItems);
}
