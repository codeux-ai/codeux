export const SETTINGS_NAVIGATION_SESSION_KEY = "codeux:settings-navigation:v1";

export interface SettingsNavigationState {
  activeCategory: string;
  activeInvocationRoute: string;
  focusedSections: Record<string, string>;
}

const isSafeNavigationToken = (value: unknown): value is string => (
  typeof value === "string"
  && value.length > 0
  && value.length <= 160
  && !/[\u0000-\u001f]/.test(value)
);

export const readSettingsNavigationState = (): SettingsNavigationState | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SETTINGS_NAVIGATION_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isSafeNavigationToken(parsed.activeCategory) || !isSafeNavigationToken(parsed.activeInvocationRoute)) {
      return null;
    }
    const focusedSectionsInput = parsed.focusedSections;
    const focusedSections = focusedSectionsInput && typeof focusedSectionsInput === "object" && !Array.isArray(focusedSectionsInput)
      ? Object.fromEntries(
        Object.entries(focusedSectionsInput)
          .filter(([category, section]) => isSafeNavigationToken(category) && isSafeNavigationToken(section)),
      ) as Record<string, string>
      : {};
    return {
      activeCategory: parsed.activeCategory,
      activeInvocationRoute: parsed.activeInvocationRoute,
      focusedSections,
    };
  } catch {
    return null;
  }
};

export const writeSettingsNavigationState = (state: SettingsNavigationState): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(SETTINGS_NAVIGATION_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Settings navigation is a convenience only; storage restrictions must not break the page.
  }
};
