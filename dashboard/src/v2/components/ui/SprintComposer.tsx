import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useMemo } from "preact/hooks";
import gsap from "gsap";
import {
  ExternalLink,
  Github,
  Gitlab,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  Tag,
  Target,
  X,
  Users
} from "lucide-preact";
import type { Sprint, AgentPreset, SprintLinkedIssueInput } from "../../types.js";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import {
  useSprintComposerState, 
  type SprintSubmitMode,
  type PlanningRouteOption,
  toPlanningOverrides,
  resolveSubmitOriginalPrompt,
} from "../../lib/sprint-composer-state.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { getPlanningFeedback, type PlanningActionType, PLANNING_ACTION_LABELS } from "../../lib/sprint-planning-feedback.js";
import { PlanningProgressOverlay } from "./PlanningProgressOverlay.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import type { ImprovePromptInput, VirtualWorkerProvider } from "../../types.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";

interface SprintComposerProps {
  nextId: string;
  initialSprint?: Sprint | null;
  virtualProviders: Array<{ id: VirtualWorkerProvider; label: string }>;
  planningPresets: AgentPreset[];
  planningEta: number;
  onClose: () => void;
  onImprovePrompt?: (draft: ImprovePromptInput, signal?: AbortSignal) => Promise<string>;
  onSubmit: (payload: {
    name: string;
    goal: string;
    originalPrompt: string | null;
    submitMode: SprintSubmitMode;
    routeOverride: PlanningRouteOption | null;
    modelOverride: string | null;
    planningAgentPresetId: string | null;
    linkedIssues: SprintLinkedIssueInput[];
    clientRequestId?: string;
    signal?: AbortSignal;
  }) => Promise<void> | void;
  onCancelPlanningRequest?: (clientRequestId: string) => Promise<void> | void;
  onStartNewSprint?: () => void;
  onAppendTasks?: () => void;
  linkedIssues?: SprintLinkedIssueInput[];
  onRemoveLinkedIssue?: (issue: SprintLinkedIssueInput) => void;
}

export const SprintComposer: FunctionComponent<SprintComposerProps> = ({
  nextId,
  initialSprint = null,
  virtualProviders,
  planningPresets,
  planningEta,
  onClose,
  onImprovePrompt,
  onSubmit,
  onCancelPlanningRequest,
  onStartNewSprint,
  onAppendTasks,
  linkedIssues,
  onRemoveLinkedIssue,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLFormElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<{ id: string; detached: boolean; cancelled: boolean } | null>(null);
  const ignoredRequestIdsRef = useRef<Set<string>>(new Set());
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isUnmountedRef = useRef(false);
  const [isImproving, setIsImproving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { feedback: actionFeedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isOverlayDismissed, setIsOverlayDismissed] = useState(false);

  const state = useSprintComposerState(initialSprint);
  const visibleLinkedIssues = linkedIssues ?? initialSprint?.linkedIssues ?? [];

  const createClientRequestId = (): string => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `planning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const resetForNewSprint = (): void => {
    state.setName("");
    state.setGoal("");
    state.setOriginalPrompt(null);
    state.setSubmitMode("plan_and_start");
    state.setRouteOverride(null);
    state.setModelOverride(null);
    state.setPlanningAgentPresetId(null);
  };

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

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
    setIsOverlayDismissed(false);
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

  const handleCancel = (): void => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest) {
      activeRequest.cancelled = true;
      ignoredRequestIdsRef.current.add(activeRequest.id);
      void onCancelPlanningRequest?.(activeRequest.id);
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    activeRequestRef.current = null;
    setIsImproving(false);
    setIsSubmitting(false);
    clearFeedback();
    if (previousFocusRef.current) {
      const el = previousFocusRef.current;
      setTimeout(() => el.focus(), 0);
    }
  };

  const handleStartNewSprint = (): void => {
    if (activeRequestRef.current) {
      activeRequestRef.current.detached = true;
      ignoredRequestIdsRef.current.add(activeRequestRef.current.id);
    }
    if (abortRef.current) {
      abortRef.current = null;
    }
    setIsImproving(false);
    setIsSubmitting(false);
    setIsOverlayDismissed(true);
    clearFeedback();
    resetForNewSprint();
    onStartNewSprint?.();
  };

  const handleImprovePrompt = async (): Promise<void> => {
    if (!onImprovePrompt || !state.name.trim() || !state.goal.trim()) {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const rawPrompt = state.goal.trim();
    const clientRequestId = createClientRequestId();
    activeRequestRef.current = { id: clientRequestId, detached: false, cancelled: false };
    const controller = new AbortController();
    abortRef.current = controller;
    setIsImproving(true);
    clearFeedback();
    try {
      const improvedGoal = await onImprovePrompt({
        name: state.name.trim(),
        goal: rawPrompt,
        clientRequestId,
        planningAgentPresetId: state.planningAgentPresetId || undefined,
        overrides: toPlanningOverrides(state.routeOverride, state.modelOverride, state.planningAgentPresetId),
      });
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || (activeRequest.id === clientRequestId && !activeRequest.detached && !activeRequest.cancelled)) {
        state.setGoal(improvedGoal);
        state.setOriginalPrompt(rawPrompt);
      }
    } catch (error) {
      const activeRequest = activeRequestRef.current;
      if (
        (error instanceof DOMException && error.name === "AbortError")
        || ignoredRequestIdsRef.current.has(clientRequestId)
        || (activeRequest && activeRequest.id !== clientRequestId)
        || activeRequest?.cancelled
        || activeRequest?.detached
      ) return;
      if (!isUnmountedRef.current) {
        setError(error instanceof Error ? error.message : String(error), { retryAction: handleImprovePrompt, retryLabel: "Retry Improve", autoDismiss: false });
      }
    } finally {
      abortRef.current = null;
      const activeRequest = activeRequestRef.current;
      if (activeRequest?.id === clientRequestId) {
        activeRequestRef.current = null;
      }
      ignoredRequestIdsRef.current.delete(clientRequestId);
      if (!isUnmountedRef.current && (!activeRequest || activeRequest.id === clientRequestId)) {
        setIsImproving(false);
        if (previousFocusRef.current) {
          const el = previousFocusRef.current;
          setTimeout(() => el.focus(), 0);
        }
      }
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!state.name.trim()) {
      return;
    }

    if (state.submitMode === "append_tasks" && onAppendTasks) {
      onAppendTasks();
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const clientRequestId = createClientRequestId();
    activeRequestRef.current = { id: clientRequestId, detached: false, cancelled: false };
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSubmitting(true);
    clearFeedback();
    try {
      await onSubmit({
        name: state.name.trim(),
        goal: state.goal.trim(),
        originalPrompt: resolveSubmitOriginalPrompt(state.submitMode, state.originalPrompt, state.goal),
        submitMode: state.submitMode,
        routeOverride: state.routeOverride,
        modelOverride: state.modelOverride,
        planningAgentPresetId: state.planningAgentPresetId,
        linkedIssues: visibleLinkedIssues,
        clientRequestId,
      });
      const activeRequest = activeRequestRef.current;
      if (!isUnmountedRef.current && activeRequest?.id === clientRequestId && !activeRequest.detached && !activeRequest.cancelled) {
        onClose();
      }
    } catch (error) {
      const activeRequest = activeRequestRef.current;
      if (
        (error instanceof DOMException && error.name === "AbortError")
        || ignoredRequestIdsRef.current.has(clientRequestId)
        || (activeRequest && activeRequest.id !== clientRequestId)
        || activeRequest?.cancelled
        || activeRequest?.detached
      ) return;
      if (!isUnmountedRef.current) {
        setError(error instanceof Error ? error.message : String(error), { retryAction: () => fieldsRef.current?.requestSubmit(), retryLabel: "Retry Request", autoDismiss: false });
      }
    } finally {
      abortRef.current = null;
      const activeRequest = activeRequestRef.current;
      if (activeRequest?.id === clientRequestId) {
        activeRequestRef.current = null;
      }
      ignoredRequestIdsRef.current.delete(clientRequestId);
      if (!isUnmountedRef.current && (!activeRequest || activeRequest.id === clientRequestId)) {
        setIsSubmitting(false);
        if (previousFocusRef.current && document.activeElement === document.body) {
          const el = previousFocusRef.current;
          setTimeout(() => el.focus(), 0);
        }
      }
    }
  };

  const { execution } = useExecutionTimeline();
  const connections = execution?.connections || [];

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

      <PlanningProgressOverlay
        isBusy={isBusy && !isOverlayDismissed}
        feedback={feedback}
        planningEta={planningEta}
        elapsedMs={elapsedMs}
        isDark={isDark}
        actionType={busyAction || "plan_and_start"}
        themeAccent="signal"
        onCancel={handleCancel}
        onDismiss={() => setIsOverlayDismissed(true)}
        secondaryActionLabel="New Sprint"
        onSecondaryAction={handleStartNewSprint}
      />

      <div
        aria-live="polite"
        className="sr-only"
      >
        {isBusy ? PLANNING_ACTION_LABELS[busyAction!] || "Planning in progress" : actionFeedback.status === "error" ? actionFeedback.message : ""}
      </div>

      <form
        ref={fieldsRef}
        onSubmit={handleSubmit}
        className="relative z-10 grid gap-0 xl:grid-cols-[minmax(0,1fr)_21rem]"
        tabIndex={-1}
      >
        <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
          <div data-composer-stagger className="mb-8">
            <ActionFeedbackRegion status={actionFeedback.status} message={actionFeedback.message} onDismiss={clearFeedback} autoDismiss={actionFeedback.autoDismiss} retryAction={actionFeedback.retryAction} retryLabel={actionFeedback.retryLabel} />
          </div>
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
              disabled={isBusy}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
              aria-label="Close sprint composer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div data-composer-stagger className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Sprint Key</div>
              <div className="mt-2 font-mono text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                {(initialSprint?.number ? nextId.replace(/\d+$/, String(initialSprint.number)) : nextId).toUpperCase()}
              </div>
            </div>

            <div className={`rounded-[1.4rem] border p-4 transition-all ${
              isBusy ? "border-black/[0.06] bg-black/[0.025] opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03]" : "border-black/[0.06] bg-black/[0.025] dark:border-white/[0.06] dark:bg-white/[0.03]"
            }`}>
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Planning Route</div>
              <div className="mt-2">
                <AvantgardeSelect
                  variant="compact"
                  aria-label="Planning Route"
                  disabled={isBusy}
                  value={state.routeOverride?.id || ""}
                  onChange={(id) => {
                    const opt = routeOptions.find(o => o.id === id);
                    state.setRouteOverride(opt || null);
                  }}
                  options={[
                    { value: "", label: "Default Route" },
                    ...routeOptions.map(opt => ({ value: opt.id, label: opt.label })),
                  ]}
                  placeholder="Default Route"
                />
              </div>
            </div>

            <div className={`rounded-[1.4rem] border p-4 transition-all ${
              !showModelOverride || isBusy
                ? "border-black/[0.06] bg-black/[0.025] opacity-40 dark:border-white/[0.06] dark:bg-white/[0.03]"
                : "border-signal-500/20 bg-signal-500/[0.04] dark:bg-signal-500/[0.08]"
            }`}>
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Model Override</div>
              <div className="mt-2">
                <AvantgardeSelect
                  variant="compact"
                  aria-label="Model Override"
                  disabled={!showModelOverride || isBusy}
                  value={state.modelOverride || ""}
                  onChange={(val) => state.setModelOverride(val || null)}
                  options={[
                    { value: "", label: "Default Model" },
                    ...modelOptions.map(opt => ({ value: opt.value, label: opt.label })),
                  ]}
                  placeholder="Default Model"
                />
              </div>
            </div>
          </div>

          <label data-composer-stagger className="mt-8 block space-y-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Sprint Name</span>
            <input
              type="text"
              value={state.name}
              onInput={(event) => state.setName((event.target as HTMLInputElement).value)}
              disabled={isBusy}
              placeholder="Runtime hardening"
              className="w-full border-0 border-b-2 border-black/[0.08] bg-transparent pb-3 font-display text-[1.65rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-200 focus:border-signal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem]"
              required
              autoFocus
            />
          </label>

          <div data-composer-stagger className="mt-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Sprint Prompt</label>
              <button
                type="button"
                onClick={() => { void handleImprovePrompt(); }}
                disabled={isBusy || !state.name.trim() || !state.goal.trim()}
                className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/[0.14] disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300"
              >
                {isImproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />}
                {isImproving ? PLANNING_ACTION_LABELS.improve : "Plan ahead with AI"}
              </button>
            </div>

            {visibleLinkedIssues.length > 0 && (
              <div data-composer-stagger className="rounded-[1.7rem] border border-black/[0.07] bg-white/62 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] dark:border-white/[0.08] dark:bg-white/[0.035]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    <LinkIcon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
                    Linked Issues
                  </div>
                  <div className="rounded-full border border-signal-500/18 bg-signal-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
                    {visibleLinkedIssues.length} imported
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {visibleLinkedIssues.map((issue) => {
                    const ProviderIcon = issue.provider === "gitlab" ? Gitlab : Github;
                    return (
                      <article
                        key={`${issue.provider}:${issue.repository}:${issue.issueNumber}`}
                        className="group relative overflow-hidden rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 transition-all hover:-translate-y-0.5 hover:border-signal-500/24 hover:bg-white/88 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:bg-white/[0.055]"
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-signal-500 via-ember-500 to-slate-300 opacity-70" />
                        <div className="flex items-start gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.85rem] border ${
                            issue.provider === "gitlab"
                              ? "border-ember-500/20 bg-ember-500/10 text-ember-600 dark:text-ember-400"
                              : "border-slate-900/10 bg-slate-900/[0.06] text-slate-800 dark:border-white/10 dark:bg-white/[0.07] dark:text-white"
                          }`}>
                            <ProviderIcon className="h-4 w-4" strokeWidth={2.1} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                              <span>{issue.repository}</span>
                              <span className="text-signal-600 dark:text-signal-300">{issue.issueKey || `#${issue.issueNumber}`}</span>
                            </div>
                            <h3 className="mt-1 line-clamp-2 text-sm font-black leading-snug text-slate-900 dark:text-white">
                              {issue.title}
                            </h3>
                          </div>
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            aria-label={`Open ${issue.title}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
                          </a>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(issue.labels || []).slice(0, 5).map((label) => (
                            <span key={label} className="inline-flex max-w-full items-center gap-1 rounded-full bg-signal-500/[0.08] px-2 py-1 text-[10px] font-semibold text-signal-700 dark:text-signal-300">
                              <Tag className="h-3 w-3 shrink-0" strokeWidth={2} />
                              <span className="truncate">{label}</span>
                            </span>
                          ))}
                          {(issue.assignees || []).slice(0, 3).map((assignee) => (
                            <span key={assignee} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ember-500/[0.09] px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                              <Users className="h-3 w-3 shrink-0" strokeWidth={2} />
                              <span className="truncate">{assignee}</span>
                            </span>
                          ))}
                        </div>
                        {onRemoveLinkedIssue && !isBusy && (
                          <button
                            type="button"
                            onClick={() => onRemoveLinkedIssue(issue)}
                            className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-status-red"
                          >
                            Remove Link
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={state.originalPrompt ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>
              <div className={`rounded-[1.7rem] border transition-all ${
                isImproving
                  ? "border-signal-500/35 bg-black/[0.025] shadow-[0_0_0_1px_rgba(0,224,160,0.16),0_0_30px_rgba(0,224,160,0.1)] dark:bg-white/[0.03]"
                  : isBusy
                    ? "border-black/[0.07] bg-black/[0.025] opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03]"
                    : "border-black/[0.07] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.03]"
              }`}>
                <textarea
                  value={state.goal}
                  onInput={(event) => state.setGoal((event.target as HTMLTextAreaElement).value)}
                  disabled={isBusy}
                  placeholder="Describe the outcome, affected systems, and what done looks like when this sprint lands."
                  className="min-h-[220px] w-full resize-none rounded-[1.7rem] bg-transparent px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed dark:text-slate-300 dark:placeholder:text-slate-600 sm:min-h-[260px] sm:px-5"
                />
              </div>

              {state.originalPrompt && (
                <div className="flex flex-col rounded-[1.7rem] border border-black/[0.05] bg-black/[0.01] p-5 dark:border-white/[0.05] dark:bg-white/[0.015]">
                  <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Original Prompt</div>
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
            <div className={`transition-all ${isBusy ? "opacity-50" : ""}`}>
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Planning Agent</div>
              <div className="mt-3">
                <AvantgardeSelect
                  variant="card"
                  aria-label="Planning Agent"
                  disabled={isBusy}
                  value={state.planningAgentPresetId || ""}
                  onChange={(val) => state.setPlanningAgentPresetId(val || null)}
                  options={[
                    { value: "", label: "Built-in Planning agent" },
                    ...planningPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                  ]}
                  placeholder="Built-in Planning agent"
                />
              </div>
            </div>
          </div>

          <div data-composer-stagger>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Execution Mode</div>
            <div className="mt-3 grid gap-3">
              {state.availableModes.map((mode) => {
                const ModeIcon = mode.icon;
                const isActive = state.submitMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => state.setSubmitMode(mode.id)}
                    className={`rounded-[1.35rem] border p-4 text-left transition-all ${
                      isActive
                        ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)]"
                        : isBusy
                          ? "border-black/[0.06] bg-white/66 opacity-50 dark:border-white/[0.06] dark:bg-white/[0.02]"
                          : "border-black/[0.06] bg-white/66 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]"
                    } disabled:cursor-not-allowed`}
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
            {isBusy && isOverlayDismissed && feedback && (
              <div className="flex w-full flex-col gap-3 rounded-xl border border-signal-500/30 bg-signal-500/[0.06] p-3 dark:bg-signal-500/[0.08] sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setIsOverlayDismissed(false)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-signal-500" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-signal-700 dark:text-signal-300">
                      {PLANNING_ACTION_LABELS[busyAction!] || "Planning in progress..."}
                    </div>
                    <div className="mt-0.5 text-[10px] text-signal-600/70 dark:text-signal-400/70">
                      {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")} elapsed
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleStartNewSprint}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  >
                    New Sprint
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-lg border border-status-red/20 bg-status-red/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/[0.12]"
                  >
                    Cancel Active Request
                  </button>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={isBusy || !state.name.trim()}
              className="inline-flex items-center justify-center gap-2.5 rounded-[1.2rem] bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-void-900"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SubmitIcon className="h-4 w-4" strokeWidth={2.3} />}
              {isSubmitting
                ? PLANNING_ACTION_LABELS[state.submitMode as PlanningActionType] || "Processing..."
                : state.submitMode === 'draft' ? (state.isEditing ? "Save Changes" : "Save Draft") : activeMode.label}
            </button>
            <button
              type="button"
              onClick={isBusy ? handleCancel : onClose}
              className={`rounded-[1.2rem] border px-5 py-3 text-sm font-semibold transition-colors ${
                isBusy
                  ? "border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]"
                  : "border-black/[0.06] bg-white/66 text-slate-500 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              {isBusy ? "Cancel Active Request" : "Cancel"}
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
};
