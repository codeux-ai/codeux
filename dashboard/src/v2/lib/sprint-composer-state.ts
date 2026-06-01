import { useState, useEffect } from "preact/hooks";
import { Rocket, ClipboardList, Save, RefreshCw, ListPlus } from "lucide-preact";
import type { AgentRoutingMode, PlanningOverrides, Sprint, VirtualWorkerProvider } from "../types.js";

export type SprintSubmitMode = "plan_and_start" | "plan_only" | "draft" | "replan" | "append_tasks";

export interface CreateMode {
  id: SprintSubmitMode;
  label: string;
  description: string;
  icon: any;
}

export const CREATE_MODES: CreateMode[] = [
  {
    id: "plan_and_start",
    label: "Plan & Start",
    description: "Create the sprint, let the Planning agent build subtasks, then launch immediately.",
    icon: Rocket,
  },
  {
    id: "plan_only",
    label: "Plan Only",
    description: "Create the sprint and have the Planning agent generate subtasks without starting execution.",
    icon: ClipboardList,
  },
  {
    id: "draft",
    label: "Save Draft",
    description: "Store the sprint only and keep planning for later.",
    icon: Save,
  },
];

export interface PlanningRouteOption {
  type: 'connected' | 'virtual';
  id: string; // connection id or virtual provider id
  label: string;
  provider?: VirtualWorkerProvider;
}

export function toPlanningOverrides(
  routeOverride: PlanningRouteOption | null,
  modelOverride: string | null,
  planningAgentPresetId: string | null = null,
  agentRoutingMode?: AgentRoutingMode | null,
  workerAgentPresetId?: string | null,
): PlanningOverrides | undefined {
  if (!routeOverride && !modelOverride && !planningAgentPresetId && !agentRoutingMode && !workerAgentPresetId) {
    return undefined;
  }

  const overrides: PlanningOverrides = {};

  if (routeOverride?.type === "connected") {
    overrides.workerId = routeOverride.id;
  } else if (routeOverride?.type === "virtual") {
    overrides.virtualProvider = routeOverride.provider;
    if (modelOverride) {
      overrides.virtualModel = modelOverride;
    }
  } else if (modelOverride) {
    overrides.virtualModel = modelOverride;
  }

  if (planningAgentPresetId) {
    overrides.planningAgentPresetId = planningAgentPresetId;
  }
  if (agentRoutingMode) {
    overrides.agentRoutingMode = agentRoutingMode;
  }
  if (workerAgentPresetId) {
    overrides.workerAgentPresetId = workerAgentPresetId;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export interface SprintComposerState {
  name: string;
  setName: (val: string) => void;
  goal: string;
  setGoal: (val: string) => void;
  originalPrompt: string | null;
  setOriginalPrompt: (val: string | null) => void;
  submitMode: SprintSubmitMode;
  setSubmitMode: (mode: SprintSubmitMode) => void;
  routeOverride: PlanningRouteOption | null;
  setRouteOverride: (route: PlanningRouteOption | null) => void;
  modelOverride: string | null;
  setModelOverride: (model: string | null) => void;
  planningAgentPresetId: string | null;
  setPlanningAgentPresetId: (id: string | null) => void;
  agentRoutingMode: AgentRoutingMode;
  setAgentRoutingMode: (mode: AgentRoutingMode) => void;
  workerAgentPresetId: string | null;
  setWorkerAgentPresetId: (id: string | null) => void;
  sprintKeyOverride: string;
  setSprintKeyOverride: (val: string) => void;
  isEditing: boolean;
  hasTasks: boolean;
  availableModes: CreateMode[];
}

export const getAvailableModes = (isEditing: boolean, hasTasks: boolean): CreateMode[] => {
  if (!isEditing) return CREATE_MODES;
  
  if (hasTasks) {
    return [
      {
        id: "replan",
        label: "Replan",
        description: "Discard existing subtasks and have the Planning agent generate a new plan.",
        icon: RefreshCw,
      },
      {
        id: "append_tasks",
        label: "Add Tasks",
        description: "Append manual tasks to this sprint without affecting existing ones.",
        icon: ListPlus,
      },
      {
        id: "draft",
        label: "Save Changes",
        description: "Update the sprint definition without triggering planning.",
        icon: Save,
      },
    ];
  }

  return [
    {
      id: "plan_and_start",
      label: "Plan & Start",
      description: "Trigger planning and launch execution immediately.",
      icon: Rocket,
    },
    {
      id: "plan_only",
      label: "Plan Only",
      description: "Trigger planning to generate subtasks without starting execution.",
      icon: ClipboardList,
    },
    {
      id: "draft",
      label: "Save Changes",
      description: "Update the sprint definition without triggering planning.",
      icon: Save,
    },
  ];
};

export const useSprintComposerState = (
  initialSprint: Sprint | null = null,
  defaultSprintKey: string = "",
  defaults: {
    planningAgentPresetId?: string | null;
    agentRoutingMode?: AgentRoutingMode;
    workerAgentPresetId?: string | null;
  } = {},
): SprintComposerState => {
  const [name, setName] = useState(initialSprint?.name || "");
  const [goal, setGoal] = useState(initialSprint?.goal || "");
  const [originalPrompt, setOriginalPrompt] = useState(initialSprint?.originalPrompt || null);
  const [submitMode, setSubmitMode] = useState<SprintSubmitMode>("plan_and_start");
  const [routeOverride, setRouteOverride] = useState<PlanningRouteOption | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [planningAgentPresetId, setPlanningAgentPresetId] = useState<string | null>(defaults.planningAgentPresetId || null);
  const [agentRoutingMode, setAgentRoutingMode] = useState<AgentRoutingMode>(defaults.agentRoutingMode || "MANUAL");
  const [workerAgentPresetId, setWorkerAgentPresetId] = useState<string | null>(defaults.workerAgentPresetId || null);
  const [sprintKeyOverride, setSprintKeyOverride] = useState<string>(defaultSprintKey);

  const isEditing = Boolean(initialSprint);
  const hasTasks = Boolean(initialSprint && initialSprint.tasksCount > 0);

  useEffect(() => {
    setName(initialSprint?.name || "");
    setGoal(initialSprint?.goal || "");
    setOriginalPrompt(initialSprint?.originalPrompt || null);
    setSubmitMode(initialSprint ? (initialSprint.tasksCount > 0 ? "replan" : "plan_and_start") : "plan_and_start");
    setRouteOverride(null);
    setModelOverride(null);
    setPlanningAgentPresetId(defaults.planningAgentPresetId || null);
    setAgentRoutingMode(defaults.agentRoutingMode || "MANUAL");
    setWorkerAgentPresetId(defaults.workerAgentPresetId || null);
    setSprintKeyOverride(defaultSprintKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSprint?.id]);

  useEffect(() => {
    setSprintKeyOverride(defaultSprintKey);
  }, [defaultSprintKey]);

  const availableModes = getAvailableModes(isEditing, hasTasks);

  return {
    name, setName,
    goal, setGoal,
    originalPrompt, setOriginalPrompt,
    submitMode, setSubmitMode,
    routeOverride, setRouteOverride,
    modelOverride, setModelOverride,
    planningAgentPresetId, setPlanningAgentPresetId,
    agentRoutingMode, setAgentRoutingMode,
    workerAgentPresetId, setWorkerAgentPresetId,
    sprintKeyOverride, setSprintKeyOverride,
    isEditing,
    hasTasks,
    availableModes,
  };
};

export function resolveSubmitOriginalPrompt(
  submitMode: SprintSubmitMode,
  originalPrompt: string | null,
  goal: string,
): string | null {
  const isPlanning = submitMode === "plan_only" || submitMode === "plan_and_start";
  if (isPlanning && !originalPrompt) {
    return goal.trim() || null;
  }
  return originalPrompt;
}
