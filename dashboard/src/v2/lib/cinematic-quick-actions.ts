import type { DashboardCreateAppQuickactionKind } from "../types.js";
import { CREATE_APP_QUICKACTION_CATALOG } from "../../../../src/domain/chat/create-app-quickaction-catalog.js";

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
]);

const PROMPT_QUICK_ACTIONS = [
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
  },
  {
    id: "add-dashboard",
    label: "Add Dashboard",
    zone: "workflow",
    prompt: "Help me add a project dashboard. Inspect the current project and propose the most useful dashboard configuration.",
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
}

export function isInitialOnlyCreateAppQuickaction(kind: DashboardCreateAppQuickactionKind): boolean {
  return INITIAL_ONLY_APP_KINDS.has(kind);
}

export function buildCinematicQuickActions(options: CinematicQuickActionOptions): CinematicQuickAction[] {
  if (!options.hasProject) {
    return [];
  }

  const createActions: CinematicQuickAction[] = CREATE_APP_QUICKACTION_CATALOG
    .filter(({ kind }) => (
      !isInitialOnlyCreateAppQuickaction(kind)
      || (options.initialEligibilityLoaded && options.canCreateInitialAppQuickactions)
    ))
    .map(({ kind, displayLabel }, index) => ({
      id: `create-${kind}`,
      label: displayLabel,
      zone: "create",
      actionType: "create_app",
      appKind: kind,
      animationDelay: `${index * 0.18}s`,
    }));

  const promptActions: CinematicQuickAction[] = PROMPT_QUICK_ACTIONS.map((action, index) => ({
    ...action,
    actionType: "send_prompt",
    animationDelay: `${(createActions.length + index) * 0.18}s`,
  }));

  return [...createActions, ...promptActions];
}
