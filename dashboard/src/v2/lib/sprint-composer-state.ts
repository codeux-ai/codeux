import { useState, useEffect } from "preact/hooks";
import { Rocket, ClipboardList, Save, RefreshCw } from "lucide-preact";
import type { PlanningOverrides, Sprint, VirtualWorkerProvider } from "../types.js";

export type SprintSubmitMode = "plan_and_start" | "plan_only" | "draft" | "replan";

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
): PlanningOverrides | undefined {
  if (!routeOverride && !modelOverride && !planningAgentPresetId) {
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

export const useSprintComposerState = (initialSprint: Sprint | null = null): SprintComposerState => {
  const [name, setName] = useState(initialSprint?.name || "");
  const [goal, setGoal] = useState(initialSprint?.goal || "");
  const [originalPrompt, setOriginalPrompt] = useState(initialSprint?.originalPrompt || null);
  const [submitMode, setSubmitMode] = useState<SprintSubmitMode>("plan_and_start");
  const [routeOverride, setRouteOverride] = useState<PlanningRouteOption | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [planningAgentPresetId, setPlanningAgentPresetId] = useState<string | null>(null);

  const isEditing = Boolean(initialSprint);
  const hasTasks = Boolean(initialSprint && initialSprint.tasksCount > 0);

  useEffect(() => {
    setName(initialSprint?.name || "");
    setGoal(initialSprint?.goal || "");
    setOriginalPrompt(initialSprint?.originalPrompt || null);
    setSubmitMode(initialSprint ? (initialSprint.tasksCount > 0 ? "replan" : "plan_and_start") : "plan_and_start");
    setRouteOverride(null);
    setModelOverride(null);
    setPlanningAgentPresetId(null);
  }, [initialSprint?.id]);

  const availableModes = getAvailableModes(isEditing, hasTasks);

  return {
    name, setName,
    goal, setGoal,
    originalPrompt, setOriginalPrompt,
    submitMode, setSubmitMode,
    routeOverride, setRouteOverride,
    modelOverride, setModelOverride,
    planningAgentPresetId, setPlanningAgentPresetId,
    isEditing,
    hasTasks,
    availableModes,
  };
};
