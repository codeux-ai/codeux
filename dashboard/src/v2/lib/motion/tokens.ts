import { useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";

export const MOTION_TOKENS = {
  timing: {
    fast: "150ms",
    standard: "300ms",
    slow: "500ms"
  },
  easing: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    dramatic: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    linear: "linear"
  }
} as const;

export const INTERACTION_TOKENS = {
  controlFeedback: {
    duration: MOTION_TOKENS.timing.fast,
    ease: MOTION_TOKENS.easing.standard
  },
  enterExit: {
    duration: MOTION_TOKENS.timing.standard,
    ease: MOTION_TOKENS.easing.standard
  },
  expansionCollapse: {
    duration: MOTION_TOKENS.timing.standard,
    ease: MOTION_TOKENS.easing.standard
  },
  selectionMovement: {
    duration: MOTION_TOKENS.timing.fast,
    ease: MOTION_TOKENS.easing.standard
  },
  listReveal: {
    duration: MOTION_TOKENS.timing.standard,
    ease: MOTION_TOKENS.easing.standard
  },
  listReorder: {
    duration: MOTION_TOKENS.timing.fast,
    ease: MOTION_TOKENS.easing.standard
  },
  inlineValidation: {
    duration: MOTION_TOKENS.timing.fast,
    ease: MOTION_TOKENS.easing.bounce
  },
  asyncFeedback: {
    duration: MOTION_TOKENS.timing.slow,
    ease: MOTION_TOKENS.easing.linear
  }
} as const;

/**
 * Hook to get interaction tokens with CSS string durations safely resolved for reduced motion.
 * Returns durations as "0ms" when reduced motion is preferred.
 */
export function useInteractionTokens() {
  const controlFeedbackDuration = useResolvedMotionDuration(INTERACTION_TOKENS.controlFeedback.duration);
  const enterExitDuration = useResolvedMotionDuration(INTERACTION_TOKENS.enterExit.duration);
  const expansionCollapseDuration = useResolvedMotionDuration(INTERACTION_TOKENS.expansionCollapse.duration);
  const selectionMovementDuration = useResolvedMotionDuration(INTERACTION_TOKENS.selectionMovement.duration);
  const listRevealDuration = useResolvedMotionDuration(INTERACTION_TOKENS.listReveal.duration);
  const listReorderDuration = useResolvedMotionDuration(INTERACTION_TOKENS.listReorder.duration);
  const inlineValidationDuration = useResolvedMotionDuration(INTERACTION_TOKENS.inlineValidation.duration);
  const asyncFeedbackDuration = useResolvedMotionDuration(INTERACTION_TOKENS.asyncFeedback.duration);

  return {
    controlFeedback: {
      ...INTERACTION_TOKENS.controlFeedback,
      duration: controlFeedbackDuration
    },
    enterExit: {
      ...INTERACTION_TOKENS.enterExit,
      duration: enterExitDuration
    },
    expansionCollapse: {
      ...INTERACTION_TOKENS.expansionCollapse,
      duration: expansionCollapseDuration
    },
    selectionMovement: {
      ...INTERACTION_TOKENS.selectionMovement,
      duration: selectionMovementDuration
    },
    listReveal: {
      ...INTERACTION_TOKENS.listReveal,
      duration: listRevealDuration
    },
    listReorder: {
      ...INTERACTION_TOKENS.listReorder,
      duration: listReorderDuration
    },
    inlineValidation: {
      ...INTERACTION_TOKENS.inlineValidation,
      duration: inlineValidationDuration
    },
    asyncFeedback: {
      ...INTERACTION_TOKENS.asyncFeedback,
      duration: asyncFeedbackDuration
    }
  };
}
