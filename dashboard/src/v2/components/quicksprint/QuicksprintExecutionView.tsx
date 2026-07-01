import type { FunctionComponent } from "preact";
import { ChevronLeft, Info, BrainCircuit, MessageSquareText, Zap, Compass, Edit2, Play, TestTube2, AlertCircle, EyeOff, Eye, Rocket, ClipboardList } from "lucide-preact";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { SubtaskSlider, getTagStyles, IconMap } from "./quicksprint-shared.js";
import { PlanningProgressOverlay } from "../ui/PlanningProgressOverlay.js";
import type { ProviderId } from "../../types.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { getPlanningFeedback } from "../../lib/sprint-planning-feedback.js";
import { useMemo } from "preact/hooks";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

export const QuicksprintExecutionView: FunctionComponent<{
  setPhase: (phase: "browse" | "configure" | "editor") => void;
  selectedTemplateId: string | null;
  selectedTemplate: QuicksprintTemplateRecord | null;
  taskCount: number; setTaskCount: (v: number) => void;
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
  handleCancelExecute: () => void;
  handleNewQuicksprint: () => void;
  defaultRouteOptionLabel: string;
  defaultModelOptionLabel: string;
  defaultRouteIconProviderId: ProviderId | null;
  planningEta: number;
}> = ({
  setPhase,
  selectedTemplateId,
  selectedTemplate,
  taskCount, setTaskCount,
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
  handleCancelExecute,
  handleNewQuicksprint,
  defaultRouteOptionLabel,
  defaultModelOptionLabel,
  defaultRouteIconProviderId,
  planningEta,
}) => {
  const isBusy = executingMode !== null;
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

  return (
    <>
{/* ─── CONFIGURE PHASE ────────────────────────────────────── */}
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Left: Template preview */}
            <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
              <div data-qs-stagger className="flex items-center gap-3">
                <button
                  onClick={() => setPhase("browse")}
                  className="inline-flex min-h-[44px] min-w-[44px] h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />
                  Configure Quicksprint
                </div>
              </div>

              <h2 data-qs-stagger className="mt-6 font-display text-[1.8rem] font-black leading-tight tracking-tight text-slate-900 dark:text-white sm:text-[2.1rem]">
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
                      value={routeOverride?.id || ""}
                      onChange={(id) => {
                        const opt = routeOptions.find((o) => o.id === id);
                        setRouteOverride(opt || null);
                      }}
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

                <div className={`rounded-[1.4rem] border p-4 transition-all ${
                  showModelOverride
                    ? "border-signal-500/20 bg-signal-500/[0.04] dark:bg-signal-500/[0.08]"
                    : "border-black/[0.06] bg-black/[0.025] opacity-40 dark:border-white/[0.06] dark:bg-white/[0.03]"
                }`}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Model Override</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      variant="compact"
                      disabled={!showModelOverride}
                      value={modelOverride || ""}
                      onChange={(val) => setModelOverride(val || null)}
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
                  onInput={(e) => setAdditionalPrompt((e.target as HTMLTextAreaElement).value)}
                  placeholder="Add extra context or requirements for this specific run — e.g. 'Focus only on the auth module' or 'Include migration scripts'..."
                  rows={4}
                  className="w-full rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 text-sm leading-relaxed text-slate-700 outline-none transition-all placeholder:text-slate-300 focus:border-ember-500/40 focus:shadow-[0_0_0_1px_rgba(255,107,0,0.16),0_0_30px_rgba(255,107,0,0.08)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:placeholder:text-slate-600 resize-y"
                />
              </div>

              {/* Prompt preview */}
              <div data-qs-stagger className="mt-6">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPrompt ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showPrompt ? "Hide Combined Prompt" : "View Combined Prompt"}
                </button>

                <div
                  className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    showPrompt ? "mt-4 max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                  }`}
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
                <SubtaskSlider value={taskCount} onChange={setTaskCount} />
              </div>

              {/* Spacer */}
              <div className="mt-auto pt-8" />

              {/* Action buttons */}
              <div data-qs-stagger className="space-y-3">
                <button
                  onClick={() => handleExecute("plan_and_start")}
                  disabled={isBusy}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-[1.35rem] bg-ember-600 px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(255,107,0,0.25)] transition-all hover:bg-ember-500 hover:shadow-[0_0_28px_rgba(255,107,0,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Rocket className="h-4 w-4" />
                  Plan & Start
                </button>
                <button
                  onClick={() => handleExecute("plan_only")}
                  disabled={isBusy}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-[1.35rem] border border-black/[0.08] bg-white/66 px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.04] disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                >
                  <ClipboardList className="h-4 w-4" />
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
          onCancel={handleCancelExecute}
          secondaryActionLabel="New Quicksprint"
          onSecondaryAction={() => { handleNewQuicksprint(); setPhase("browse"); }}
        />
      )}
    </>
  );
};
