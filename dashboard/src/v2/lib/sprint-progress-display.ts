const SPRINT_COMPLETION_PRECISION = 10;

export const clampSprintCompletion = (completion: number): number => {
  if (Number.isNaN(completion) || completion <= 0) {
    return 0;
  }
  if (completion >= 100) {
    return 100;
  }
  return Math.round(completion * SPRINT_COMPLETION_PRECISION) / SPRINT_COMPLETION_PRECISION;
};

export const formatSprintCompletion = (completion: number): string => (
  `${clampSprintCompletion(completion)}%`
);
