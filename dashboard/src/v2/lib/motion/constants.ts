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

export const GSAP_INTERACTION_TOKENS = {
  controlFeedback: {
    duration: GSAP_DURATIONS.fast,
    ease: GSAP_EASINGS.smooth
  },
  enterExit: {
    duration: GSAP_DURATIONS.base,
    ease: GSAP_EASINGS.smooth
  },
  expansionCollapse: {
    duration: GSAP_DURATIONS.base,
    ease: GSAP_EASINGS.smoothInOut
  },
  selectionMovement: {
    duration: GSAP_DURATIONS.fast,
    ease: GSAP_EASINGS.smooth
  },
  asyncFeedback: {
    duration: GSAP_DURATIONS.slow,
    ease: GSAP_EASINGS.linear
  }
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

export function useGsapInteractionTokens() {
  const durations = useGsapDurations();
  return {
    controlFeedback: {
      duration: durations.fast,
      ease: GSAP_EASINGS.smooth
    },
    enterExit: {
      duration: durations.base,
      ease: GSAP_EASINGS.smooth
    },
    expansionCollapse: {
      duration: durations.base,
      ease: GSAP_EASINGS.smoothInOut
    },
    selectionMovement: {
      duration: durations.fast,
      ease: GSAP_EASINGS.smooth
    },
    asyncFeedback: {
      duration: durations.slow,
      ease: GSAP_EASINGS.linear
    }
  };
}
