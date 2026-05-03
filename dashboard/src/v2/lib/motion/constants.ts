import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export const GSAP_DURATIONS = {
  fast: 0.15,
  base: 0.2,
  slow: 0.3
} as const;

export const GSAP_EASINGS = {
  spring: "elastic.out(1, 0.4)",
  smooth: "power2.out",
  smoothInOut: "power2.inOut",
  linear: "linear"
} as const;

export function useGsapDurations() {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    return {
      fast: 0,
      base: 0,
      slow: 0
    };
  }
  return GSAP_DURATIONS;
}
