import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Check, Loader2, Plus, Settings2, Target, X, Zap } from "lucide-preact";
import type { AgentPreset, ProjectGoalRecord, ProviderId } from "../../types.js";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";

interface VirtualProviderOption {
  id?: string;
  providerConfigId?: string;
  provider?: string;
  label?: string;
  displayLabel?: string;
  iconProviderId?: ProviderId;
  effectiveModel?: string;
}

const EMPTY_GOALS: ProjectGoalRecord[] = [];

interface GoalSprintPanelProps {
  goals?: ProjectGoalRecord[];
  agentPresets?: AgentPreset[];
  virtualProviders?: VirtualProviderOption[];
  defaultRouteOptionLabel?: string;
  defaultModelOptionLabel?: string;
  defaultRouteIconProviderId?: ProviderId | null;
  defaultPlanningAgentPresetId?: string | null;
  onClose: () => void;
  onCreateGoal?: (input: { title: string; description?: string }) => Promise<ProjectGoalRecord>;
  onExecute: (input: {
    goalIds: string[];
    minTasks: number;
    maxTasks: number;
    minSprints: number;
    maxSprints: number;
    submitMode: "plan_only" | "plan_and_start";
    routeOverride?: PlanningRouteOption | null;
    modelOverride?: string | null;
    planningAgentPresetId?: string | null;
  }) => Promise<void>;
}

export const GoalSprintPanel: FunctionComponent<GoalSprintPanelProps> = ({
  goals = EMPTY_GOALS,
  agentPresets = [],
  virtualProviders = [],
  defaultRouteOptionLabel = "Default Route",
  defaultModelOptionLabel = "Default Model",
  defaultRouteIconProviderId = null,
  defaultPlanningAgentPresetId = null,
  onClose,
  onCreateGoal,
  onExecute,
}) => {
  const [selectedGoalIds, setSelectedGoalIds] = useState<Set<string>>(() => new Set(goals.map((goal) => goal.id)));
  const [createdGoals, setCreatedGoals] = useState<ProjectGoalRecord[]>([]);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDescription, setNewGoalDescription] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [minTasks, setMinTasks] = useState(3);
  const [maxTasks, setMaxTasks] = useState(12);
  const [minSprints, setMinSprints] = useState(1);
  const [maxSprints, setMaxSprints] = useState(3);
  const [submitMode, setSubmitMode] = useState<"plan_only" | "plan_and_start">("plan_and_start");
  const [routeOverride, setRouteOverride] = useState<PlanningRouteOption | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [planningAgentPresetId, setPlanningAgentPresetId] = useState<string | null>(defaultPlanningAgentPresetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allGoals = useMemo(() => {
    const existingIds = new Set(goals.map((goal) => goal.id));
    return [
      ...goals,
      ...createdGoals.filter((goal) => !existingIds.has(goal.id) && goal.status === "active"),
    ];
  }, [createdGoals, goals]);
  const selectedCount = selectedGoalIds.size;
  const canSubmit = selectedCount > 0 && minTasks <= maxTasks && minSprints <= maxSprints && !busy;
  const selectedGoalList = useMemo(() => Array.from(selectedGoalIds), [selectedGoalIds]);
  const { execution } = useExecutionTimeline();
  const connections = execution?.connections || [];
  const routeOptions = useMemo<PlanningRouteOption[]>(() => {
    const opts: PlanningRouteOption[] = [];
    for (const conn of connections) {
      if (conn.status === "connected" || conn.status === "listening" || conn.status === "idle") {
        opts.push({ type: "connected", id: conn.id, label: conn.displayName || conn.connectionKey });
      }
    }
    for (const vp of virtualProviders) {
      opts.push({
        type: "virtual",
        id: vp.providerConfigId || vp.id || vp.provider || "",
        label: vp.displayLabel || vp.label || vp.providerConfigId || vp.id || vp.provider || "Provider",
        provider: vp.providerConfigId || vp.id || vp.provider,
        iconProviderId: vp.iconProviderId || (vp.provider as ProviderId | undefined) || (vp.id as ProviderId | undefined),
        effectiveModel: vp.effectiveModel,
      });
    }
    return opts;
  }, [connections, virtualProviders]);
  const showModelOverride = routeOverride?.type === "virtual";
  const modelProviderId = routeOverride?.iconProviderId;
  const modelOptions = useMemo(
    () => (showModelOverride && modelProviderId ? getProviderModelOptions(modelProviderId) : []),
    [modelProviderId, showModelOverride],
  );
  const defaultModelLabel = routeOverride?.effectiveModel
    ? `Default Model (${routeOverride.effectiveModel})`
    : defaultModelOptionLabel;

  useEffect(() => {
    setSelectedGoalIds((current) => {
      const available = new Set(allGoals.map((goal) => goal.id));
      const next = new Set(Array.from(current).filter((goalId) => available.has(goalId)));
      if (next.size > 0 || allGoals.length === 0) {
        if (next.size === current.size && Array.from(next).every((goalId) => current.has(goalId))) {
          return current;
        }
        return next;
      }
      const allGoalIds = new Set(allGoals.map((goal) => goal.id));
      if (allGoalIds.size === current.size && Array.from(allGoalIds).every((goalId) => current.has(goalId))) {
        return current;
      }
      return allGoalIds;
    });
  }, [allGoals]);

  useEffect(() => {
    if (!modelOverride) return;
    if (!showModelOverride || !modelOptions.some((option) => option.value === modelOverride)) {
      setModelOverride(null);
    }
  }, [modelOptions, modelOverride, showModelOverride]);

  useEffect(() => {
    if (!planningAgentPresetId) return;
    if (!agentPresets.some((preset) => preset.id === planningAgentPresetId)) {
      setPlanningAgentPresetId(defaultPlanningAgentPresetId);
    }
  }, [agentPresets, defaultPlanningAgentPresetId, planningAgentPresetId]);

  const renderProviderIcon = (providerId: ProviderId) => (
    <ProviderBrandIcon id={providerId} className="h-5 w-5 rounded-md" imageClassName="h-3 w-3" />
  );

  const renderConnectedRouteIcon = () => (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-500/18 bg-slate-500/[0.08] text-slate-600 dark:border-slate-300/18 dark:bg-slate-300/[0.08] dark:text-slate-300">
      <Settings2 className="h-3.5 w-3.5" strokeWidth={2.2} />
    </span>
  );

  const toggleGoal = (goalId: string) => {
    setSelectedGoalIds((current) => {
      const next = new Set(current);
      if (next.has(goalId)) {
        next.delete(goalId);
      } else {
        next.add(goalId);
      }
      return next;
    });
  };

  const createGoal = async () => {
    if (!onCreateGoal || !newGoalTitle.trim() || creatingGoal) return;
    setCreatingGoal(true);
    setError(null);
    try {
      const created = await onCreateGoal({
        title: newGoalTitle.trim(),
        description: newGoalDescription.trim() || undefined,
      });
      setCreatedGoals((current) => [...current, created]);
      setSelectedGoalIds((current) => new Set([...Array.from(current), created.id]));
      setNewGoalTitle("");
      setNewGoalDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingGoal(false);
    }
  };

  const run = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onExecute({
        goalIds: selectedGoalList,
        minTasks,
        maxTasks,
        minSprints,
        maxSprints,
        submitMode,
        routeOverride,
        modelOverride,
        planningAgentPresetId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-black/[0.06] bg-white/76 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/68">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-signal-500">
            <Target className="h-4 w-4" />
            Goal Sprint
          </div>
          <h2 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            Plan toward project goals.
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-black/[0.05] p-2 text-slate-500 transition-colors hover:text-slate-900 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
          aria-label="Close Goal Sprint"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-2">
          {onCreateGoal ? (
            <div className="mb-4 rounded-2xl border border-signal-500/20 bg-signal-500/[0.055] p-4">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
                Add Goal
              </div>
              <input
                type="text"
                value={newGoalTitle}
                onInput={(event) => setNewGoalTitle((event.target as HTMLInputElement).value)}
                placeholder="Complete checkout process"
                className="mt-2 w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white"
              />
              <textarea
                value={newGoalDescription}
                onInput={(event) => setNewGoalDescription((event.target as HTMLTextAreaElement).value)}
                rows={2}
                placeholder="Optional acceptance criteria or context"
                className="mt-2 w-full resize-y rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() => { void createGoal(); }}
                disabled={!newGoalTitle.trim() || creatingGoal}
                className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-void-900 transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                {creatingGoal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add And Select Goal
              </button>
            </div>
          ) : null}

          {allGoals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/[0.08] p-5 text-sm font-semibold text-slate-400 dark:border-white/[0.1]">
              Add active goals before planning a goal sprint.
            </div>
          ) : allGoals.map((goal) => {
            const selected = selectedGoalIds.has(goal.id);
            return (
              <button
                key={goal.id}
                type="button"
                onClick={() => toggleGoal(goal.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                  selected
                    ? "border-signal-500/35 bg-signal-500/[0.09] text-slate-900 dark:text-white"
                    : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400"
                }`}
                aria-pressed={selected}
              >
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border ${selected ? "border-signal-500 bg-signal-500 text-void-900" : "border-slate-300 text-transparent dark:border-white/[0.14]"}`}>
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black">{goal.title}</span>
                  {goal.description ? <span className="mt-1 block text-xs font-medium opacity-75">{goal.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-4 rounded-2xl border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
          <div className="rounded-[1.15rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Planning Agent</div>
            <div className="mt-2">
              <AvantgardeSelect
                variant="compact"
                value={planningAgentPresetId || ""}
                onChange={(value) => setPlanningAgentPresetId(value || null)}
                options={[
                  { value: "", label: "Project Default" },
                  ...agentPresets.map((preset) => ({
                    value: preset.id,
                    label: preset.name,
                  })),
                ]}
                placeholder="Project Default"
              />
            </div>
          </div>

          <div className="rounded-[1.15rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Planning Route</div>
            <div className="mt-2">
              <AvantgardeSelect
                variant="compact"
                value={routeOverride?.id || ""}
                onChange={(id) => {
                  const option = routeOptions.find((candidate) => candidate.id === id);
                  setRouteOverride(option || null);
                }}
                options={[
                  {
                    value: "",
                    label: defaultRouteOptionLabel,
                    icon: defaultRouteIconProviderId
                      ? () => renderProviderIcon(defaultRouteIconProviderId)
                      : undefined,
                  },
                  ...routeOptions.map((option) => ({
                    value: option.id,
                    label: option.label,
                    icon: option.type === "virtual" && option.iconProviderId
                      ? () => renderProviderIcon(option.iconProviderId!)
                      : option.type === "connected"
                        ? renderConnectedRouteIcon
                        : undefined,
                  })),
                ]}
                placeholder={defaultRouteOptionLabel}
              />
            </div>
          </div>

          <div className={`rounded-[1.15rem] border p-3 transition-all ${
            showModelOverride
              ? "border-signal-500/20 bg-signal-500/[0.055] dark:bg-signal-500/[0.08]"
              : "border-black/[0.06] bg-white/45 opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04]"
          }`}>
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Model Override</div>
            <div className="mt-2">
              <AvantgardeSelect
                variant="compact"
                disabled={!showModelOverride}
                value={modelOverride || ""}
                onChange={(value) => setModelOverride(value || null)}
                options={[
                  {
                    value: "",
                    label: defaultModelLabel,
                    icon: modelProviderId ? () => renderProviderIcon(modelProviderId) : undefined,
                  },
                  ...modelOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                    icon: modelProviderId ? () => renderProviderIcon(modelProviderId) : undefined,
                  })),
                ]}
                placeholder={defaultModelLabel}
              />
            </div>
          </div>

          <NumberField label="Min Tasks" value={minTasks} min={1} max={maxTasks} onChange={setMinTasks} />
          <NumberField label="Max Tasks" value={maxTasks} min={minTasks} max={50} onChange={setMaxTasks} />
          <NumberField label="Min Sprints" value={minSprints} min={1} max={maxSprints} onChange={setMinSprints} />
          <NumberField label="Max Sprints" value={maxSprints} min={minSprints} max={8} onChange={setMaxSprints} />

          <div className="grid grid-cols-2 gap-2">
            {(["plan_and_start", "plan_only"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSubmitMode(mode)}
                className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${submitMode === mode ? "bg-signal-500 text-void-900" : "bg-white text-slate-500 dark:bg-white/[0.06] dark:text-slate-300"}`}
              >
                {mode === "plan_and_start" ? "Plan & Start" : "Plan Only"}
              </button>
            ))}
          </div>

          {error ? <div className="rounded-xl bg-status-red/[0.08] p-3 text-xs font-semibold text-status-red">{error}</div> : null}

          <button
            type="button"
            onClick={() => { void run(); }}
            disabled={!canSubmit}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-signal-500 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-void-900 transition-all hover:bg-signal-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Create Goal Sprint
          </button>
        </div>
      </div>
    </section>
  );
};

const NumberField: FunctionComponent<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <label className="block">
    <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onInput={(event) => onChange(Math.max(min, Math.min(max, Math.trunc(Number((event.target as HTMLInputElement).value) || min))))}
      className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white"
    />
  </label>
);
