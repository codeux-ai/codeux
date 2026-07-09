
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

const STAGES: Record<PlanningActionType, Array<{ text: string; threshold: number }>> = {
  improve: [
    { text: "Researching codebase context...", threshold: 0.10 },
    { text: "Analyzing codebase...", threshold: 0.30 },
    { text: "Refining technical requirements...", threshold: 0.60 },
    { text: "Synthesizing improved plan...", threshold: 0.90 },
  ],
  plan_only: [
    { text: "Registering sprint definition...", threshold: 0.10 },
    { text: "Analyzing codebase...", threshold: 0.30 },
    { text: "Resolving dependencies...", threshold: 0.50 },
    { text: "Orchestrating subtask generation...", threshold: 0.70 },
    { text: "Finalizing sprint structure...", threshold: 0.90 },
  ],
  plan_and_start: [
    { text: "Registering sprint definition...", threshold: 0.10 },
    { text: "Analyzing codebase...", threshold: 0.30 },
    { text: "Resolving dependencies...", threshold: 0.50 },
    { text: "Orchestrating subtask generation...", threshold: 0.70 },
    { text: "Preparing launch sequence...", threshold: 0.90 },
  ],
  replan: [
    { text: "Analyzing existing tasks...", threshold: 0.10 },
    { text: "Discarding outdated plan...", threshold: 0.30 },
    { text: "Analyzing codebase...", threshold: 0.50 },
    { text: "Generating new subtasks...", threshold: 0.75 },
    { text: "Finalizing new structure...", threshold: 0.95 },
  ],
  draft: [
    { text: "Saving draft...", threshold: 0.10 },
    { text: "Finalizing draft...", threshold: 0.80 },
  ],
  append_tasks: [
    { text: "Appending tasks...", threshold: 0.10 },
    { text: "Finalizing sprint...", threshold: 0.80 },
  ],
  schedule: [
    { text: "Saving sprint definition...", threshold: 0.10 },
    { text: "Creating scheduler entry...", threshold: 0.70 },
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

export function getPlanningPendingMessage(actionType: PlanningActionType): string {
  return PLANNING_PENDING_MESSAGES[actionType];
}

export function getPlanningCancelledMessage(actionType: PlanningActionType): string {
  return PLANNING_CANCELLED_MESSAGES[actionType];
}

export function getPlanningFeedback(actionType: PlanningActionType, elapsedMs: number): PlanningFeedback {
  // Use a Zeno-like curve for progress so it never actually reaches 1 until it's done
  // progress = 1 - e^(-elapsed / halfLife)
  const halfLife = 8000; // 8 seconds to reach 50%
  const progress = 1 - Math.exp(-elapsedMs / halfLife);

  // Ship traversal loops continuously (sawtooth wave)
  const shipProgress = (elapsedMs % SHIP_LOOP_MS) / SHIP_LOOP_MS;

  const stages = STAGES[actionType];
  let text = stages[0].text;

  for (const stage of stages) {
    if (progress >= stage.threshold) {
      text = stage.text;
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
