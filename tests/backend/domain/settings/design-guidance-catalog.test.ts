import { describe, expect, it } from "vitest";
import {
  CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
  DESIGN_GUIDANCE_NONE_ID,
  getDefaultDesignGuidanceStyleguides,
  getDefaultDesignGuidanceTechStacks,
  getDesignGuidanceCatalog,
  getVisibleDesignGuidanceStyleguides,
  sanitizeDesignGuidanceSettings,
} from "../../../../src/domain/settings/design-guidance-catalog.js";

describe("design-guidance-catalog", () => {
  it("provides none, Code UX, and scoped default styleguide entries", () => {
    const styleguides = getDefaultDesignGuidanceStyleguides();
    const techStacks = getDefaultDesignGuidanceTechStacks();

    expect(styleguides).toHaveLength(17);
    expect(styleguides[0]?.id).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(styleguides.some((entry) => entry.id === CODE_UX_AWARD_WINNING_STYLEGUIDE_ID)).toBe(true);
    expect(techStacks[0]?.id).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(techStacks.length).toBeGreaterThanOrEqual(4);
    for (const entry of [...styleguides, ...techStacks]) {
      expect(entry.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
      expect(entry.name.trim()).toBe(entry.name);
      expect(entry.summary.trim()).toBe(entry.summary);
      expect(entry.instructionMarkdown.trim()).toBe(entry.instructionMarkdown);
    }
  });

  it("keeps default styleguides in the backend catalog when hidden from visible choices", () => {
    const settings = sanitizeDesignGuidanceSettings({
      selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
      hideDefaultStyleguides: true,
      customStyleguides: [
        {
          id: "custom-style",
          name: "Custom Style",
          summary: "Custom summary.",
          instructionMarkdown: "Use context-specific design judgment.",
        },
      ],
    });

    const catalog = getDesignGuidanceCatalog(settings);
    const visibleStyleguides = getVisibleDesignGuidanceStyleguides(settings);

    expect(settings.selectedStyleguideId).toBe(CODE_UX_AWARD_WINNING_STYLEGUIDE_ID);
    expect(catalog.styleguides.some((entry) => entry.id === CODE_UX_AWARD_WINNING_STYLEGUIDE_ID)).toBe(true);
    expect(visibleStyleguides.map((entry) => entry.id)).toEqual([DESIGN_GUIDANCE_NONE_ID, "custom-style"]);
  });

  it("falls invalid selected ids back to none while preserving valid custom entries", () => {
    const settings = sanitizeDesignGuidanceSettings({
      selectedTechStackId: "missing-stack",
      selectedStyleguideId: "custom-style",
      customTechStacks: [
        {
          id: "custom-stack",
          name: "Custom Stack",
          summary: "Custom stack.",
          instructionMarkdown: "Use typed boundaries.",
        },
      ],
      customStyleguides: [
        {
          id: "custom-style",
          name: "Custom Style",
          summary: "Custom style.",
          instructionMarkdown: "Use senior design judgment.",
        },
      ],
    });

    expect(settings.selectedTechStackId).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(settings.selectedStyleguideId).toBe("custom-style");
    expect(settings.customTechStacks).toHaveLength(1);
    expect(settings.customStyleguides).toHaveLength(1);
  });
});
