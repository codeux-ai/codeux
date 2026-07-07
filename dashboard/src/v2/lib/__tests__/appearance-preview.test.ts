// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../lib/settings.js";
import {
  APPEARANCE_PREVIEW_EVENT,
  clearAppearancePreview,
  publishAppearancePreview,
} from "../appearance-preview.js";

describe("appearance preview helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes a non-null appearance payload", () => {
    const previews: unknown[] = [];
    const appearance = {
      ...DEFAULT_DASHBOARD_SETTINGS.appearance,
      backgroundMode: "STATIC" as const,
      staticBackgroundColor: "#123456",
    };
    const listener = (event: Event) => {
      previews.push((event as CustomEvent).detail);
    };

    window.addEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    try {
      publishAppearancePreview(appearance);

      expect(previews).toEqual([{ appearance }]);
    } finally {
      window.removeEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    }
  });

  it("publishes null to clear the preview", () => {
    const previews: unknown[] = [];
    const listener = (event: Event) => {
      previews.push((event as CustomEvent).detail);
    };

    window.addEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    try {
      publishAppearancePreview(null);

      expect(previews).toEqual([{ appearance: null }]);
    } finally {
      window.removeEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    }
  });

  it("does nothing when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(() => publishAppearancePreview(DEFAULT_DASHBOARD_SETTINGS.appearance)).not.toThrow();
    expect(() => clearAppearancePreview()).not.toThrow();
  });
});
