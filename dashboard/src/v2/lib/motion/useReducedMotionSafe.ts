import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useMemo } from "preact/hooks";

export interface MotionConfig {
  /** The standard motion transition or variant */
  standard: string;
  /** The reduced motion transition or variant (often "none" or "0.01ms") */
  reduced?: string;
}

/**
 * Hook to safely apply motion based on the user's reduced-motion preference.
 * Returns the standard value if reduced motion is disabled, otherwise returns
 * the reduced value (which defaults to empty string/falsy or what is provided).
 */
export function useReducedMotionSafe<T = string>(standardValue: T, reducedValue: T): T {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    return prefersReducedMotion ? reducedValue : standardValue;
  }, [prefersReducedMotion, standardValue, reducedValue]);
}

/**
 * Utility to conditionally apply animation classes based on reduced motion.
 * Since Tailwind handles `motion-safe:` inherently well, this is mostly
 * useful for complex style objects, custom GSAP variants, or non-Tailwind contexts.
 */
export const getMotionSafeStyles = (prefersReducedMotion: boolean, styles: Record<string, any>, reducedStyles: Record<string, any> = {}) => {
  return prefersReducedMotion ? reducedStyles : styles;
};
