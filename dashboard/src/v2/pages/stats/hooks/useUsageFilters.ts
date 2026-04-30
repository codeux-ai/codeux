import { useState, useCallback } from 'preact/hooks';

export function useUsageFilters() {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const toggleFilters = useCallback(() => {
    setIsFiltersOpen((prev) => !prev);
  }, []);

  const closeFilters = useCallback(() => {
    setIsFiltersOpen(false);
  }, []);

  const openFilters = useCallback(() => {
    setIsFiltersOpen(true);
  }, []);

  return {
    isFiltersOpen,
    toggleFilters,
    closeFilters,
    openFilters,
  };
}
