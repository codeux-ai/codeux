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
