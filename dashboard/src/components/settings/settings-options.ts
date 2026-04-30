import type { DashboardSettings } from "../../types.js";

export const automationOptions: Array<{ value: DashboardSettings["automationLevel"]; label: string }> = [
  { value: "FULL", label: "Full" },
  { value: "SEMI_AUTO", label: "Semi Auto" },
  { value: "ALWAYS_ASK", label: "Always Ask" },
];

export const providerOptions: Array<{ value: DashboardSettings["aiProvider"]["provider"]; label: string }> = [
  { value: "jules", label: "Jules" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "claude-code", label: "Claude Code" },
  { value: "qwen-code", label: "Qwen Code" },
];

export const providerStrategyOptions: Array<{ value: DashboardSettings["aiProvider"]["strategy"]; label: string }> = [
  { value: "MANUAL", label: "Manual Default" },
  { value: "WEIGHTED", label: "Weighted Distribution" },
  { value: "ORCHESTRATOR", label: "Orchestrator Auto Routing" },
];

export const thinkingModeOptions: Array<{ value: "SMALL" | "MEDIUM" | "HIGH"; label: string }> = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

export const executionModeOptions: Array<{ value: DashboardSettings["cliWorkflow"]["executionMode"]; label: string }> = [
  { value: "DOCKER", label: "Docker Container" },
];

export const geminiModelOptions = [
  "default",
  "gemini-3.1-pro-preview",
  "gemini-3.0-pro-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
] as const;

export const claudeCodeModelOptions = [
  "default",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

type SprintLoopToggleKey = Exclude<
  keyof DashboardSettings["sprintLoopSteps"],
  "watchLoopIntervalSeconds" | "watchLoopOutputIntervalSeconds"
>;

export const loopStepOptions: Array<{ key: SprintLoopToggleKey; label: string; detail: string }> = [
  { key: "branchPreflight", label: "Branch Preflight", detail: "Validate local/remote sprint branch before orchestration." },
  { key: "planningPreflight", label: "Planning Preflight", detail: "Block status/orchestration when no sprint subtasks exist." },
  { key: "loadSubtasks", label: "Load Subtasks", detail: "Read sprint subtask markdown files from disk." },
  { key: "sessionSync", label: "Session Sync", detail: "Pull existing Jules sessions and attach IDs/activities." },
  { key: "statusDerivation", label: "Status Derivation", detail: "Calculate PENDING/RUNNING/BLOCKED/COMPLETED/FAILED." },
  { key: "startReadyTasks", label: "Start Ready Tasks", detail: "Create new Jules sessions for ready independent tasks." },
  { key: "mergeProtocol", label: "Merge Protocol", detail: "Emit merge instructions for completed but unmerged tasks." },
  { key: "actionRequiredProtocol", label: "Action Required Protocol", detail: "Emit instructions for paused/approval feedback states." },
  { key: "statusTable", label: "Status Table", detail: "Render the task status table in reports." },
  { key: "watchLoop", label: "Watch Loop", detail: "Allow long-running orchestration watch mode." },
];
