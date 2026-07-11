import type { DashboardCreateAppQuickactionKind } from "../../contracts/connection-chat-types.js";
import type { PlanningDesignGuidanceSelection } from "../../contracts/project-management-types.js";
import {
  CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
  CODE_UX_PRODUCT_TECH_STACK_ID,
  ECOMMERCE_STYLEGUIDE_ID,
  ELECTRON_DESKTOP_APP_TECH_STACK_ID,
  GAME_EXPERIENCE_STYLEGUIDE_ID,
  MARKETING_SITE_STYLEGUIDE_ID,
} from "../settings/design-guidance-catalog.js";

export type CreateAppQuickactionDesignGuidanceSelection = PlanningDesignGuidanceSelection;

export interface CreateAppQuickactionSpec {
  kind: DashboardCreateAppQuickactionKind;
  displayLabel: string;
  appKindLabel: string;
  templateId: string;
  designGuidance: CreateAppQuickactionDesignGuidanceSelection;
}

export const CREATE_APP_QUICKACTION_CATALOG: readonly CreateAppQuickactionSpec[] = [
  {
    kind: "web_app",
    displayLabel: "Create Web App",
    appKindLabel: "Web app",
    templateId: "qs-create-web-app",
    designGuidance: {
      selectedTechStackId: CODE_UX_PRODUCT_TECH_STACK_ID,
      selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
    },
  },
  {
    kind: "desktop_app",
    displayLabel: "Create Desktop App",
    appKindLabel: "Desktop app",
    templateId: "qs-create-desktop-app",
    designGuidance: {
      selectedTechStackId: ELECTRON_DESKTOP_APP_TECH_STACK_ID,
      selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
    },
  },
  {
    kind: "online_shop",
    displayLabel: "Create Onlineshop",
    appKindLabel: "Online shop",
    templateId: "qs-create-online-shop",
    designGuidance: {
      selectedTechStackId: CODE_UX_PRODUCT_TECH_STACK_ID,
      selectedStyleguideId: ECOMMERCE_STYLEGUIDE_ID,
    },
  },
  {
    kind: "portfolio",
    displayLabel: "Create Portfolio",
    appKindLabel: "Portfolio",
    templateId: "qs-create-portfolio",
    designGuidance: {
      selectedTechStackId: CODE_UX_PRODUCT_TECH_STACK_ID,
      selectedStyleguideId: MARKETING_SITE_STYLEGUIDE_ID,
    },
  },
  {
    kind: "game",
    displayLabel: "Create Game",
    appKindLabel: "Game",
    templateId: "qs-create-game",
    designGuidance: {
      selectedTechStackId: CODE_UX_PRODUCT_TECH_STACK_ID,
      selectedStyleguideId: GAME_EXPERIENCE_STYLEGUIDE_ID,
    },
  },
] as const;

const CREATE_APP_QUICKACTION_BY_KIND = new Map(
  CREATE_APP_QUICKACTION_CATALOG.map((spec) => [spec.kind, spec]),
);

export function getCreateAppQuickactionSpec(
  kind: DashboardCreateAppQuickactionKind,
): CreateAppQuickactionSpec {
  const spec = CREATE_APP_QUICKACTION_BY_KIND.get(kind);
  if (!spec) {
    throw new Error(`Unsupported create-app quickaction kind: ${kind}`);
  }
  return spec;
}
