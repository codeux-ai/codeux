import { useState, useEffect } from "preact/hooks";
import { Rocket, ClipboardList, Save, RefreshCw, ListPlus, Clock3 } from "lucide-preact";
import type { AgentRoutingMode, PlanningOverrides, ProviderId, Sprint, ScheduleAnchor } from "../types.js";
import { sprintAuthoringMessages } from "../i18n/messages/sprint-authoring.js";
import { DEFAULT_DASHBOARD_LOCALE, translateDashboardMessage, type DashboardLocale } from "../i18n/locales.js";

export type SprintSubmitMode = "plan_and_start" | "plan_only" | "draft" | "replan" | "append_tasks" | "schedule";

export type SprintScheduleMode = "absolute" | "after_sprint_end";

export interface SprintScheduleConfig {
  mode: SprintScheduleMode;
  scheduledFor: string;
  sourceSprintId: string;
  offsetMinutes: number;
}

export interface SprintSchedulePayload {
  scheduledFor?: string;
  scheduleAnchor?: ScheduleAnchor;
}

export interface CreateMode {
  id: SprintSubmitMode;
  label: string;
  description: string;
  icon: any;
}

const t = (locale: DashboardLocale, key: keyof typeof sprintAuthoringMessages.en): string => (
  translateDashboardMessage(sprintAuthoringMessages, locale, key)
);

export const getCreateModes = (locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE): CreateMode[] => [
  { id: "plan_and_start", label: t(locale, "planAndStart"), description: t(locale, "createModePlanStartDescription"), icon: Rocket },
  { id: "plan_only", label: t(locale, "planOnly"), description: t(locale, "createModePlanOnlyDescription"), icon: ClipboardList },
  { id: "draft", label: t(locale, "saveDraft"), description: t(locale, "createModeDraftDescription"), icon: Save },
  { id: "schedule", label: t(locale, "schedule"), description: t(locale, "createModeScheduleDescription"), icon: Clock3 },
];

export const CREATE_MODES: CreateMode[] = getCreateModes();

export interface PlanningRouteOption {
  type: 'connected' | 'virtual';
  id: string; // connection id or virtual provider id
  label: string;
  provider?: string;
  iconProviderId?: ProviderId;
  effectiveModel?: string;
}

export interface VirtualProviderRouteMetadata {
  id?: string;
  providerConfigId?: string;
  provider?: string;
  label?: string;
  displayLabel?: string;
  iconProviderId?: ProviderId;
  effectiveModel?: string;
}

export function toVirtualPlanningRouteOption(provider: VirtualProviderRouteMetadata): PlanningRouteOption {
  const providerConfigId = provider.providerConfigId || provider.id || provider.provider || "";
  const providerType = provider.provider || provider.iconProviderId || provider.id;
  return {
    type: "virtual",
    id: providerConfigId,
    label: provider.displayLabel || provider.label || providerConfigId || provider.provider || "Provider",
    provider: providerType,
    iconProviderId: provider.iconProviderId || (provider.provider as ProviderId | undefined) || (provider.id as ProviderId | undefined),
    effectiveModel: provider.effectiveModel,
  };
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
    overrides.virtualProvider = routeOverride.provider as PlanningOverrides["virtualProvider"];
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
  hasAttemptedSubmit: boolean;
  setHasAttemptedSubmit: (val: boolean) => void;
  hasAttemptedImprove: boolean;
  setHasAttemptedImprove: (val: boolean) => void;
  isEditing: boolean;
  hasTasks: boolean;
  availableModes: CreateMode[];
}

export const getAvailableModes = (
  isEditing: boolean,
  hasTasks: boolean,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): CreateMode[] => {
  if (!isEditing) return getCreateModes(locale);
  
  if (hasTasks) {
    return [
      {
        id: "replan",
        label: t(locale, "replan"),
        description: t(locale, "editModeReplanDescription"),
        icon: RefreshCw,
      },
      {
        id: "append_tasks",
        label: t(locale, "addTasks"),
        description: t(locale, "editModeAddTasksDescription"),
        icon: ListPlus,
      },
      {
        id: "draft",
        label: t(locale, "saveChanges"),
        description: t(locale, "editModeSaveDescription"),
        icon: Save,
      },
      {
        id: "schedule",
        label: t(locale, "schedule"),
        description: t(locale, "editModeScheduleDescription"),
        icon: Clock3,
      },
    ];
  }

  return [
    {
      id: "plan_and_start",
      label: t(locale, "planAndStart"),
      description: t(locale, "editEmptyPlanStartDescription"),
      icon: Rocket,
    },
    {
      id: "plan_only",
      label: t(locale, "planOnly"),
      description: t(locale, "editEmptyPlanOnlyDescription"),
      icon: ClipboardList,
    },
    {
      id: "draft",
      label: t(locale, "saveChanges"),
      description: t(locale, "editModeSaveDescription"),
      icon: Save,
    },
    {
      id: "schedule",
      label: t(locale, "schedule"),
      description: t(locale, "editModeScheduleDescription"),
      icon: Clock3,
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
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [hasAttemptedImprove, setHasAttemptedImprove] = useState(false);

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
    setHasAttemptedSubmit(false);
    setHasAttemptedImprove(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSprint?.id]);

  const availableModes = getAvailableModes(isEditing, hasTasks, locale);

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
    hasAttemptedSubmit, setHasAttemptedSubmit,
    hasAttemptedImprove, setHasAttemptedImprove,
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

export function toSprintSchedulePayload(config: SprintScheduleConfig): SprintSchedulePayload {
  if (config.mode === "after_sprint_end") {
    return {
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: config.sourceSprintId,
        offsetMinutes: Math.max(0, Math.floor(Number(config.offsetMinutes) || 0)),
      },
    };
  }

  return {
    scheduledFor: new Date(config.scheduledFor).toISOString(),
  };
}
