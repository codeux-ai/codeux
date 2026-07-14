import type { DashboardCreateAppQuickactionKind } from "../types.js";
import { CREATE_APP_QUICKACTION_CATALOG } from "../../../../src/domain/chat/create-app-quickaction-catalog.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage } from "../i18n/messages/chat.js";
import {
  isDashboardFeatureEnabled,
  resolveDashboardFeatureFlags,
  type DashboardFeatureFlagMap,
  type DashboardFeatureId,
} from "./dashboard-feature-flags.js";

export type CinematicQuickActionZone = "create" | "insight" | "workflow";

export type CinematicQuickAction = {
  id: string;
  label: string;
  zone: CinematicQuickActionZone;
  animationDelay: string;
} & (
  | {
      actionType: "create_app";
      appKind: DashboardCreateAppQuickactionKind;
    }
  | {
      actionType: "send_prompt";
      prompt: string;
    }
);

const INITIAL_ONLY_APP_KINDS = new Set<DashboardCreateAppQuickactionKind>([
  "web_app",
  "desktop_app",
  "online_shop",
  "portfolio",
  "game",
]);

type PromptQuickAction = {
  id: string;
  label: string;
  zone: "insight" | "workflow";
  prompt: string;
  feature?: DashboardFeatureId;
  requiredSurfaceFeature?: DashboardFeatureId;
};

const PROMPT_QUICK_ACTIONS: readonly PromptQuickAction[] = [
  {
    id: "status-report",
    label: "Status Report",
    zone: "insight",
    prompt: "Give me a concise status report for this project, including CI health, running work, and anything blocked.",
  },
  {
    id: "sprint-progress",
    label: "Sprint Progress",
    zone: "insight",
    prompt: "Summarize the current sprint progress, task completion, and what is next.",
  },
  {
    id: "whats-failing",
    label: "What’s Failing?",
    zone: "insight",
    prompt: "Identify what is currently failing or blocked in this project and recommend the next corrective action.",
  },
  {
    id: "plan-next-steps",
    label: "Plan Next Steps",
    zone: "insight",
    prompt: "Propose the next steps for this project as a short prioritized task list.",
  },
  {
    id: "add-nodes-workflow",
    label: "Add Nodes Workflow",
    zone: "workflow",
    prompt: "Help me add a project-scoped Nodes workflow. Inspect the current project and propose the workflow before making changes.",
    feature: "chat-nodes-workflow-quick-action",
    requiredSurfaceFeature: "nodes",
  },
  {
    id: "add-dashboard",
    label: "Add Dashboard",
    zone: "workflow",
    prompt: "Help me add a project dashboard. Inspect the current project and propose the most useful dashboard configuration.",
    feature: "chat-custom-dashboard-quick-action",
    requiredSurfaceFeature: "custom-dashboards",
  },
  {
    id: "create-skill",
    label: "Create Skill",
    zone: "workflow",
    prompt: "Help me create a project-scoped skill for this project. Start by identifying the most useful reusable workflow.",
  },
  {
    id: "list-skills",
    label: "List Skills",
    zone: "workflow",
    prompt: "List the skills available to this project and briefly explain when to use each one.",
  },
] as const;

export interface CinematicQuickActionOptions {
  hasProject: boolean;
  initialEligibilityLoaded: boolean;
  canCreateInitialAppQuickactions: boolean;
  featureFlags?: DashboardFeatureFlagMap;
}

export function isInitialProjectCreateAppQuickaction(kind: DashboardCreateAppQuickactionKind): boolean {
  return INITIAL_ONLY_APP_KINDS.has(kind);
}

const CREATE_ACTION_LABEL_KEYS: Record<DashboardCreateAppQuickactionKind, Parameters<typeof translateChatMessage>[1]> = {
  web_app: "createWebApp",
  desktop_app: "createDesktopApp",
  online_shop: "createOnlineShop",
  portfolio: "createPortfolio",
  game: "createGame",
};

const PROMPT_ACTION_LABEL_KEYS: Record<string, Parameters<typeof translateChatMessage>[1]> = {
  "status-report": "statusReport",
  "sprint-progress": "sprintProgress",
  "whats-failing": "whatsFailing",
  "plan-next-steps": "planNextSteps",
  "add-nodes-workflow": "addNodesWorkflow",
  "add-dashboard": "addDashboard",
  "create-skill": "createSkill",
  "list-skills": "listSkills",
};

export function buildCinematicQuickActions(
  options: CinematicQuickActionOptions,
  locale: DashboardLocale = "en",
): CinematicQuickAction[] {
  if (!options.hasProject) {
    return [];
  }

  const createActions: CinematicQuickAction[] = CREATE_APP_QUICKACTION_CATALOG
    .filter(({ kind }) => (
      !isInitialProjectCreateAppQuickaction(kind)
      || (options.initialEligibilityLoaded && options.canCreateInitialAppQuickactions)
    ))
    .map(({ kind, displayLabel }, index) => ({
      id: `create-${kind}`,
      label: locale === "en" ? displayLabel : translateChatMessage(locale, CREATE_ACTION_LABEL_KEYS[kind]),
      zone: "create",
      actionType: "create_app",
      appKind: kind,
      animationDelay: `${index * 0.18}s`,
    }));

  const featureFlags = options.featureFlags ?? resolveDashboardFeatureFlags();
  const promptActions: CinematicQuickAction[] = PROMPT_QUICK_ACTIONS
    .filter((action) => (
      (!action.feature || isDashboardFeatureEnabled(action.feature, featureFlags))
      && (!action.requiredSurfaceFeature || isDashboardFeatureEnabled(action.requiredSurfaceFeature, featureFlags))
    ))
    .map(({ feature: _feature, requiredSurfaceFeature: _requiredSurfaceFeature, ...action }, index) => ({
      ...action,
      label: translateChatMessage(locale, PROMPT_ACTION_LABEL_KEYS[action.id]),
      actionType: "send_prompt",
      animationDelay: `${(createActions.length + index) * 0.18}s`,
    }));

  return [...createActions, ...promptActions];
}
