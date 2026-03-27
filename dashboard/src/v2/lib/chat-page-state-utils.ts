export const resolveSelectedItemId = <T extends { id: string }>(
  items: T[],
  currentSelectedId: string | null,
): string | null => {
  if (currentSelectedId && items.some((item) => item.id === currentSelectedId)) {
    return currentSelectedId;
  }

  return items[0]?.id || null;
};

export const isListLoading = (
  selectedProjectId: string | null,
  hasProjectSnapshot: boolean,
  loading: boolean,
): boolean => Boolean(selectedProjectId) && loading && !hasProjectSnapshot;

export const isDetailLoading = (
  selectedItemId: string | null,
  hasItemSnapshot: boolean,
  loading: boolean,
): boolean => Boolean(selectedItemId) && loading && !hasItemSnapshot;
