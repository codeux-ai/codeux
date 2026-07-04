export type ListWindowOption = 10 | 20 | 50 | 100 | "All" | "all";

export const LIST_WINDOW_OPTIONS: readonly ListWindowOption[] = [10, 20, 50, 100, "All"] as const;

export const DEFAULT_LIST_WINDOW = 20 satisfies ListWindowOption;

export function resolveListWindow(
  option: ListWindowOption,
  totalItems: number
): number {
  if (option === "All" || option === "all") {
    return totalItems;
  }
  return Math.min(option, totalItems);
}

export function sliceListWindow<T>(
  items: readonly T[],
  option: ListWindowOption
): T[] {
  return items.slice(0, resolveListWindow(option, items.length));
}
