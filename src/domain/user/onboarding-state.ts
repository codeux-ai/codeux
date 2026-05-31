export interface OnboardingStateRecord {
  onboardingCompletedAt: string | null;
}

export interface OnboardingStateResponse extends OnboardingStateRecord {
  completed: boolean;
}

export const toOnboardingStateResponse = (
  state: OnboardingStateRecord,
): OnboardingStateResponse => ({
  onboardingCompletedAt: state.onboardingCompletedAt,
  completed: Boolean(state.onboardingCompletedAt),
});
