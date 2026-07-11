import { describe, expect, it } from "vitest";
import { DASHBOARD_CREATE_APP_QUICKACTION_KINDS } from "../../../../src/contracts/connection-chat-types.js";
import {
  CREATE_APP_QUICKACTION_CATALOG,
  getCreateAppQuickactionSpec,
} from "../../../../src/domain/chat/create-app-quickaction-catalog.js";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../../../../src/domain/quicksprint/quicksprint-catalog.js";
import { getDesignGuidanceCatalog } from "../../../../src/domain/settings/design-guidance-catalog.js";

describe("create-app-quickaction-catalog", () => {
  it("defines every stable kind, label, template, app label, and guidance selection", () => {
    expect(CREATE_APP_QUICKACTION_CATALOG).toEqual([
      {
        kind: "web_app",
        displayLabel: "Create Web App",
        appKindLabel: "Web app",
        templateId: "qs-create-web-app",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "code-ux-award-winning",
        },
      },
      {
        kind: "desktop_app",
        displayLabel: "Create Desktop App",
        appKindLabel: "Desktop app",
        templateId: "qs-create-desktop-app",
        designGuidance: {
          selectedTechStackId: "electron-desktop-app",
          selectedStyleguideId: "code-ux-award-winning",
        },
      },
      {
        kind: "online_shop",
        displayLabel: "Create Onlineshop",
        appKindLabel: "Online shop",
        templateId: "qs-create-online-shop",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "ecommerce",
        },
      },
      {
        kind: "portfolio",
        displayLabel: "Create Portfolio",
        appKindLabel: "Portfolio",
        templateId: "qs-create-portfolio",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "marketing-site",
        },
      },
      {
        kind: "game",
        displayLabel: "Create Game",
        appKindLabel: "Game",
        templateId: "qs-create-game",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "game-experience",
        },
      },
    ]);
    expect(CREATE_APP_QUICKACTION_CATALOG.map((entry) => entry.kind))
      .toEqual(DASHBOARD_CREATE_APP_QUICKACTION_KINDS);
  });

  it("resolves every selection to valid guidance and a matching built-in template", () => {
    const guidance = getDesignGuidanceCatalog();
    const techStackIds = new Set(guidance.techStacks.map((entry) => entry.id));
    const styleguideIds = new Set(guidance.styleguides.map((entry) => entry.id));
    const templatesById = new Map(BUILTIN_QUICKSPRINT_TEMPLATES.map((template) => [template.id, template]));

    for (const spec of CREATE_APP_QUICKACTION_CATALOG) {
      expect(getCreateAppQuickactionSpec(spec.kind)).toBe(spec);
      expect(techStackIds.has(spec.designGuidance.selectedTechStackId)).toBe(true);
      expect(styleguideIds.has(spec.designGuidance.selectedStyleguideId)).toBe(true);
      expect(templatesById.get(spec.templateId)?.name).toBe(spec.displayLabel);
    }
    expect(new Set(CREATE_APP_QUICKACTION_CATALOG.map((entry) => entry.templateId)).size).toBe(5);
  });
});
