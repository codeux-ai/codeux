import type { FunctionComponent } from "preact";
import { ChevronLeft, BrainCircuit, Zap, EyeOff, Eye, Rocket, ClipboardList, X, CalendarClock } from "lucide-preact";
import {
  toSprintSchedulePayload,
  type PlanningRouteOption,
  type SprintScheduleConfig,
  type SprintSchedulePayload,
} from "../../lib/sprint-composer-state.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { SubtaskSlider, getTagStyles, IconMap } from "./quicksprint-shared.js";
import { PlanningProgressOverlay } from "../ui/PlanningProgressOverlay.js";
import type { ProviderId } from "../../types.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { getPlanningFeedback } from "../../lib/sprint-planning-feedback.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export const QuicksprintExecutionView: FunctionComponent<{
  setPhase: (phase: "browse" | "configure" | "editor") => void;
  onBackToBrowse: () => void;
  selectedTemplateId: string | null;
  selectedTemplate: QuicksprintTemplateRecord | null;
  taskCount: number; setTaskCount: (v: number) => void;
  noTaskLimit: boolean; setNoTaskLimit: (v: boolean) => void;
  routeOverride: PlanningRouteOption | null; setRouteOverride: (v: PlanningRouteOption | null) => void;
  modelOverride: string | null; setModelOverride: (v: string | null) => void;
  showPrompt: boolean; setShowPrompt: (v: boolean) => void;
  additionalPrompt: string; setAdditionalPrompt: (v: string) => void;
  routeOptions: PlanningRouteOption[];
  modelOptions: { value: string; label: string }[];
  combinedPrompt: string;
  executingMode: "plan_only" | "plan_and_start" | null;
  elapsedMs: number;
  isOverlayDismissed: boolean; setIsOverlayDismissed: (v: boolean) => void;
  handleExecute: (mode: "plan_only" | "plan_and_start") => void;
  onSchedule?: (input: {
    templateId: string;
    taskCount: number;
    noTaskLimit: boolean;
    submitMode: "plan_only" | "plan_and_start";
    additionalPrompt?: string;
    routeOverride?: PlanningRouteOption | null;
    modelOverride?: string | null;
    schedule: SprintSchedulePayload;
    title?: string;
  }) => Promise<void>;
  scheduleAnchorSprintOptions?: Array<{ id: string; label: string }>;
  handleCancelExecute: () => void;
  handleNewQuicksprint: () => void;
  defaultRouteOptionLabel: string;
  defaultModelOptionLabel: string;
  defaultRouteIconProviderId: ProviderId | null;
  planningEta: number;
  announcePhaseStatus?: (message: string) => void;
}> = ({
  setPhase,
  onBackToBrowse,
  selectedTemplateId,
  selectedTemplate,
  taskCount, setTaskCount,
  noTaskLimit, setNoTaskLimit,
  routeOverride, setRouteOverride,
  modelOverride, setModelOverride,
  showPrompt, setShowPrompt,
  additionalPrompt, setAdditionalPrompt,
  routeOptions,
  modelOptions,
  combinedPrompt,
  executingMode,
  elapsedMs,
  isOverlayDismissed, setIsOverlayDismissed,
  handleExecute,
  onSchedule,
  scheduleAnchorSprintOptions = [],
  handleCancelExecute,
  handleNewQuicksprint,
  defaultRouteOptionLabel,
  defaultModelOptionLabel,
  defaultRouteIconProviderId,
  planningEta,
  announcePhaseStatus,
}) => {
  const toDateTimeLocalValue = (date: Date): string => {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const createDefaultScheduleConfig = (): SprintScheduleConfig => {
    const scheduled = new Date();
    scheduled.setHours(scheduled.getHours() + 1, 0, 0, 0);
    return {
      mode: "absolute",
      scheduledFor: toDateTimeLocalValue(scheduled),
      sourceSprintId: "",
      offsetMinutes: 0,
    };
  };
  const isBusy = executingMode !== null;
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingExecuteMode, setPendingExecuteMode] = useState<"plan_only" | "plan_and_start" | null>(null);
  const [scheduleConfig, setScheduleConfig] = useState<SprintScheduleConfig>(() => createDefaultScheduleConfig());
  const [scheduleSubmitMode, setScheduleSubmitMode] = useState<"plan_only" | "plan_and_start">("plan_and_start");
  const [isSchedulePending, setIsSchedulePending] = useState(false);
  const [isCancelPending, setIsCancelPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scheduleFocusRef = useRef<HTMLElement | null>(null);
  const pendingExecuteClickRef = useRef(false);
  const promptRegionId = selectedTemplateId ? `quicksprint-combined-prompt-${selectedTemplateId}` : "quicksprint-combined-prompt";
  const busyDescriptionId = selectedTemplateId ? `quicksprint-busy-status-${selectedTemplateId}` : "quicksprint-busy-status";
  const duplicateSubmitDescriptionId = selectedTemplateId ? `quicksprint-submit-blocked-${selectedTemplateId}` : "quicksprint-submit-blocked";
  const routeStatusId = selectedTemplateId ? `quicksprint-route-status-${selectedTemplateId}` : "quicksprint-route-status";
  const interactionTokens = useInteractionTokens();
  const feedback = useMemo(
    () => isBusy ? getPlanningFeedback(executingMode === "plan_and_start" ? "plan_and_start" : "plan_only", elapsedMs) : null,
    [isBusy, executingMode, elapsedMs],
  );
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  const showModelOverride = routeOverride?.type === "virtual";
  const modelProviderId = routeOverride?.iconProviderId;

  const defaultModelLabel = routeOverride?.effectiveModel
    ? `Default (${routeOverride.effectiveModel})`
    : defaultModelOptionLabel;
  const isSubmitBlocked = isBusy || pendingExecuteMode !== null || isCancelPending || isSchedulePending;
  const controlsDisabled = isSubmitBlocked;
  const submitBlockedReason = isBusy
    ? "A quicksprint planning request is already running. Cancel it or wait for it to finish before submitting again."
    : pendingExecuteMode
      ? "Planning is starting. Duplicate submissions are blocked until the request state is ready."
      : isSchedulePending
        ? "Schedule creation is in progress. Duplicate submissions are blocked until it finishes."
      : isCancelPending
        ? "Cancellation is already in progress. Duplicate cancellation and submit requests are blocked until the request settles."
      : "";

  const publishStatus = (message: string) => {
    setStatusMessage(message);
    announcePhaseStatus?.(message);
  };

  const focusConfigureHeading = () => {
    headingRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate || isBusy || statusMessage) {
      return;
    }
    setStatusMessage(`${selectedTemplate.name} selected. Configure the quicksprint before planning.`);
  }, [isBusy, selectedTemplateId, selectedTemplate, statusMessage]);

  useEffect(() => {
    if (!executingMode || !selectedTemplate) {
      pendingExecuteClickRef.current = false;
      setPendingExecuteMode(null);
      setIsCancelPending(false);
      return;
    }
    const actionLabel = executingMode === "plan_and_start" ? "Plan and start" : "Plan only";
    const message = `${actionLabel} request started for ${selectedTemplate.name}.`;
    publishStatus(message);
  }, [announcePhaseStatus, executingMode, selectedTemplate]);

  const renderProviderIcon = (providerId: ProviderId) => (
    <div className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 dark:bg-white/10 shrink-0">
      <ProviderBrandIcon id={providerId} className="h-3.5 w-3.5" />
    </div>
  );

  const renderConnectedRouteIcon = () => (
    <div className="flex h-5 w-5 items-center justify-center rounded bg-ember-500/10 shrink-0">
      <BrainCircuit className="h-3.5 w-3.5 text-ember-500" />
    </div>
  );

  if (!selectedTemplate) return null;
  const TemplateIcon = IconMap[selectedTemplate.icon] || Zap;
  const tagColor = selectedTemplate.categoryColor || "slate";
  const handlePlanningExecute = (mode: "plan_only" | "plan_and_start") => {
    if (isBusy || pendingExecuteClickRef.current || pendingExecuteMode) {
      publishStatus(submitBlockedReason || "Planning is already in progress. Duplicate submission blocked.");
      return;
    }
    pendingExecuteClickRef.current = true;
    setPendingExecuteMode(mode);
    publishStatus(`${mode === "plan_and_start" ? "Plan and start" : "Plan only"} request queued for ${selectedTemplate.name}.`);
    handleExecute(mode);
  };
  const announceCancel = () => {
    if (isCancelPending) {
      publishStatus(`Cancellation is already in progress for ${selectedTemplate.name}.`);
      return;
    }
    const message = `Cancelled ${executingMode === "plan_and_start" ? "plan and start" : "plan only"} request for ${selectedTemplate.name}.`;
    setIsCancelPending(true);
    handleCancelExecute();
    pendingExecuteClickRef.current = false;
    setPendingExecuteMode(null);
    publishStatus(message);
    focusConfigureHeading();
  };
  const announceNewQuicksprint = () => {
    handleNewQuicksprint();
    setPhase("browse");
    const message = `Opened a new quicksprint while the previous ${executingMode === "plan_and_start" ? "plan and start" : "plan only"} request continues in the background.`;
    pendingExecuteClickRef.current = false;
    setPendingExecuteMode(null);
    publishStatus(message);
  };
  const handleSchedule = async () => {
    if (!onSchedule || !selectedTemplate || isSubmitBlocked) {
      publishStatus(submitBlockedReason || "Schedule request is already in progress. Duplicate submission blocked.");
      return;
    }
    if (scheduleConfig.mode === "after_sprint_end" && !scheduleConfig.sourceSprintId) {
      publishStatus("Choose the source sprint for the after-sprint-end schedule.");
      return;
    }
    if (scheduleConfig.mode === "absolute" && !Number.isFinite(new Date(scheduleConfig.scheduledFor).getTime())) {
      publishStatus("Choose a valid schedule date and time.");
      return;
    }

    scheduleFocusRef.current = document.activeElement as HTMLElement | null;
    setIsSchedulePending(true);
    publishStatus(`Scheduling ${selectedTemplate.name}.`);
    try {
      await onSchedule({
        templateId: selectedTemplate.id,
        taskCount,
        noTaskLimit,
        submitMode: scheduleSubmitMode,
        additionalPrompt: additionalPrompt.trim() || undefined,
        routeOverride,
        modelOverride,
        schedule: toSprintSchedulePayload(scheduleConfig),
        title: `Run ${selectedTemplate.name}`,
      });
      publishStatus(`${selectedTemplate.name} scheduled.`);
      setTimeout(() => {
        scheduleFocusRef.current?.focus({ preventScroll: true });
      }, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishStatus(`Could not schedule ${selectedTemplate.name}: ${message}`);
      setTimeout(() => {
        scheduleFocusRef.current?.focus({ preventScroll: true });
      }, 0);
    } finally {
      setIsSchedulePending(false);
    }
  };

  return (
    <>
{/* ─── CONFIGURE PHASE ────────────────────────────────────── */}
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_22rem]" aria-busy={isBusy || pendingExecuteMode !== null || isCancelPending ? "true" : "false"}>
            {/* Left: Template preview */}
            <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
              <div data-qs-stagger className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onBackToBrowse}
                  disabled={controlsDisabled}
                  aria-describedby={controlsDisabled ? duplicateSubmitDescriptionId : undefined}
                  className="inline-flex min-h-[44px] min-w-[44px] h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] text-slate-400 transition-colors duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:border-white/[0.06] dark:hover:text-white"
                  aria-label="Back to quicksprint templates"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />
                  Configure Quicksprint
                </div>
              </div>

              <h2
                ref={headingRef}
                tabIndex={-1}
                data-qs-stagger
                className="mt-6 font-display text-[1.8rem] font-black leading-tight tracking-tight text-slate-900 outline-none dark:text-white sm:text-[2.1rem]"
              >
                {selectedTemplate.name}
              </h2>
              <p data-qs-stagger className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {selectedTemplate.description}
              </p>

              {/* Planning Route + Model Override */}
              <div data-qs-stagger className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Planning Route</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      variant="compact"
                      disabled={controlsDisabled}
                      value={routeOverride?.id || ""}
                      onChange={(id) => {
                        const opt = routeOptions.find((o) => o.id === id);
                        setRouteOverride(opt || null);
                        publishStatus(`Planning route changed to ${opt?.label || defaultRouteOptionLabel}.`);
                      }}
                      aria-describedby={controlsDisabled ? duplicateSubmitDescriptionId : routeStatusId}
                      options={[
                        {
                          value: "",
                          label: defaultRouteOptionLabel,
                          icon: defaultRouteIconProviderId
                            ? () => renderProviderIcon(defaultRouteIconProviderId)
                            : undefined,
                        },
                        ...routeOptions.map((opt) => ({
                          value: opt.id,
                          label: opt.label,
                          icon: opt.type === "virtual" && opt.iconProviderId
                            ? () => renderProviderIcon(opt.iconProviderId!)
                            : opt.type === "connected"
                              ? renderConnectedRouteIcon
                              : undefined,
                        })),
                      ]}
                      placeholder={defaultRouteOptionLabel}
                    />
                  </div>
                </div>

                <div className={`rounded-[1.4rem] border p-4 transition-[background-color,border-color,opacity,transform] duration-[var(--interaction-list-reveal-duration)] ease-[var(--interaction-list-reveal-ease)] motion-reduce:transition-none ${
                  showModelOverride
                    ? "translate-y-0 border-signal-500/20 bg-signal-500/[0.04] opacity-100 dark:bg-signal-500/[0.08]"
                    : "translate-y-0 border-black/[0.06] bg-black/[0.025] opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03]"
                }`}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Model Override</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      variant="compact"
                      disabled={!showModelOverride || controlsDisabled}
                      value={modelOverride || ""}
                      onChange={(val) => {
                        const opt = modelOptions.find((option) => option.value === val);
                        setModelOverride(val || null);
                        publishStatus(`Model override changed to ${opt?.label || defaultModelLabel}.`);
                      }}
                      aria-describedby={controlsDisabled ? duplicateSubmitDescriptionId : routeStatusId}
                      options={[
                        {
                          value: "",
                          label: defaultModelLabel,
                          icon: modelProviderId
                            ? () => renderProviderIcon(modelProviderId)
                            : undefined,
                        },
                        ...modelOptions.map((opt) => ({
                          value: opt.value,
                          label: opt.label,
                          icon: modelProviderId
                            ? () => renderProviderIcon(modelProviderId)
                            : undefined,
                        })),
                      ]}
                      placeholder={defaultModelLabel}
                    />
                  </div>
                </div>
              </div>

              {/* Additional prompt for this run */}
              <div data-qs-stagger className="mt-8 space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Additional Instructions (optional)</label>
                <textarea
                  value={additionalPrompt}
                  onInput={(e) => {
                    setAdditionalPrompt((e.target as HTMLTextAreaElement).value);
                    publishStatus("Additional instructions updated for this quicksprint.");
                  }}
                  disabled={controlsDisabled}
                  aria-describedby={controlsDisabled ? duplicateSubmitDescriptionId : undefined}
                  placeholder="Add extra context or requirements for this specific run — e.g. 'Focus only on the auth module' or 'Include migration scripts'..."
                  rows={4}
                  className="w-full rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 text-sm leading-relaxed text-slate-700 outline-none transition-all placeholder:text-slate-300 focus:border-ember-500/40 focus:shadow-[0_0_0_1px_rgba(255,107,0,0.16),0_0_30px_rgba(255,107,0,0.08)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:placeholder:text-slate-600 resize-y"
                />
              </div>

              {/* Prompt preview */}
              <div data-qs-stagger className="mt-6">
                <button
                  onClick={() => {
                    const nextShowPrompt = !showPrompt;
                    setShowPrompt(nextShowPrompt);
                    publishStatus(nextShowPrompt ? "Combined prompt preview expanded." : "Combined prompt preview collapsed.");
                  }}
                  aria-expanded={showPrompt}
                  aria-controls={promptRegionId}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border px-3 transition-[background-color,border-color,color,box-shadow] duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] text-[10px] font-bold uppercase tracking-[0.14em] motion-reduce:transition-none ${
                    showPrompt
                      ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 shadow-[0_0_0_1px_rgba(0,224,160,0.12)] dark:text-signal-300"
                      : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  }`}
                >
                  {showPrompt ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showPrompt ? "Hide Combined Prompt" : "View Combined Prompt"}
                </button>

                <div
                  id={promptRegionId}
                  role="region"
                  aria-label="Combined quicksprint prompt"
                  data-motion-contract="expansionCollapse"
                  className={`overflow-hidden transition-[max-height,opacity,margin-top] duration-[var(--interaction-expansion-collapse-duration)] ease-[var(--interaction-expansion-collapse-ease)] motion-reduce:transition-none ${
                    showPrompt ? "mt-4 max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                  style={{
                    transitionDuration: interactionTokens.expansionCollapse.duration,
                    transitionTimingFunction: interactionTokens.expansionCollapse.ease,
                  }}
                >
                  <div className="rounded-[1.4rem] border border-black/[0.05] bg-black/[0.02] p-5 dark:border-white/[0.05] dark:bg-white/[0.02]">
                    <pre className="max-h-80 overflow-y-auto text-xs font-mono leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words scrollbar-thin scrollbar-thumb-black/10 dark:scrollbar-thumb-white/10">
                      {combinedPrompt}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Configuration sidebar */}
            <div className="flex flex-col p-6 sm:p-8">
              {/* Subtask count */}
              <div data-qs-stagger>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-4">Subtask Count</div>
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                    noTaskLimit
                      ? "border-ember-500/20 bg-ember-500/[0.06] text-ember-600 dark:text-ember-400"
                      : "border-black/[0.06] bg-black/[0.025] text-slate-500 hover:bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={noTaskLimit}
                    disabled={controlsDisabled}
                    aria-describedby={controlsDisabled ? duplicateSubmitDescriptionId : undefined}
                    onChange={(e) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      setNoTaskLimit(checked);
                      publishStatus(checked ? "Subtask limit removed for this quicksprint." : `Subtask count set to ${taskCount}.`);
                    }}
                    className="h-4 w-4 rounded border-black/20 text-ember-600 focus:ring-ember-500/30"
                  />
                  No limit
                </label>
                <div className="mt-5">
                  <SubtaskSlider
                    value={taskCount}
                    onChange={(value) => {
                      setTaskCount(value);
                      publishStatus(`Subtask count set to ${value}.`);
                    }}
                    disabled={noTaskLimit || controlsDisabled}
                  />
                </div>
              </div>

              {/* Spacer */}
              <div data-qs-stagger className="mt-8 rounded-[1.35rem] border border-signal-500/18 bg-signal-500/[0.045] p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-white">
                  <CalendarClock className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.1} />
                  Schedule
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Scheduled quicksprint submit mode">
                    {[
                      { value: "plan_and_start" as const, label: "Start Later" },
                      { value: "plan_only" as const, label: "Plan Later" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={controlsDisabled}
                        aria-pressed={scheduleSubmitMode === option.value}
                        onClick={() => {
                          setScheduleSubmitMode(option.value);
                          publishStatus(`Scheduled quicksprint submit mode set to ${option.label}.`);
                        }}
                        className={`min-h-[38px] rounded-full border px-3 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          scheduleSubmitMode === option.value
                            ? "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                            : "border-black/[0.06] bg-white/66 text-slate-500 hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Schedule timing mode">
                    {[
                      { value: "absolute" as const, label: "Absolute" },
                      { value: "after_sprint_end" as const, label: "After End" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={controlsDisabled}
                        aria-pressed={scheduleConfig.mode === option.value}
                        onClick={() => {
                          setScheduleConfig((current) => ({ ...current, mode: option.value }));
                          publishStatus(`Schedule timing set to ${option.label}.`);
                        }}
                        className={`min-h-[38px] rounded-full border px-3 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          scheduleConfig.mode === option.value
                            ? "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                            : "border-black/[0.06] bg-white/66 text-slate-500 hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {scheduleConfig.mode === "absolute" ? (
                    <label className="block">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Date and Time</span>
                      <input
                        type="datetime-local"
                        value={scheduleConfig.scheduledFor}
                        disabled={controlsDisabled}
                        onInput={(event) => setScheduleConfig((current) => ({ ...current, scheduledFor: (event.currentTarget as HTMLInputElement).value }))}
                        className="mt-2 min-h-[42px] w-full rounded-[1rem] border border-black/[0.06] bg-white/72 px-3 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200"
                      />
                    </label>
                  ) : (
                    <div className="grid gap-3">
                      <label className="block">
                        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Source Sprint</span>
                        <AvantgardeSelect
                          variant="compact"
                          aria-label="Quicksprint Source Sprint"
                          disabled={controlsDisabled}
                          value={scheduleConfig.sourceSprintId}
                          onChange={(value) => setScheduleConfig((current) => ({ ...current, sourceSprintId: value }))}
                          options={[
                            { value: "", label: "Choose sprint" },
                            ...scheduleAnchorSprintOptions.map((option) => ({ value: option.id, label: option.label })),
                          ]}
                          placeholder="Choose sprint"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Offset Minutes</span>
                        <input
                          type="number"
                          min={0}
                          value={scheduleConfig.offsetMinutes}
                          disabled={controlsDisabled}
                          onInput={(event) => setScheduleConfig((current) => ({ ...current, offsetMinutes: Number((event.currentTarget as HTMLInputElement).value) }))}
                          className="mt-2 min-h-[42px] w-full rounded-[1rem] border border-black/[0.06] bg-white/72 px-3 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-auto pt-8" />

              {/* Action buttons */}
              <div data-qs-stagger className="space-y-3">
                {isBusy && (
                  <div
                    id={busyDescriptionId}
                    data-motion-contract="asyncFeedback"
                    className="rounded-[1.25rem] border border-ember-500/20 bg-ember-500/[0.07] p-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300"
                    style={{
                      transitionDuration: interactionTokens.asyncFeedback.duration,
                      transitionTimingFunction: interactionTokens.asyncFeedback.ease,
                    }}
                    aria-busy={isCancelPending ? "true" : "false"}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold uppercase tracking-[0.14em] text-ember-600 dark:text-ember-400">
                        {executingMode === "plan_and_start" ? "Planning then starting" : "Planning only"}
                      </span>
                      <span className="font-mono text-slate-500">
                        {String(Math.floor(elapsedMs / 60000)).padStart(2, "0")}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="mt-2">
                      {feedback?.text || "Planning is in progress."} You can start another quicksprint while this request continues in the background.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={announceNewQuicksprint}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] hover:bg-slate-800 motion-reduce:transition-none dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        New Quicksprint
                      </button>
                      <button
                        type="button"
                        onClick={announceCancel}
                        disabled={isCancelPending}
                        aria-busy={isCancelPending ? "true" : "false"}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-status-red/20 bg-status-red/[0.06] px-4 py-2 text-xs font-semibold text-status-red transition-colors duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] hover:bg-status-red/[0.12] motion-reduce:transition-none"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel Request
                      </button>
                    </div>
                    {isCancelPending && (
                      <p className="mt-3 font-semibold text-status-amber">
                        Cancellation requested. The planner is stopping this quicksprint request.
                      </p>
                    )}
                  </div>
                )}
                {isSubmitBlocked && (
                  <p
                    id={duplicateSubmitDescriptionId}
                    className="text-xs leading-relaxed text-slate-500 dark:text-slate-400"
                  >
                    {submitBlockedReason}
                  </p>
                )}
                <p
                  id={routeStatusId}
                  className="rounded-[1.1rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-xs font-semibold leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
                >
                  {statusMessage || `Ready to plan ${selectedTemplate.name}.`}
                </p>
                <button
                  type="button"
                  onClick={() => { void handleSchedule(); }}
                  disabled={!onSchedule || isSubmitBlocked}
                  aria-busy={isSchedulePending ? "true" : "false"}
                  aria-describedby={isSubmitBlocked ? duplicateSubmitDescriptionId : undefined}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-[1.35rem] border border-signal-500/25 bg-signal-500/[0.1] px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-700 transition-colors hover:bg-signal-500/[0.16] disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300"
                >
                  <CalendarClock className={`h-4 w-4 ${isSchedulePending ? "motion-safe:animate-pulse" : ""}`} />
                  {isSchedulePending ? "Scheduling..." : "Schedule"}
                </button>
                <button
                  type="button"
                  onClick={() => handlePlanningExecute("plan_and_start")}
                  disabled={isSubmitBlocked}
                  aria-busy={executingMode === "plan_and_start" || pendingExecuteMode === "plan_and_start" ? "true" : "false"}
                  aria-describedby={isSubmitBlocked ? duplicateSubmitDescriptionId : undefined}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-[1.35rem] bg-ember-600 px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(255,107,0,0.25)] transition-all hover:bg-ember-500 hover:shadow-[0_0_28px_rgba(255,107,0,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Rocket className={`h-4 w-4 ${executingMode === "plan_and_start" ? "motion-safe:animate-pulse" : ""}`} />
                  Plan & Start
                </button>
                <button
                  type="button"
                  onClick={() => handlePlanningExecute("plan_only")}
                  disabled={isSubmitBlocked}
                  aria-busy={executingMode === "plan_only" || pendingExecuteMode === "plan_only" ? "true" : "false"}
                  aria-describedby={isSubmitBlocked ? duplicateSubmitDescriptionId : undefined}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-[1.35rem] border border-black/[0.08] bg-white/66 px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.04] disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                >
                  <ClipboardList className={`h-4 w-4 ${executingMode === "plan_only" ? "motion-safe:animate-pulse" : ""}`} />
                  Plan Only
                </button>
              </div>
            </div>
          </div>

      {/* ═══ Planning Overlay ═══ */}
      {executingMode && !isOverlayDismissed && (
        <PlanningProgressOverlay
          isBusy={isBusy}
          isDismissed={isOverlayDismissed}
          feedback={feedback}
          planningEta={planningEta}
          elapsedMs={elapsedMs}
          isDark={isDark}
          actionType="quicksprint"
          themeAccent="ember"
          onDismiss={() => setIsOverlayDismissed(true)}
          onCancel={announceCancel}
          secondaryActionLabel="New Quicksprint"
          onSecondaryAction={announceNewQuicksprint}
        />
      )}
    </>
  );
};
