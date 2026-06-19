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

  describe('Tokens and Constants', () => {
    it('exposes MOTION_TOKENS and INTERACTION_TOKENS', async () => {
      const { MOTION_TOKENS, INTERACTION_TOKENS } = await import('../src/v2/lib/motion/tokens.js');
      expect(MOTION_TOKENS.timing.fast).toBe('150ms');
      expect(INTERACTION_TOKENS.controlFeedback.duration).toBe('150ms');
      expect(INTERACTION_TOKENS.asyncFeedback.duration).toBe('500ms');
    });

    it('exposes GSAP_DURATIONS and GSAP_INTERACTION_TOKENS', async () => {
      const { GSAP_DURATIONS, GSAP_INTERACTION_TOKENS } = await import('../src/v2/lib/motion/constants.js');
      expect(GSAP_DURATIONS.fast).toBe(0.15);
      expect(GSAP_INTERACTION_TOKENS.controlFeedback.duration).toBe(0.15);
      expect(GSAP_INTERACTION_TOKENS.asyncFeedback.duration).toBe(0.3);
    });
  });

  describe('useResolvedMotionDuration', () => {
    let originalMatchMedia: any;
    let matchMediaMock: any;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
      matchMediaMock = vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      window.matchMedia = matchMediaMock;
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it('returns provided duration when reduced motion is disabled', () => {
      matchMediaMock.mockImplementation(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      const { result: numResult } = renderHook(() => useReducedMotionHook.useResolvedMotionDuration(0.3));
      expect(numResult.current).toBe(0.3);

      const { result: strResult } = renderHook(() => useReducedMotionHook.useResolvedMotionDuration('300ms'));
      expect(strResult.current).toBe('300ms');
    });

    it('returns zeroed duration when reduced motion is enabled', () => {
      const { result: numResult } = renderHook(() => useReducedMotionHook.useResolvedMotionDuration(0.3));
      expect(numResult.current).toBe(0);

      const { result: strResult } = renderHook(() => useReducedMotionHook.useResolvedMotionDuration('300ms'));
      expect(strResult.current).toBe('0ms');
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
