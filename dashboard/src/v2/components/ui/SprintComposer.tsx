import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import {
  ClipboardList,
  ChevronDown,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  Target,
  X,
} from "lucide-preact";
import type { Sprint, ExecutionConnectionSummary, AgentPreset } from "../../types.js";
import {
  useSprintComposerState, 
  type SprintSubmitMode,
  type PlanningRouteOption,
  toPlanningOverrides,
} from "../../lib/sprint-composer-state.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { getPlanningFeedback, type PlanningActionType } from "../../lib/sprint-planning-feedback.js";
import { ContainerShip, WoodenShip } from "./PlanningShip.js";
import type { ImprovePromptInput, VirtualWorkerProvider } from "../../types.js";

interface SprintComposerProps {
  nextId: string;
  initialSprint?: Sprint | null;
  connections: ExecutionConnectionSummary[];
  virtualProviders: Array<{ id: VirtualWorkerProvider; label: string }>;
  planningPresets: AgentPreset[];
  onClose: () => void;
  onImprovePrompt?: (draft: ImprovePromptInput) => Promise<string>;
  onSubmit: (payload: {
    name: string;
    goal: string;
    originalPrompt: string | null;
    submitMode: SprintSubmitMode;
    routeOverride: PlanningRouteOption | null;
    modelOverride: string | null;
    planningAgentPresetId: string | null;
  }) => Promise<void> | void;
}

export const SprintComposer: FunctionComponent<SprintComposerProps> = ({
  nextId,
  initialSprint = null,
  connections,
  virtualProviders,
  planningPresets,
  onClose,
  onImprovePrompt,
  onSubmit,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLFormElement>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const state = useSprintComposerState(initialSprint);

  useEffect(() => {
    if (state.planningAgentPresetId && !planningPresets.find(p => p.id === state.planningAgentPresetId)) {
      state.setPlanningAgentPresetId(null);
    }
  }, [planningPresets, state.planningAgentPresetId]);

  const activeMode = state.availableModes.find((mode) => mode.id === state.submitMode) || state.availableModes[0]!;
  const SubmitIcon = activeMode.icon;

  const isBusy = isImproving || isSubmitting;
  const busyAction = useMemo<PlanningActionType | null>(() => {
    if (isImproving) return "improve";
    if (isSubmitting) {
      if (state.submitMode === "plan_only") return "plan_only";
      if (state.submitMode === "plan_and_start") return "plan_and_start";
      if (state.submitMode === "replan") return "replan";
    }
    return null;
  }, [isImproving, isSubmitting, state.submitMode]);

  useEffect(() => {
    if (!isBusy) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [isBusy]);

  const feedback = useMemo(() => {
    if (!busyAction) return null;
    return getPlanningFeedback(busyAction, elapsedMs);
  }, [busyAction, elapsedMs]);

  useLayoutEffect(() => {
    const timeline = gsap.timeline();

    if (cardRef.current) {
      timeline.fromTo(
        cardRef.current,
        { y: 28, opacity: 0, scale: 0.985, filter: "blur(14px)" },
        { y: 0, opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.72, ease: "power4.out" },
      );
    }

    if (fieldsRef.current) {
      timeline.fromTo(
        Array.from(fieldsRef.current.querySelectorAll("[data-composer-stagger]")),
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.055, duration: 0.5, ease: "power3.out" },
        "-=0.45",
      );
    }
  }, [initialSprint?.id]);

  const handleImprovePrompt = async (): Promise<void> => {
    if (!onImprovePrompt || !state.name.trim() || !state.goal.trim()) {
      return;
    }
    const rawPrompt = state.goal.trim();
    setIsImproving(true);
    try {
      const improvedGoal = await onImprovePrompt({
        name: state.name.trim(),
        goal: rawPrompt,
        planningAgentPresetId: state.planningAgentPresetId || undefined,
        overrides: toPlanningOverrides(state.routeOverride, state.modelOverride, state.planningAgentPresetId),
      });
      state.setGoal(improvedGoal);
      state.setOriginalPrompt(rawPrompt);
    } finally {
      setIsImproving(false);
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!state.name.trim()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        name: state.name.trim(),
        goal: state.goal.trim(),
        originalPrompt: state.originalPrompt,
        submitMode: state.submitMode,
        routeOverride: state.routeOverride,
        modelOverride: state.modelOverride,
        planningAgentPresetId: state.planningAgentPresetId,
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const routeOptions: PlanningRouteOption[] = [
    ...connections.map(c => ({
      type: 'connected' as const,
      id: c.id,
      label: c.displayName,
    })),
    ...virtualProviders.map(v => ({
      type: 'virtual' as const,
      id: v.id,
      label: v.label,
      provider: v.id,
    }))
  ];

  const currentRoute = state.routeOverride || null;
  const showModelOverride = currentRoute?.type === 'virtual';
  const modelOptions = currentRoute?.provider ? getProviderModelOptions(currentRoute.provider) : [];

  const isDark = document.documentElement.classList.contains("dark");

  return (
    <section
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.08),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.1),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.09),transparent_34%)]" />

      {isBusy && feedback && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 p-8 backdrop-blur-xl dark:bg-void-900/80">
          <div className="relative mb-12 flex h-32 w-full max-w-md items-center justify-center">
            <div className="absolute inset-x-0 bottom-8 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-white/10" />
            <div 
              className="absolute transition-all duration-300 ease-out"
              style={{ left: `${feedback.progress * 100}%`, transform: 'translateX(-50%)' }}
            >
              <svg width="120" height="60" viewBox="-60 -30 120 60">
                {feedback.shipType === "container" 
                  ? <ContainerShip accentColor="#00E0A0" isMoving={true} isDark={isDark} />
                  : <WoodenShip accentColor="#FFB800" isMoving={true} isDark={isDark} />
                }
              </svg>
            </div>
          </div>
          
          <div className="space-y-4 text-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-500"></span>
              </span>
              Planning in motion
            </div>
            <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {feedback.text}
            </h3>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {busyAction === "improve" 
                ? "The AI is analyzing your goals to produce a more precise technical definition."
                : "Orchestrating the planning specialist to decompose your sprint into atomic subtasks."
              }
            </p>
          </div>
        </div>
      )}

      <form
        ref={fieldsRef}
        onSubmit={handleSubmit}
        className="relative z-10 grid gap-0 xl:grid-cols-[minmax(0,1fr)_21rem]"
      >
        <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
          <div data-composer-stagger className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">
                <Target className="h-3.5 w-3.5" strokeWidth={2.3} />
                {state.isEditing ? (state.hasTasks ? "Edit Planned Sprint" : "Edit Draft Sprint") : "Sprint Composer"}
              </div>
              <div className="space-y-3">
                <h2 className="font-display text-[2rem] font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-[2.35rem]">
                  {state.isEditing ? "Refine The Sprint." : "Compose The Next Sprint."}
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
                  {state.isEditing
                    ? "Adjust the sprint definition. If tasks already exist, you can choose to Replan them."
                    : "The showcase folds away while you write. Define the sprint once, improve the prompt if needed, and let the Planning agent take the first pass at subtasks."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
              aria-label="Close sprint composer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div data-composer-stagger className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Key</div>
              <div className="mt-2 font-mono text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                {(initialSprint?.number ? `SPR-${initialSprint.number}` : nextId).toUpperCase()}
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Planning Route</div>
              <div className="relative mt-2">
                <select
                  value={state.routeOverride?.id || ""}
                  onChange={(e) => {
                    const id = (e.target as HTMLSelectElement).value;
                    const opt = routeOptions.find(o => o.id === id);
                    state.setRouteOverride(opt || null);
                  }}
                  className="w-full appearance-none bg-transparent pr-8 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 outline-none dark:text-signal-300"
                >
                  <option value="">Default Route</option>
                  {routeOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div className={`rounded-[1.4rem] border p-4 transition-all ${
              showModelOverride 
                ? "border-signal-500/20 bg-signal-500/[0.04] dark:bg-signal-500/[0.08]" 
                : "border-black/[0.06] bg-black/[0.025] opacity-40 dark:border-white/[0.06] dark:bg-white/[0.03]"
            }`}>
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Model Override</div>
              <div className="relative mt-2">
                <select
                  disabled={!showModelOverride}
                  value={state.modelOverride || ""}
                  onChange={(e) => state.setModelOverride((e.target as HTMLSelectElement).value || null)}
                  className="w-full appearance-none bg-transparent pr-8 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 outline-none disabled:text-slate-400 dark:text-signal-300"
                >
                  <option value="">Default Model</option>
                  {modelOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          <label data-composer-stagger className="mt-8 block space-y-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Name</span>
            <input
              type="text"
              value={state.name}
              onInput={(event) => state.setName((event.target as HTMLInputElement).value)}
              placeholder="Runtime hardening"
              className="w-full border-0 border-b-2 border-black/[0.08] bg-transparent pb-3 font-display text-[1.65rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-200 focus:border-signal-500 dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem]"
              required
              autoFocus
            />
          </label>

          <div data-composer-stagger className="mt-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint Prompt</label>
              <button
                type="button"
                onClick={() => { void handleImprovePrompt(); }}
                disabled={isImproving || !state.name.trim() || !state.goal.trim()}
                className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/[0.14] disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300"
              >
                {isImproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />}
                {isImproving ? "Thinking..." : "Plan ahead with AI"}
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className={`rounded-[1.7rem] border bg-black/[0.025] transition-all dark:bg-white/[0.03] ${
                isImproving
                  ? "border-signal-500/35 shadow-[0_0_0_1px_rgba(0,224,160,0.16),0_0_30px_rgba(0,224,160,0.1)]"
                  : "border-black/[0.07] dark:border-white/[0.08]"
              }`}>
                <textarea
                  value={state.goal}
                  onInput={(event) => state.setGoal((event.target as HTMLTextAreaElement).value)}
                  placeholder="Describe the outcome, affected systems, and what done looks like when this sprint lands."
                  className="min-h-[220px] w-full resize-none rounded-[1.7rem] bg-transparent px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 dark:text-slate-300 dark:placeholder:text-slate-600 sm:min-h-[260px] sm:px-5"
                />
              </div>

              {state.originalPrompt && (
                <div className="flex flex-col rounded-[1.7rem] border border-black/[0.05] bg-black/[0.01] p-5 dark:border-white/[0.05] dark:bg-white/[0.015]">
                  <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Original Prompt</div>
                  <div className="max-h-[220px] overflow-y-auto text-xs italic leading-relaxed text-slate-400 dark:text-slate-500 sm:max-h-[260px]">
                    {state.originalPrompt}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4 p-6 sm:p-8">
          <div data-composer-stagger>
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Planning Agent</div>
            <div className="relative mt-3">
              <select
                value={state.planningAgentPresetId || ""}
                onChange={(e) => state.setPlanningAgentPresetId((e.target as HTMLSelectElement).value || null)}
                className="w-full appearance-none rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-4 py-2.5 pr-10 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 outline-none hover:border-black/[0.1] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-signal-300 dark:hover:border-white/[0.1]"
              >
                <option value="">Built-in Planning agent</option>
                {planningPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div data-composer-stagger>
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Execution Mode</div>
            <div className="mt-3 grid gap-3">
              {state.availableModes.map((mode) => {
                const ModeIcon = mode.icon;
                const isActive = state.submitMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => state.setSubmitMode(mode.id)}
                    className={`rounded-[1.35rem] border p-4 text-left transition-all ${
                      isActive
                        ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)]"
                        : "border-black/[0.06] bg-white/66 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-white">
                      <ModeIcon className={`h-3.5 w-3.5 ${isActive ? "text-signal-500" : "text-slate-400"}`} strokeWidth={2.1} />
                      {mode.label}
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {mode.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div data-composer-stagger className="mt-auto flex flex-col gap-3 pt-2">
            {submitError && (
              <div className="rounded-xl border border-status-red/20 bg-status-red/[0.06] px-4 py-3 text-xs leading-relaxed text-status-red">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting || !state.name.trim()}
              className="inline-flex items-center justify-center gap-2.5 rounded-[1.2rem] bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-void-900"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SubmitIcon className="h-4 w-4" strokeWidth={2.3} />}
              {state.submitMode === 'draft' ? (state.isEditing ? "Save Changes" : "Save Draft") : activeMode.label}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-5 py-3 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-300 dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
};
