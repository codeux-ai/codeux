
import { sprintAuthoringMessages } from "../i18n/messages/sprint-authoring.js";
import { DEFAULT_DASHBOARD_LOCALE, translateDashboardMessage, type DashboardLocale } from "../i18n/locales.js";

export type PlanningActionType = "improve" | "plan_only" | "plan_and_start" | "replan" | "draft" | "append_tasks" | "schedule";

export interface PlanningFeedback {
  text: string;
  progress: number; // 0 to 1 (Zeno curve for stage text)
  shipProgress: number; // 0 to 1, loops continuously for ship position
  shipType: "container" | "wooden";
  shipVisual: PlanningShipVisual;
}

export type PlanningShipVisualPhase = "entering" | "crossing" | "exiting" | "hidden";

export interface PlanningShipVisual {
  trackXPercent: number; // may be <0 or >100 while the ship is off the visible track
  opacity: number;
  visible: boolean;
  phase: PlanningShipVisualPhase;
}

type SprintAuthoringMessageKey = keyof typeof sprintAuthoringMessages.en;

const STAGES: Record<PlanningActionType, Array<{ key: SprintAuthoringMessageKey; threshold: number }>> = {
  improve: [
    { key: "stageResearching", threshold: 0.10 },
    { key: "stageAnalyzingCodebase", threshold: 0.30 },
    { key: "stageRefiningRequirements", threshold: 0.60 },
    { key: "stageSynthesizingPlan", threshold: 0.90 },
  ],
  plan_only: [
    { key: "stageRegisteringSprint", threshold: 0.10 },
    { key: "stageAnalyzingCodebase", threshold: 0.30 },
    { key: "stageResolvingDependencies", threshold: 0.50 },
    { key: "stageGeneratingSubtasks", threshold: 0.70 },
    { key: "stageFinalizingSprint", threshold: 0.90 },
  ],
  plan_and_start: [
    { key: "stageRegisteringSprint", threshold: 0.10 },
    { key: "stageAnalyzingCodebase", threshold: 0.30 },
    { key: "stageResolvingDependencies", threshold: 0.50 },
    { key: "stageGeneratingSubtasks", threshold: 0.70 },
    { key: "stagePreparingLaunch", threshold: 0.90 },
  ],
  replan: [
    { key: "stageAnalyzingTasks", threshold: 0.10 },
    { key: "stageDiscardingPlan", threshold: 0.30 },
    { key: "stageAnalyzingCodebase", threshold: 0.50 },
    { key: "stageGeneratingNewSubtasks", threshold: 0.75 },
    { key: "stageFinalizingNewPlan", threshold: 0.95 },
  ],
  draft: [
    { key: "stageSavingDraft", threshold: 0.10 },
    { key: "stageFinalizingDraft", threshold: 0.80 },
  ],
  append_tasks: [
    { key: "stageAppendingTasks", threshold: 0.10 },
    { key: "stageFinalizingAppend", threshold: 0.80 },
  ],
  schedule: [
    { key: "stageSavingSprint", threshold: 0.10 },
    { key: "stageCreatingSchedule", threshold: 0.70 },
  ],
};

export const SHIP_LOOP_MS = 12_000; // ship completes one travel/wrap loop every 12 seconds
const SHIP_TRACK_START_X_PERCENT = -20;
const SHIP_TRACK_END_X_PERCENT = 120;
const SHIP_HIDDEN_WRAP_START_PROGRESS = 0.9;

function getPlanningShipVisual(shipProgress: number): PlanningShipVisual {
  if (shipProgress >= SHIP_HIDDEN_WRAP_START_PROGRESS) {
    return {
      trackXPercent: SHIP_TRACK_START_X_PERCENT,
      opacity: 0,
      visible: false,
      phase: "hidden",
    };
  }

  const travelProgress = shipProgress / SHIP_HIDDEN_WRAP_START_PROGRESS;
  const trackXPercent = SHIP_TRACK_START_X_PERCENT
    + travelProgress * (SHIP_TRACK_END_X_PERCENT - SHIP_TRACK_START_X_PERCENT);
  const phase: PlanningShipVisualPhase = trackXPercent < 0
    ? "entering"
    : trackXPercent > 100
      ? "exiting"
      : "crossing";

  return {
    trackXPercent,
    opacity: 1,
    visible: true,
    phase,
  };
}

export const PLANNING_ACTION_LABELS: Record<PlanningActionType, string> = {
  improve: "Refining prompt...",
  plan_only: "Generating subtasks...",
  plan_and_start: "Planning and initiating...",
  replan: "Updating execution plan...",
  draft: "Saving draft...",
  append_tasks: "Appending tasks...",
  schedule: "Scheduling sprint...",
};

export const PLANNING_PENDING_MESSAGES: Record<PlanningActionType, string> = {
  improve: "Prompt improvement started. Your current draft stays visible while the Planning agent refines it.",
  plan_only: "Planning request started. The sprint will stay pending for review after subtasks are generated.",
  plan_and_start: "Plan & Start request started. The sprint will launch only after planning completes successfully.",
  replan: "Replan request started. Existing tasks stay visible until the updated plan is ready.",
  draft: "Saving draft. The sprint will remain editable after the save completes.",
  append_tasks: "Opening task append flow. Existing sprint tasks stay unchanged.",
  schedule: "Scheduling request started. The sprint will be saved and handed to the runtime scheduler.",
};

export const PLANNING_CANCELLED_MESSAGES: Record<PlanningActionType, string> = {
  improve: "Prompt improvement cancelled. Your draft is still available, and you can retry when ready.",
  plan_only: "Planning request cancelled. The sprint was not started, and you can adjust or retry the request.",
  plan_and_start: "Plan & Start request cancelled. No launch was confirmed, and you can adjust or retry the request.",
  replan: "Replan request cancelled. Existing tasks were left unchanged, and you can retry when ready.",
  draft: "Draft save cancelled. Review the sprint details and save again when ready.",
  append_tasks: "Append flow cancelled. Existing tasks were left unchanged.",
  schedule: "Schedule request cancelled. The sprint was not scheduled, and you can retry when ready.",
};

const ACTION_LABEL_KEYS: Record<PlanningActionType, SprintAuthoringMessageKey> = {
  improve: "actionRefining", plan_only: "actionGeneratingSubtasks", plan_and_start: "actionPlanningStarting",
  replan: "actionReplanning", draft: "actionSavingDraft", append_tasks: "actionAppendingTasks", schedule: "actionScheduling",
};
const PENDING_KEYS: Record<PlanningActionType, SprintAuthoringMessageKey> = {
  improve: "pendingImprove", plan_only: "pendingPlanOnly", plan_and_start: "pendingPlanStart",
  replan: "pendingReplan", draft: "pendingDraft", append_tasks: "pendingAppend", schedule: "pendingSchedule",
};
const CANCELLED_KEYS: Record<PlanningActionType, SprintAuthoringMessageKey> = {
  improve: "cancelledImprove", plan_only: "cancelledPlanOnly", plan_and_start: "cancelledPlanStart",
  replan: "cancelledReplan", draft: "cancelledDraft", append_tasks: "cancelledAppend", schedule: "cancelledSchedule",
};

const translate = (locale: DashboardLocale, key: SprintAuthoringMessageKey): string => (
  translateDashboardMessage(sprintAuthoringMessages, locale, key)
);

export function getPlanningActionLabel(
  actionType: PlanningActionType,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): string {
  return translate(locale, ACTION_LABEL_KEYS[actionType]);
}

export function getPlanningPendingMessage(actionType: PlanningActionType, locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE): string {
  return translate(locale, PENDING_KEYS[actionType]);
}

export function getPlanningCancelledMessage(actionType: PlanningActionType, locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE): string {
  return translate(locale, CANCELLED_KEYS[actionType]);
}

export function getPlanningFeedback(
  actionType: PlanningActionType,
  elapsedMs: number,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): PlanningFeedback {
  // Use a Zeno-like curve for progress so it never actually reaches 1 until it's done
  // progress = 1 - e^(-elapsed / halfLife)
  const halfLife = 8000; // 8 seconds to reach 50%
  const progress = 1 - Math.exp(-elapsedMs / halfLife);

  // Ship traversal loops continuously (sawtooth wave)
  const shipProgress = (elapsedMs % SHIP_LOOP_MS) / SHIP_LOOP_MS;

  const stages = STAGES[actionType];
  let text = translate(locale, stages[0].key);

  for (const stage of stages) {
    if (progress >= stage.threshold) {
      text = translate(locale, stage.key);
    } else {
      break;
    }
  }

  return {
    text,
    progress,
    shipProgress,
    shipType: actionType === "improve" ? "wooden" : "container",
    shipVisual: getPlanningShipVisual(shipProgress),
  };
}
