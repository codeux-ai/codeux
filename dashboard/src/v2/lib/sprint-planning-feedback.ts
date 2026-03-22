
export type PlanningActionType = "improve" | "plan_only" | "plan_and_start" | "replan";

export interface PlanningFeedback {
  text: string;
  progress: number; // 0 to 1 (Zeno curve for stage text)
  shipProgress: number; // 0 to 1, loops continuously for ship position
  shipType: "container" | "wooden";
}

const STAGES: Record<PlanningActionType, Array<{ text: string; threshold: number }>> = {
  improve: [
    { text: "Researching codebase context...", threshold: 0.15 },
    { text: "Refining technical requirements...", threshold: 0.40 },
    { text: "Optimizing prompt structure...", threshold: 0.70 },
    { text: "Synthesizing improved plan...", threshold: 0.95 },
  ],
  plan_only: [
    { text: "Registering sprint definition...", threshold: 0.15 },
    { text: "Researching codebase for planning context...", threshold: 0.40 },
    { text: "Orchestrating subtask generation...", threshold: 0.70 },
    { text: "Finalizing sprint structure...", threshold: 0.95 },
  ],
  plan_and_start: [
    { text: "Registering sprint definition...", threshold: 0.15 },
    { text: "Researching codebase for planning context...", threshold: 0.35 },
    { text: "Orchestrating subtask generation...", threshold: 0.65 },
    { text: "Preparing launch sequence...", threshold: 0.90 },
  ],
  replan: [
    { text: "Analyzing existing tasks...", threshold: 0.15 },
    { text: "Discarding outdated plan...", threshold: 0.35 },
    { text: "Researching codebase for replanning...", threshold: 0.60 },
    { text: "Generating new subtasks...", threshold: 0.85 },
    { text: "Finalizing new structure...", threshold: 0.98 },
  ],
};

const SHIP_LOOP_MS = 12_000; // ship crosses the track every 12 seconds

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
