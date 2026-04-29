/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useUsageFilters } from '../hooks/useUsageFilters.js';

describe('useUsageFilters', () => {
  it('should initialize with filters closed', () => {
    const { result } = renderHook(() => useUsageFilters());
    expect(result.current.isFiltersOpen).toBe(false);
  });

  it('should open filters', () => {
    const { result } = renderHook(() => useUsageFilters());
    act(() => {
      result.current.openFilters();
    });
    expect(result.current.isFiltersOpen).toBe(true);
  });

  it('should close filters', () => {
    const { result } = renderHook(() => useUsageFilters());
    act(() => {
      result.current.openFilters();
    });
    expect(result.current.isFiltersOpen).toBe(true);
    act(() => {
      result.current.closeFilters();
    });
    expect(result.current.isFiltersOpen).toBe(false);
  });

  it('should toggle filters', () => {
    const { result } = renderHook(() => useUsageFilters());
    act(() => {
      result.current.toggleFilters();
    });
    expect(result.current.isFiltersOpen).toBe(true);
    act(() => {
      result.current.toggleFilters();
    });
    expect(result.current.isFiltersOpen).toBe(false);
  });
});
