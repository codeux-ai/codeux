/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useReducedMotionSafe, getMotionSafeStyles } from '../src/v2/lib/motion/useReducedMotionSafe.js';
import * as useReducedMotionHook from '../src/v2/hooks/use-reduced-motion.js';

describe('Motion Utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('useReducedMotionSafe', () => {
    it('returns standard value when reduced motion is disabled', () => {
      vi.spyOn(useReducedMotionHook, 'useReducedMotion').mockReturnValue(false);
      const { result } = renderHook(() => useReducedMotionSafe('standard-transition', 'reduced-transition'));
      expect(result.current).toBe('standard-transition');
    });

    it('returns reduced value when reduced motion is enabled', () => {
      vi.spyOn(useReducedMotionHook, 'useReducedMotion').mockReturnValue(true);
      const { result } = renderHook(() => useReducedMotionSafe('standard-transition', 'reduced-transition'));
      expect(result.current).toBe('reduced-transition');
    });
  });

  describe('getMotionSafeStyles', () => {
    const styles = { opacity: 1, transition: 'all 300ms' };
    const reducedStyles = { opacity: 1, transition: 'none' };

    it('returns standard styles when reduced motion is disabled', () => {
      expect(getMotionSafeStyles(false, styles, reducedStyles)).toEqual(styles);
    });

    it('returns reduced styles when reduced motion is enabled', () => {
      expect(getMotionSafeStyles(true, styles, reducedStyles)).toEqual(reducedStyles);
    });
  });
});
