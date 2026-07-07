import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import {
  filterSettingsCategoriesByExperienceMode,
  getSettingsExperienceMode,
  isEasySettingsExperience,
  shouldShowExpertSettings,
} from "../../../dashboard/src/v2/lib/settings-experience-mode.js";

describe("settings experience mode helpers", () => {
  it("keeps Easy mode focused on user-essential settings categories", () => {
    expect(filterSettingsCategoriesByExperienceMode(CATEGORIES, "EASY").map((category) => category.id)).toEqual([
      "general",
      "appearance",
      "integrations",
      "danger",
    ]);
  });

  it("keeps Standard mode broad while hiding specialist settings categories", () => {
    const categoryIds = filterSettingsCategoriesByExperienceMode(CATEGORIES, "STANDARD").map((category) => category.id);

    expect(categoryIds).toContain("general");
    expect(categoryIds).toContain("models");
    expect(categoryIds).toContain("sprint");
    expect(categoryIds).toContain("integrations");
    expect(categoryIds).not.toContain("mcp");
  });

  it("leaves Expert mode unfiltered and normalizes unknown values to Expert", () => {
    expect(filterSettingsCategoriesByExperienceMode(CATEGORIES, "EXPERT")).toEqual(CATEGORIES);
    expect(getSettingsExperienceMode("unexpected" as never)).toBe("EXPERT");
    expect(shouldShowExpertSettings(undefined)).toBe(true);
    expect(shouldShowExpertSettings("STANDARD")).toBe(false);
    expect(isEasySettingsExperience("EASY")).toBe(true);
  });
});
