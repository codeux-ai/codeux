import type { DashboardSettings } from "../../types.js";

export const APPEARANCE_PREVIEW_EVENT = "codeux:appearance-preview";

export interface AppearancePreviewDetail {
  appearance: DashboardSettings["appearance"] | null;
}

export function publishAppearancePreview(appearance: DashboardSettings["appearance"] | null): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<AppearancePreviewDetail>(APPEARANCE_PREVIEW_EVENT, {
    detail: { appearance },
  }));
}

export function clearAppearancePreview(): void {
  publishAppearancePreview(null);
}
