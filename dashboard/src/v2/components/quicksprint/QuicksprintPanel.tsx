import { useState, useMemo, useEffect, useRef } from "preact/hooks";
import type { FunctionComponent, JSX } from "preact";
import gsap from "gsap";

import type { AgentPreset, ProviderId } from "../../types.js";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

import { useQuicksprintEditorState } from "./use-quicksprint-editor-state.js";
import { useQuicksprintExecutionState } from "./use-quicksprint-execution-state.js";
import { QuicksprintBrowseView } from "./QuicksprintBrowseView.js";
import { QuicksprintEditorView } from "./QuicksprintEditorView.js";
import { QuicksprintExecutionView } from "./QuicksprintExecutionView.js";
import { clampSubtaskSliderValue } from "./quicksprint-shared.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

import {
  getBuiltinTemplates,
  getCustomTemplates,
  getBuiltinPurposeOptions,
  getActiveBuiltinPurpose,
  getVisibleBuiltinTemplates,
  getBrowseTemplates,
} from "../../lib/quicksprint-panel-state.js";

/* ─── Types ─────────────────────────────────────────────────────────── */
type Phase = "browse" | "configure" | "editor";

interface VirtualProviderOption {
  id?: string;
  providerConfigId?: string;
  provider?: string;
  label?: string;
  displayLabel?: string;
  iconProviderId?: ProviderId;
  effectiveModel?: string;
}

interface QuicksprintExecutionOptions {
  shouldHandleResult?: () => boolean;
  noTaskLimit?: boolean;
}

interface QuicksprintPanelProps {
  projectId: string;
  onClose: () => void;
  onExecute: (templateId: string, taskCount: number, submitMode: "plan_only" | "plan_and_start", additionalPrompt?: string, routeOverride?: PlanningRouteOption | null, modelOverride?: string | null, signal?: AbortSignal, options?: QuicksprintExecutionOptions) => Promise<void>;
  templates: QuicksprintTemplateRecord[];
  loading?: boolean;
  agentPresets?: AgentPreset[];
  virtualProviders?: VirtualProviderOption[];
  defaultRouteOptionLabel?: string;
  defaultModelOptionLabel?: string;
  defaultRouteIconProviderId?: ProviderId | null;
  planningEta?: number;
  onCreateTemplate?: (data: {
    name: string;
    description: string;
    icon: string;
    category: string;
    categoryColor?: string;
    agentInstructionMarkdown: string;
    defaultTaskCount: number;
    agentPresetId?: string;
  }) => Promise<void>;
  onUpdateTemplate?: (templateId: string, data: {
    name: string;
    description: string;
    icon: string;
    category: string;
    categoryColor?: string;
    agentInstructionMarkdown: string;
    defaultTaskCount: number;
    agentPresetId?: string;
  }) => Promise<void>;
  onDeleteTemplate?: (templateId: string) => Promise<void>;
}

/* ─── Main Component ───────────────────────────────────────────────── */
export const QuicksprintPanel: FunctionComponent<QuicksprintPanelProps> = ({
  projectId,
  onClose,
  onExecute,
  templates,
  loading = false,
  agentPresets = [],
  virtualProviders = [],
  defaultRouteOptionLabel = "Default Route",
  defaultModelOptionLabel = "Default Model",
  defaultRouteIconProviderId = null,
  planningEta = 180_000,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const gsapTokens = useGsapInteractionTokens();
  const interactionTokens = useInteractionTokens();

  /* ── Phase / Navigation ─────────────────────────────────────────── */
  const [phase, setPhase] = useState<Phase>("browse");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedBuiltinPurpose, setSelectedBuiltinPurpose] = useState("");
  const [phaseStatus, setPhaseStatus] = useState("Choose a quicksprint template.");

  /* ── Configure state ────────────────────────────────────────────── */
  const [taskCount, setTaskCount] = useState(5);
  const [noTaskLimit, setNoTaskLimit] = useState(false);
  const [routeOverride, setRouteOverride] = useState<PlanningRouteOption | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");

  /* ── Computed Data ────────────────────────────────────────────── */
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  const builtinTemplates = useMemo(
    () => getBuiltinTemplates(templates),
    [templates],
  );

  const customTemplates = useMemo(
    () => getCustomTemplates(templates),
    [templates],
  );

  const builtinPurposeOptions = useMemo(
    () => getBuiltinPurposeOptions(builtinTemplates),
    [builtinTemplates],
  );

  useEffect(() => {
    if (builtinPurposeOptions.length === 0) {
      if (selectedBuiltinPurpose) {
        setSelectedBuiltinPurpose("");
      }
      return;
    }
    if (!builtinPurposeOptions.some((option) => option.value === selectedBuiltinPurpose)) {
      setSelectedBuiltinPurpose(builtinPurposeOptions[0].value);
    }
  }, [builtinPurposeOptions, selectedBuiltinPurpose]);

  const activeBuiltinPurpose = useMemo(
    () => getActiveBuiltinPurpose(builtinPurposeOptions, selectedBuiltinPurpose),
    [builtinPurposeOptions, selectedBuiltinPurpose],
  );

  const visibleBuiltinTemplates = useMemo(
    () => getVisibleBuiltinTemplates(builtinTemplates, activeBuiltinPurpose),
    [activeBuiltinPurpose, builtinTemplates]
  );

  const browseTemplates = useMemo(
    () => getBrowseTemplates(visibleBuiltinTemplates, customTemplates),
    [customTemplates, visibleBuiltinTemplates],
  );

  /* ── Handlers ────────────────────────────────────────────── */
  const handleSelectTemplate = (t: QuicksprintTemplateRecord) => {
    setSelectedTemplateId(t.id);
    setTaskCount(clampSubtaskSliderValue(t.defaultTaskCount || 5));
    setNoTaskLimit(false);
    setPhase("configure");
    setRouteOverride(null);
    setModelOverride(null);
    setShowPrompt(false);
    setAdditionalPrompt("");
    setPhaseStatus(`${t.name} selected. Configure the quicksprint before planning.`);
  };

  const handleBackToBrowse = () => {
    setPhase("browse");
    setPhaseStatus(
      selectedTemplate
        ? `Returned to templates. ${selectedTemplate.name} remains selected.`
        : "Returned to templates.",
    );
  };

  /* ── Hooks ────────────────────────────────────────────── */
  const editorState = useQuicksprintEditorState({
    templates,
    onCreateTemplate,
    onUpdateTemplate,
    onDeleteTemplate,
    onCancel: () => setPhase("browse"),
  });

  const wrappedOpenEditor = (t: QuicksprintTemplateRecord | null) => {
    editorState.openEditor(t);
    setPhase("editor");
    setPhaseStatus(t ? `Editing ${t.name}.` : "Creating a new quicksprint template.");
  };

  const handleDeleteTemplate = async (template: QuicksprintTemplateRecord) => {
    const message = template.isBuiltIn
      ? `Delete the default template "${template.name}" for this project?`
      : `Delete the custom template "${template.name}"?`;
    if (!window.confirm(message)) {
      return;
    }
    await onDeleteTemplate?.(template.id);
  };

  const executionState = useQuicksprintExecutionState({
    onExecute,
    virtualProviders,
    routeOverride,
    modelOverride,
    selectedTemplate,
    additionalPrompt,
    taskCount,
    noTaskLimit,
    agentPresets,
    onClose,
  });

  useEffect(() => {
    return () => {
      executionState.handleCancelExecute();
    };
  }, [executionState.handleCancelExecute]);

  /* ── Animations ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(cardRef.current, { y: 28, opacity: 0, scale: 0.985 }, {
      y: 0, opacity: 1, scale: 1, duration: gsapTokens.enterExit.duration, ease: gsapTokens.enterExit.ease,
    });
  }, [gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

  useEffect(() => {
    if (!fieldsRef.current) return;
    const items = fieldsRef.current.querySelectorAll("[data-qs-stagger]");
    if (!items.length) return;
    gsap.fromTo(items, { y: 18, opacity: 0 }, {
      y: 0,
      opacity: 1,
      stagger: gsapTokens.listReveal.duration === 0 ? 0 : gsapTokens.controlFeedback.duration / 3,
      duration: gsapTokens.listReveal.duration,
      ease: gsapTokens.listReveal.ease,
    });
  }, [phase, showPrompt, gsapTokens.listReveal.duration, gsapTokens.listReveal.ease, gsapTokens.controlFeedback.duration]);

  const pickerOpen = phase === "editor" && (editorState.showIconPicker || editorState.showColorPicker);
  const overflowClass = pickerOpen ? "" : "overflow-hidden";
  const contentOverflowClass = pickerOpen ? "overflow-visible" : "";
  const motionStyle = {
    "--interaction-control-feedback-duration": interactionTokens.controlFeedback.duration,
    "--interaction-control-feedback-ease": interactionTokens.controlFeedback.ease,
    "--interaction-enter-exit-duration": interactionTokens.enterExit.duration,
    "--interaction-enter-exit-ease": interactionTokens.enterExit.ease,
    "--interaction-expansion-collapse-duration": interactionTokens.expansionCollapse.duration,
    "--interaction-expansion-collapse-ease": interactionTokens.expansionCollapse.ease,
    "--interaction-selection-movement-duration": interactionTokens.selectionMovement.duration,
    "--interaction-selection-movement-ease": interactionTokens.selectionMovement.ease,
  } as JSX.CSSProperties;

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <section
      ref={cardRef}
      className={`relative w-full rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)] ${overflowClass}`}
      style={motionStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.07),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.06),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.07),transparent_34%)]" />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {phaseStatus}
      </div>

      <div className={`relative min-h-[480px] ${contentOverflowClass}`} ref={fieldsRef}>
        {phase === "browse" && (
          <QuicksprintBrowseView
            templates={browseTemplates}
            builtinPurposeOptions={builtinPurposeOptions}
            selectedBuiltinPurpose={selectedBuiltinPurpose}
            setSelectedBuiltinPurpose={setSelectedBuiltinPurpose}
            handleSelectTemplate={handleSelectTemplate}
            openEditor={wrappedOpenEditor}
            handleDeleteTemplate={onDeleteTemplate ? (template) => { void handleDeleteTemplate(template); } : undefined}
            activeBuiltinPurpose={activeBuiltinPurpose}
            loading={loading}
            onClose={onClose}
            selectedTemplateId={selectedTemplateId}
          />
        )}
        {phase === "editor" && (
          <QuicksprintEditorView
            agentPresets={agentPresets}
            setPhase={setPhase}
            cardRef={cardRef}
            {...editorState}
          />
        )}
        {phase === "configure" && (
          <QuicksprintExecutionView
            setPhase={setPhase}
            onBackToBrowse={handleBackToBrowse}
            selectedTemplateId={selectedTemplateId}
            selectedTemplate={selectedTemplate}
            taskCount={taskCount} setTaskCount={setTaskCount}
            noTaskLimit={noTaskLimit} setNoTaskLimit={setNoTaskLimit}
            routeOverride={routeOverride} setRouteOverride={setRouteOverride}
            modelOverride={modelOverride} setModelOverride={setModelOverride}
            showPrompt={showPrompt} setShowPrompt={setShowPrompt}
            additionalPrompt={additionalPrompt} setAdditionalPrompt={setAdditionalPrompt}
            routeOptions={executionState.routeOptions}
            modelOptions={executionState.modelOptions}
            combinedPrompt={executionState.combinedPrompt}
            executingMode={executionState.executingMode}
            elapsedMs={executionState.elapsedMs}
            isOverlayDismissed={executionState.isOverlayDismissed} setIsOverlayDismissed={executionState.setIsOverlayDismissed}
            handleExecute={executionState.handleExecute}
            handleCancelExecute={executionState.handleCancelExecute}
            handleNewQuicksprint={executionState.handleNewQuicksprint}
            defaultRouteOptionLabel={defaultRouteOptionLabel}
            defaultModelOptionLabel={defaultModelOptionLabel}
            defaultRouteIconProviderId={defaultRouteIconProviderId}
            planningEta={planningEta}
            announcePhaseStatus={setPhaseStatus}
          />
        )}
      </div>
    </section>
  );
};
