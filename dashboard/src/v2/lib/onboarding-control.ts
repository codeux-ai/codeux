export const ONBOARDING_STORAGE_KEY = "codeux:onboarding-complete:v1";
export const ONBOARDING_OPEN_EVENT = "codeux:onboarding-open";
export const DASHBOARD_TOUR_STORAGE_KEY = "codeux:dashboard-tour-hidden:v1";
export const DASHBOARD_TOUR_START_EVENT = "codeux:dashboard-tour-start";

export const openOnboarding = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(ONBOARDING_OPEN_EVENT));
};

export const startDashboardTour = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(DASHBOARD_TOUR_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));
};
