import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";

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
  listReveal: {
    duration: GSAP_DURATIONS.base,
    ease: GSAP_EASINGS.smooth
  },
  listReorder: {
    duration: GSAP_DURATIONS.fast,
    ease: GSAP_EASINGS.smooth
  },
  inlineValidation: {
    duration: GSAP_DURATIONS.fast,
    ease: GSAP_EASINGS.spring
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

/**
 * Hook to get GSAP interaction tokens safely resolved for reduced motion.
 * Returns durations as 0 when reduced motion is preferred.
 */
export function useGsapInteractionTokens() {
  const controlFeedbackDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.controlFeedback.duration);
  const enterExitDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.enterExit.duration);
  const expansionCollapseDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.expansionCollapse.duration);
  const selectionMovementDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.selectionMovement.duration);
  const listRevealDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.listReveal.duration);
  const listReorderDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.listReorder.duration);
  const inlineValidationDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.inlineValidation.duration);
  const asyncFeedbackDuration = useResolvedMotionDuration(GSAP_INTERACTION_TOKENS.asyncFeedback.duration);

  return {
    controlFeedback: {
      ...GSAP_INTERACTION_TOKENS.controlFeedback,
      duration: controlFeedbackDuration
    },
    enterExit: {
      ...GSAP_INTERACTION_TOKENS.enterExit,
      duration: enterExitDuration
    },
    expansionCollapse: {
      ...GSAP_INTERACTION_TOKENS.expansionCollapse,
      duration: expansionCollapseDuration
    },
    selectionMovement: {
      ...GSAP_INTERACTION_TOKENS.selectionMovement,
      duration: selectionMovementDuration
    },
    listReveal: {
      ...GSAP_INTERACTION_TOKENS.listReveal,
      duration: listRevealDuration
    },
    listReorder: {
      ...GSAP_INTERACTION_TOKENS.listReorder,
      duration: listReorderDuration
    },
    inlineValidation: {
      ...GSAP_INTERACTION_TOKENS.inlineValidation,
      duration: inlineValidationDuration
    },
    asyncFeedback: {
      ...GSAP_INTERACTION_TOKENS.asyncFeedback,
      duration: asyncFeedbackDuration
    }
  };
}
