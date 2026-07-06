import { useState, useMemo, useEffect, useRef } from "preact/hooks";
import type { FunctionComponent, JSX } from "preact";
import gsap from "gsap";

import type { AgentPreset, ProviderId } from "../../types.js";
import type { PlanningRouteOption, SprintSchedulePayload } from "../../lib/sprint-composer-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

import { useQuicksprintEditorState } from "./use-quicksprint-editor-state.js";
import { useQuicksprintExecutionState } from "./use-quicksprint-execution-state.js";
import { QuicksprintBrowseView } from "./QuicksprintBrowseView.js";
import { QuicksprintEditorView } from "./QuicksprintEditorView.js";
import { QuicksprintExecutionView } from "./QuicksprintExecutionView.js";
import { clampSubtaskSliderValue } from "./quicksprint-shared.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

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
  onSchedule,
  scheduleAnchorSprintOptions = [],
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
  const deleteFallbackRef = useRef<HTMLElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

  /* ── Phase / Navigation ─────────────────────────────────────────── */
  const [phase, setPhase] = useState<Phase>("browse");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedBuiltinPurpose, setSelectedBuiltinPurpose] = useState("");
  const [phaseStatus, setPhaseStatus] = useState("Choose a quicksprint template.");
  const [blockingStatus, setBlockingStatus] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<QuicksprintTemplateRecord | null>(null);

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
    setBlockingStatus("");
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
    setBlockingStatus("");
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
    onCancel: () => {
      setPhase("browse");
      setPhaseStatus("Returned to templates.");
    },
    onStatus: setPhaseStatus,
    onError: setBlockingStatus,
  });

  const wrappedOpenEditor = (t: QuicksprintTemplateRecord | null) => {
    setBlockingStatus("");
    editorState.openEditor(t);
    setPhase("editor");
    setPhaseStatus(t ? `Editing ${t.name}.` : "Creating a new quicksprint template.");
  };

  const restoreDeleteFocus = () => {
    const focusTarget = () => {
      if (deleteTriggerRef.current?.isConnected) {
        deleteTriggerRef.current.focus({ preventScroll: true });
        return;
      }
      deleteFallbackRef.current?.focus({ preventScroll: true });
    };
    focusTarget();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusTarget();
      });
    });
  };

  const handleDeleteTemplate = (template: QuicksprintTemplateRecord, trigger?: HTMLElement | null) => {
    setBlockingStatus("");
    deleteTriggerRef.current = trigger || null;
    setDeleteTarget(template);
    setPhaseStatus(`Confirm deletion for ${template.name}.`);
  };

  const confirmDeleteTemplate = async () => {
    if (!deleteTarget) return;
    const template = deleteTarget;
    setPhaseStatus(`Deleting ${template.name} from quicksprint templates.`);
    try {
      await onDeleteTemplate?.(template.id);
      setPhaseStatus(`${template.name} deleted from quicksprint templates.`);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete quicksprint template", error);
      setBlockingStatus(`Could not delete ${template.name}. Try again or check the project template files.`);
      setPhaseStatus(`Deletion failed for ${template.name}.`);
      setDeleteTarget(null);
    } finally {
      restoreDeleteFocus();
    }
  };

  const cancelDeleteTemplate = () => {
    const templateName = deleteTarget?.name;
    setDeleteTarget(null);
    if (templateName) {
      setPhaseStatus(`Deletion cancelled for ${templateName}.`);
    }
    restoreDeleteFocus();
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
    onError: (message) => {
      setBlockingStatus(message);
      setPhaseStatus(message);
    },
    onStatus: setPhaseStatus,
  });

  useEffect(() => {
    return () => {
      executionState.detachCurrentRequest();
    };
  }, [executionState.detachCurrentRequest]);

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
    "--interaction-list-reveal-duration": interactionTokens.listReveal.duration,
    "--interaction-list-reveal-ease": interactionTokens.listReveal.ease,
    "--interaction-list-reorder-duration": interactionTokens.listReorder.duration,
    "--interaction-list-reorder-ease": interactionTokens.listReorder.ease,
    "--interaction-inline-validation-duration": interactionTokens.inlineValidation.duration,
    "--interaction-inline-validation-ease": interactionTokens.inlineValidation.ease,
    "--interaction-async-feedback-duration": interactionTokens.asyncFeedback.duration,
    "--interaction-async-feedback-ease": interactionTokens.asyncFeedback.ease,
  } as JSX.CSSProperties;
  const deleteConfirmOptions: ConfirmDialogOptions | null = deleteTarget
    ? {
      title: `Delete ${deleteTarget.name}?`,
      body: deleteTarget.isBuiltIn
        ? `Delete ${deleteTarget.name} from this project by hiding the default template. The shared bundled template remains available outside this project.`
        : `Delete ${deleteTarget.name} from this project's custom templates.`,
      confirmLabel: `Delete ${deleteTarget.name}`,
      cancelLabel: "Cancel",
      destructive: true,
    }
    : null;

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <section
      ref={cardRef}
      data-motion-contract="enterExit"
      className={`relative w-full rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)] ${overflowClass}`}
      style={motionStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.07),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.06),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.07),transparent_34%)]" />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {phaseStatus}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {blockingStatus}
      </div>

      <div className={`relative min-h-[480px] ${contentOverflowClass}`} ref={fieldsRef}>
        {phase === "browse" && (
          <QuicksprintBrowseView
            templates={browseTemplates}
            builtinPurposeOptions={builtinPurposeOptions}
            selectedBuiltinPurpose={selectedBuiltinPurpose}
            setSelectedBuiltinPurpose={setSelectedBuiltinPurpose}
            announcePhaseStatus={setPhaseStatus}
            phaseStatus={phaseStatus}
            fallbackFocusRef={deleteFallbackRef}
            handleSelectTemplate={handleSelectTemplate}
            openEditor={wrappedOpenEditor}
            handleDeleteTemplate={onDeleteTemplate ? handleDeleteTemplate : undefined}
            activeBuiltinPurpose={activeBuiltinPurpose}
            loading={loading}
            onClose={onClose}
            selectedTemplateId={selectedTemplateId}
          />
        )}
        {phase === "editor" && (
          <QuicksprintEditorView
            agentPresets={agentPresets}
            setPhase={(nextPhase) => {
              setBlockingStatus("");
              setPhase(nextPhase);
              if (nextPhase === "browse") {
                setPhaseStatus("Returned to templates.");
              }
            }}
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
            onSchedule={onSchedule}
            scheduleAnchorSprintOptions={scheduleAnchorSprintOptions}
            defaultRouteOptionLabel={defaultRouteOptionLabel}
            defaultModelOptionLabel={defaultModelOptionLabel}
            defaultRouteIconProviderId={defaultRouteIconProviderId}
            planningEta={planningEta}
            announcePhaseStatus={setPhaseStatus}
          />
        )}
      </div>
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        options={deleteConfirmOptions}
        onConfirm={confirmDeleteTemplate}
        onCancel={cancelDeleteTemplate}
        restoreFocus={false}
      />
    </section>
  );
};
