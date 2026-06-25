
export type PlanningActionType = "improve" | "plan_only" | "plan_and_start" | "replan" | "draft" | "append_tasks";

export interface PlanningFeedback {
  text: string;
  progress: number; // 0 to 1 (Zeno curve for stage text)
  shipProgress: number; // 0 to 1, loops continuously for ship position
  shipType: "container" | "wooden";
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
};

const SHIP_LOOP_MS = 12_000; // ship crosses the track every 12 seconds

export const PLANNING_ACTION_LABELS: Record<PlanningActionType, string> = {
  improve: "Refining prompt...",
  plan_only: "Generating subtasks...",
  plan_and_start: "Planning and initiating...",
  replan: "Updating execution plan...",
  draft: "Saving draft...",
  append_tasks: "Appending tasks...",
};

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
  };
}
