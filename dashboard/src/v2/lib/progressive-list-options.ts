export type PageSizeOption = "10" | "20" | "50" | "100" | "All";

export const PAGE_SIZE_OPTIONS: PageSizeOption[] = ["10", "20", "50", "100", "All"];

/**
 * Resolves a PageSizeOption to a concrete number of items.
 * If 'All' is selected, it returns the total number of items available.
 */
export function resolvePageSize(option: PageSizeOption, totalItems: number): number {
  if (option === "All") {
    return totalItems;
  }
  return parseInt(option, 10);
}

/**
 * Determines whether the visible count should be reset to the base page size.
 * This happens when the list shrinks significantly (e.g., due to filtering)
 * such that the current visible count is greater than the new total length,
 * or when the total length grows from an empty state.
 */
export function shouldResetVisibleCount(previousLength: number, newLength: number, currentVisible: number): boolean {
  if (newLength < currentVisible) {
    return true;
  }
  if (previousLength === 0 && newLength > 0) {
    return true;
  }
  return false;
}
