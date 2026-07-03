import { useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";

export const INTERACTION_CONTRACT_NAMES = [
  "controlFeedback",
  "enterExit",
  "expansionCollapse",
  "selectionMovement",
  "listReveal",
  "listReorder",
  "inlineValidation",
  "asyncFeedback"
] as const;

export type InteractionContractName = typeof INTERACTION_CONTRACT_NAMES[number];

export interface CssInteractionToken {
  duration: string;
  ease: string;
}

export type CssInteractionTokenMap = Record<InteractionContractName, CssInteractionToken>;

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

export const INTERACTION_TOKENS: CssInteractionTokenMap = {
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

export const INTERACTION_CSS_VARIABLES: CssInteractionTokenMap = {
  controlFeedback: {
    duration: "var(--interaction-control-feedback-duration)",
    ease: "var(--interaction-control-feedback-ease)"
  },
  enterExit: {
    duration: "var(--interaction-enter-exit-duration)",
    ease: "var(--interaction-enter-exit-ease)"
  },
  expansionCollapse: {
    duration: "var(--interaction-expansion-collapse-duration)",
    ease: "var(--interaction-expansion-collapse-ease)"
  },
  selectionMovement: {
    duration: "var(--interaction-selection-movement-duration)",
    ease: "var(--interaction-selection-movement-ease)"
  },
  listReveal: {
    duration: "var(--interaction-list-reveal-duration)",
    ease: "var(--interaction-list-reveal-ease)"
  },
  listReorder: {
    duration: "var(--interaction-list-reorder-duration)",
    ease: "var(--interaction-list-reorder-ease)"
  },
  inlineValidation: {
    duration: "var(--interaction-inline-validation-duration)",
    ease: "var(--interaction-inline-validation-ease)"
  },
  asyncFeedback: {
    duration: "var(--interaction-async-feedback-duration)",
    ease: "var(--interaction-async-feedback-ease)"
  }
} as const;

export function buildInteractionTransition(contract: InteractionContractName, properties = "all"): string {
  const token = INTERACTION_CSS_VARIABLES[contract];
  return `${properties} ${token.duration} ${token.ease}`;
}

/**
 * Hook to get interaction tokens with CSS string durations safely resolved for reduced motion.
 * Returns durations as "0ms" when reduced motion is preferred.
 */
export function useInteractionTokens(): CssInteractionTokenMap {
  const controlFeedbackDuration = useResolvedMotionDuration(INTERACTION_TOKENS.controlFeedback.duration);
  const enterExitDuration = useResolvedMotionDuration(INTERACTION_TOKENS.enterExit.duration);
  const expansionCollapseDuration = useResolvedMotionDuration(INTERACTION_TOKENS.expansionCollapse.duration);
  const selectionMovementDuration = useResolvedMotionDuration(INTERACTION_TOKENS.selectionMovement.duration);
  const listRevealDuration = useResolvedMotionDuration(INTERACTION_TOKENS.listReveal.duration);
  const listReorderDuration = useResolvedMotionDuration(INTERACTION_TOKENS.listReorder.duration);
  const inlineValidationDuration = useResolvedMotionDuration(INTERACTION_TOKENS.inlineValidation.duration);
  const asyncFeedbackDuration = useResolvedMotionDuration(INTERACTION_TOKENS.asyncFeedback.duration);

  return {
    controlFeedback: { ...INTERACTION_TOKENS.controlFeedback, duration: controlFeedbackDuration },
    enterExit: { ...INTERACTION_TOKENS.enterExit, duration: enterExitDuration },
    expansionCollapse: { ...INTERACTION_TOKENS.expansionCollapse, duration: expansionCollapseDuration },
    selectionMovement: { ...INTERACTION_TOKENS.selectionMovement, duration: selectionMovementDuration },
    listReveal: { ...INTERACTION_TOKENS.listReveal, duration: listRevealDuration },
    listReorder: { ...INTERACTION_TOKENS.listReorder, duration: listReorderDuration },
    inlineValidation: { ...INTERACTION_TOKENS.inlineValidation, duration: inlineValidationDuration },
    asyncFeedback: { ...INTERACTION_TOKENS.asyncFeedback, duration: asyncFeedbackDuration }
  };
}
