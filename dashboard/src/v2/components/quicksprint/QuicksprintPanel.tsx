import { useState, useMemo, useEffect, useRef } from "preact/hooks";
import type { FunctionComponent } from "preact";
import gsap from "gsap";

import type { AgentPreset, ProviderId } from "../../types.js";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

import { useQuicksprintEditorState } from "./use-quicksprint-editor-state.js";
import { useQuicksprintExecutionState } from "./use-quicksprint-execution-state.js";
import { QuicksprintBrowseView } from "./QuicksprintBrowseView.js";
import { QuicksprintEditorView } from "./QuicksprintEditorView.js";
import { QuicksprintExecutionView } from "./QuicksprintExecutionView.js";

import {
  getBuiltinTemplates,
  getCustomTemplates,
  getBuiltinPurposeOptions,
  getActiveBuiltinPurpose,
  getVisibleBuiltinTemplates,
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

  /* ── Phase / Navigation ─────────────────────────────────────────── */
  const [phase, setPhase] = useState<Phase>("browse");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedBuiltinPurpose, setSelectedBuiltinPurpose] = useState("");

  /* ── Configure state ────────────────────────────────────────────── */
  const [taskCount, setTaskCount] = useState(5);
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

  /* ── Handlers ────────────────────────────────────────────── */
  const handleSelectTemplate = (t: QuicksprintTemplateRecord) => {
    setSelectedTemplateId(t.id);
    setTaskCount(t.defaultTaskCount || 5);
    setPhase("configure");
    setRouteOverride(null);
    setModelOverride(null);
    setShowPrompt(false);
    setAdditionalPrompt("");
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
  };

  const executionState = useQuicksprintExecutionState({
    onExecute,
    virtualProviders,
    routeOverride,
    modelOverride,
    selectedTemplate,
    additionalPrompt,
    taskCount,
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
      y: 0, opacity: 1, scale: 1, duration: 0.72, ease: "power4.out",
    });
  }, []);

  useEffect(() => {
    if (!fieldsRef.current) return;
    const items = fieldsRef.current.querySelectorAll("[data-qs-stagger]");
    if (!items.length) return;
    gsap.fromTo(items, { y: 18, opacity: 0 }, {
      y: 0, opacity: 1, stagger: 0.055, duration: 0.5, ease: "power3.out",
      delay: 0.1,
    });
  }, [phase, showPrompt]);

  const overflowClass = phase === "editor" && (editorState.showIconPicker || editorState.showColorPicker) ? "" : "overflow-hidden";

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <section
      ref={cardRef}
      className={`relative w-full rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)] ${overflowClass}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.07),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.06),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.07),transparent_34%)]" />

      <div className="relative min-h-[480px] max-h-[calc(100dvh-12rem)]" ref={fieldsRef}>
        {phase === "browse" && (
          <QuicksprintBrowseView
            templates={templates}
            builtinTemplates={builtinTemplates}
            customTemplates={customTemplates}
            visibleBuiltinTemplates={visibleBuiltinTemplates}
            builtinPurposeOptions={builtinPurposeOptions}
            selectedBuiltinPurpose={selectedBuiltinPurpose}
            setSelectedBuiltinPurpose={setSelectedBuiltinPurpose}
            handleSelectTemplate={handleSelectTemplate}
            openEditor={wrappedOpenEditor}
            activeBuiltinPurpose={activeBuiltinPurpose}
            loading={loading}
            onClose={onClose}
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
            selectedTemplateId={selectedTemplateId}
            selectedTemplate={selectedTemplate}
            taskCount={taskCount} setTaskCount={setTaskCount}
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
          />
        )}
      </div>
    </section>
  );
};
