import { useState, useMemo, useEffect, useRef, useCallback } from "preact/hooks";
import type { FunctionComponent } from "preact";
import {
  X, Plus, Trash2, ChevronLeft, Eye, EyeOff,
  Sparkles, ShieldCheck, Accessibility, Zap,
  Rocket, ClipboardList, Settings2,
  Bug, Code2, Database, FileSearch, FlaskConical,
  GitBranch, Globe, Hammer, Heart, Layers,
  LayoutGrid, Lock, Microscope, Monitor,
  Paintbrush, RefreshCw, Search, Server,
  Shield, Terminal, TestTube2, Wrench,
} from "lucide-preact";
import gsap from "gsap";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import type { AgentPreset, ExecutionConnectionSummary, VirtualWorkerProvider } from "../../types.js";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { getPlanningFeedback } from "../../lib/sprint-planning-feedback.js";
import { ContainerShip } from "../ui/PlanningShip.js";

/* ─── Icon Map ──────────────────────────────────────────────────────── */
const IconMap: Record<string, FunctionComponent<any>> = {
  Sparkles, ShieldCheck, Accessibility, Zap,
  Bug, Code2, Database, FileSearch, FlaskConical,
  GitBranch, Globe, Hammer, Heart, Layers,
  LayoutGrid, Lock, Microscope, Monitor,
  Paintbrush, RefreshCw, Search, Server,
  Shield, Terminal, TestTube2, Wrench,
};

const TAG_COLOR_PALETTE = [
  "#22c55e", "#f97316", "#a855f7", "#3b82f6", "#ef4444",
  "#eab308", "#06b6d4", "#ec4899", "#8b5cf6", "#14b8a6",
  "#f43f5e", "#84cc16", "#6366f1", "#0ea5e9", "#d946ef",
  "#fb923c", "#a3e635", "#2dd4bf", "#f472b6", "#818cf8",
];

const ICON_OPTIONS: ReadonlyArray<{ value: string; Icon: FunctionComponent<any> }> = [
  { value: "Sparkles", Icon: Sparkles },
  { value: "ShieldCheck", Icon: ShieldCheck },
  { value: "Accessibility", Icon: Accessibility },
  { value: "Zap", Icon: Zap },
  { value: "Bug", Icon: Bug },
  { value: "Code2", Icon: Code2 },
  { value: "Database", Icon: Database },
  { value: "FileSearch", Icon: FileSearch },
  { value: "FlaskConical", Icon: FlaskConical },
  { value: "GitBranch", Icon: GitBranch },
  { value: "Globe", Icon: Globe },
  { value: "Hammer", Icon: Hammer },
  { value: "Heart", Icon: Heart },
  { value: "Layers", Icon: Layers },
  { value: "LayoutGrid", Icon: LayoutGrid },
  { value: "Lock", Icon: Lock },
  { value: "Microscope", Icon: Microscope },
  { value: "Monitor", Icon: Monitor },
  { value: "Paintbrush", Icon: Paintbrush },
  { value: "RefreshCw", Icon: RefreshCw },
  { value: "Search", Icon: Search },
  { value: "Server", Icon: Server },
  { value: "Shield", Icon: Shield },
  { value: "Terminal", Icon: Terminal },
  { value: "TestTube2", Icon: TestTube2 },
  { value: "Wrench", Icon: Wrench },
];

/* ─── Types ─────────────────────────────────────────────────────────── */
type Phase = "browse" | "configure" | "editor";

interface QuicksprintPanelProps {
  projectId: string;
  onClose: () => void;
  onExecute: (templateId: string, taskCount: number, submitMode: "plan_only" | "plan_and_start", additionalPrompt?: string, routeOverride?: PlanningRouteOption | null, modelOverride?: string | null) => Promise<void>;
  templates: QuicksprintTemplateRecord[];
  loading?: boolean;
  agentPresets?: AgentPreset[];
  connections?: ExecutionConnectionSummary[];
  virtualProviders?: Array<{ id: VirtualWorkerProvider; label: string }>;
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
  connections = [],
  virtualProviders = [],
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

  /* ── Configure state ────────────────────────────────────────────── */
  const [taskCount, setTaskCount] = useState(5);
  const [routeOverride, setRouteOverride] = useState<PlanningRouteOption | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");

  /* ── Editor state ───────────────────────────────────────────────── */
  const [editorTemplate, setEditorTemplate] = useState<QuicksprintTemplateRecord | null>(null);
  const [edName, setEdName] = useState("");
  const [edDescription, setEdDescription] = useState("");
  const [edIcon, setEdIcon] = useState("Zap");
  const [edCategory, setEdCategory] = useState("engineering");
  const [edCategoryColor, setEdCategoryColor] = useState("#22c55e");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [edInstruction, setEdInstruction] = useState("");
  const [edTaskCount, setEdTaskCount] = useState(5);
  const [edAgentPresetId, setEdAgentPresetId] = useState("");
  const [edSaving, setEdSaving] = useState(false);
  const [edConfirmDelete, setEdConfirmDelete] = useState(false);

  /* ── Execution state ────────────────────────────────────────────── */
  const [executingMode, setExecutingMode] = useState<"plan_only" | "plan_and_start" | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const isBusy = executingMode !== null;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  /* ── Combined prompt preview (agent + template + additional) ────── */
  const combinedPrompt = useMemo(() => {
    if (!selectedTemplate) return "";
    const parts: string[] = [];

    const effectiveAgentPresetId = selectedTemplate.agentPresetId;
    if (effectiveAgentPresetId) {
      const agent = agentPresets.find((p) => p.id === effectiveAgentPresetId);
      if (agent?.instructionMarkdown) {
        parts.push(`## Agent Context\n\nYou are operating as the "${agent.name}" agent. Follow these agent-specific instructions:\n\n${agent.instructionMarkdown}\n\n---`);
      }
    }

    if (selectedTemplate.agentInstructionMarkdown) {
      parts.push(selectedTemplate.agentInstructionMarkdown);
    }

    if (additionalPrompt.trim()) {
      parts.push(`## Additional Instructions\n\n${additionalPrompt.trim()}`);
    }

    parts.push(`Produce exactly ${taskCount} subtasks.`);

    return parts.join("\n\n");
  }, [selectedTemplate, agentPresets, additionalPrompt, taskCount]);

  /* ── Route options (matching SprintComposer) ────────────────────── */
  const routeOptions = useMemo<PlanningRouteOption[]>(() => {
    const opts: PlanningRouteOption[] = [];
    for (const conn of connections) {
      if (conn.status === "connected" || conn.status === "listening" || conn.status === "idle") {
        opts.push({ type: "connected", id: conn.id, label: conn.displayName || conn.connectionKey });
      }
    }
    for (const vp of virtualProviders) {
      opts.push({ type: "virtual", id: vp.id, label: vp.label, provider: vp.id });
    }
    return opts;
  }, [connections, virtualProviders]);

  const showModelOverride = routeOverride?.type === "virtual";
  const modelOptions = useMemo(
    () => (showModelOverride && routeOverride?.provider ? getProviderModelOptions(routeOverride.provider) : []),
    [showModelOverride, routeOverride],
  );

  /* ── Planning feedback / timer ──────────────────────────────────── */
  useEffect(() => {
    if (!isBusy) { setElapsedMs(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [isBusy]);

  const feedback = useMemo(
    () => isBusy ? getPlanningFeedback(executingMode === "plan_and_start" ? "plan_and_start" : "plan_only", elapsedMs) : null,
    [isBusy, executingMode, elapsedMs],
  );
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

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
    });
  }, [phase]);

  /* ── Select template → configure ────────────────────────────────── */
  const handleSelectTemplate = useCallback((t: QuicksprintTemplateRecord) => {
    setSelectedTemplateId(t.id);
    setTaskCount(t.defaultTaskCount || 5);
    setRouteOverride(null);
    setModelOverride(null);
    setShowPrompt(false);
    setAdditionalPrompt("");
    setPhase("configure");
  }, []);

  /* ── Open editor ────────────────────────────────────────────────── */
  const openEditor = useCallback((t: QuicksprintTemplateRecord | null) => {
    setEditorTemplate(t);
    setEdName(t?.name || "");
    setEdDescription(t?.description || "");
    setEdIcon(t?.icon || "Zap");
    setEdCategory(t?.category || "engineering");
    setEdCategoryColor(t?.categoryColor || "#22c55e");
    setShowColorPicker(false);
    setShowIconPicker(false);
    setEdInstruction(t?.agentInstructionMarkdown || "");
    setEdTaskCount(t?.defaultTaskCount || 5);
    setEdAgentPresetId("");
    setEdSaving(false);
    setEdConfirmDelete(false);
    setPhase("editor");
  }, []);

  /* ── Editor save ────────────────────────────────────────────────── */
  const handleEditorSave = useCallback(async () => {
    if (!edName.trim() || (!edInstruction.trim() && !edAgentPresetId)) return;
    setEdSaving(true);
    try {
      const data = {
        name: edName.trim(),
        description: edDescription.trim(),
        icon: edIcon,
        category: edCategory,
        categoryColor: edCategoryColor,
        agentInstructionMarkdown: edInstruction.trim(),
        defaultTaskCount: edTaskCount,
        agentPresetId: edAgentPresetId || undefined,
      };
      if (editorTemplate) {
        await onUpdateTemplate?.(editorTemplate.id, data);
      } else {
        await onCreateTemplate?.(data);
      }
      setPhase("browse");
    } finally {
      setEdSaving(false);
    }
  }, [edName, edDescription, edIcon, edCategory, edCategoryColor, edInstruction, edTaskCount, edAgentPresetId, editorTemplate, onCreateTemplate, onUpdateTemplate]);

  const handleEditorDelete = useCallback(async () => {
    if (!edConfirmDelete) { setEdConfirmDelete(true); return; }
    if (!editorTemplate) return;
    await onDeleteTemplate?.(editorTemplate.id);
    if (selectedTemplateId === editorTemplate.id) setSelectedTemplateId(null);
    setPhase("browse");
  }, [edConfirmDelete, editorTemplate, selectedTemplateId, onDeleteTemplate]);

  /* ── Execute ────────────────────────────────────────────────────── */
  const handleExecute = useCallback(async (mode: "plan_only" | "plan_and_start") => {
    if (!selectedTemplate) return;
    setExecutingMode(mode);
    try {
      await onExecute(selectedTemplate.id, taskCount, mode, additionalPrompt.trim() || undefined, routeOverride, modelOverride);
    } finally {
      setExecutingMode(null);
    }
  }, [selectedTemplate, taskCount, additionalPrompt, onExecute, routeOverride, modelOverride]);

  const builtinTemplates = templates.filter((t) => t.isBuiltIn);
  const customTemplates = templates.filter((t) => !t.isBuiltIn);

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <section
      ref={cardRef}
      className={`relative w-full rounded-[2rem] border border-black/[0.06] bg-white/78 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)] ${showIconPicker || showColorPicker ? "" : "overflow-hidden"}`}
    >
      {/* Radial accents */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.07),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.06),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.09),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(0,224,160,0.07),transparent_34%)]" />

      {/* ═══ Planning Overlay ═══ */}
      {isBusy && feedback && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 p-8 backdrop-blur-xl dark:bg-void-900/80">
          <div className="relative mb-12 flex h-32 w-full max-w-md items-center justify-center overflow-hidden">
            <div className="absolute inset-x-0 bottom-8 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-white/10" />
            <div
              className="absolute transition-[left] duration-200 ease-linear"
              style={{ left: `${feedback.shipProgress * 100}%`, transform: "translateX(-50%)" }}
            >
              <svg width="120" height="60" viewBox="-60 -30 120 60">
                <ContainerShip accentColor="#FF6B00" isMoving={true} isDark={isDark} />
              </svg>
            </div>
          </div>

          <div className="space-y-4 text-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-ember-500/20 bg-ember-500/[0.08] px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] text-ember-600 dark:text-ember-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ember-500" />
              </span>
              Quicksprint in motion
            </div>
            <div className="flex items-center justify-center gap-6">
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">ETA</div>
                <div className="font-mono text-xl font-medium tracking-tight text-slate-900 dark:text-white">
                  {Math.floor(Math.max(0, planningEta - elapsedMs) / 60000)}:{String(Math.floor((Math.max(0, planningEta - elapsedMs) % 60000) / 1000)).padStart(2, "0")}
                </div>
              </div>
              <div className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Elapsed</div>
                <div className="font-mono text-xl font-medium tracking-tight text-slate-500">
                  {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
                </div>
              </div>
            </div>
            <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {feedback.text}
            </h3>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              The Planning agent is researching the codebase to decompose your quicksprint into grounded, atomic subtasks.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Content ═══ */}
      <div ref={fieldsRef} className="relative z-10">
        {/* ─── BROWSE PHASE ───────────────────────────────────────── */}
        {phase === "browse" && (
          <div className="p-6 sm:p-8 lg:p-10">
            {/* Header */}
            <div data-qs-stagger className="flex items-start justify-between gap-4">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />
                  Quicksprint
                </div>
                <div className="space-y-3">
                  <h2 className="font-display text-[2rem] font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-[2.35rem]">
                    Launch A Quicksprint.
                  </h2>
                  <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
                    Select a template to rapidly bootstrap a new sprint. Built-in audits and your custom flows are ready to go.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] min-w-[44px] h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
                aria-label="Close quicksprint"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Built-in templates */}
                <div data-qs-stagger className="mt-10">
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-5">Built-in Templates</div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {builtinTemplates.map((t) => (
                      <TemplateCard key={t.id} template={t} onSelect={() => handleSelectTemplate(t)} />
                    ))}
                  </div>
                </div>

                {/* Custom templates */}
                <div data-qs-stagger className="mt-10">
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Custom Templates</div>
                    <button
                      onClick={() => openEditor(null)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ember-500/20 bg-ember-500/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ember-600 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-400"
                    >
                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                      New Template
                    </button>
                  </div>

                  {customTemplates.length === 0 ? (
                    <button
                      onClick={() => openEditor(null)}
                      className="w-full rounded-[1.4rem] border border-dashed border-black/[0.08] bg-black/[0.015] p-8 text-center transition-colors hover:border-ember-500/30 hover:bg-ember-500/[0.03] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-ember-500/30"
                    >
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-ember-500/10">
                        <Plus className="h-5 w-5 text-ember-500" />
                      </div>
                      <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Create your first custom template</div>
                      <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">Combine agent presets with custom prompts for reusable sprint flows</div>
                    </button>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {customTemplates.map((t) => (
                        <TemplateCard key={t.id} template={t} onSelect={() => handleSelectTemplate(t)} onEdit={() => openEditor(t)} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── CONFIGURE PHASE ────────────────────────────────────── */}
        {phase === "configure" && selectedTemplate && (
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
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Planning Route</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      variant="compact"
                      value={routeOverride?.id || ""}
                      onChange={(id) => {
                        const opt = routeOptions.find((o) => o.id === id);
                        setRouteOverride(opt || null);
                        if (!opt || opt.type !== "virtual") setModelOverride(null);
                      }}
                      options={[
                        { value: "", label: "Default Route" },
                        ...routeOptions.map((opt) => ({ value: opt.id, label: opt.label })),
                      ]}
                      placeholder="Default Route"
                    />
                  </div>
                </div>

                <div className={`rounded-[1.4rem] border p-4 transition-all ${
                  showModelOverride
                    ? "border-signal-500/20 bg-signal-500/[0.04] dark:bg-signal-500/[0.08]"
                    : "border-black/[0.06] bg-black/[0.025] opacity-40 dark:border-white/[0.06] dark:bg-white/[0.03]"
                }`}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Model Override</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      variant="compact"
                      disabled={!showModelOverride}
                      value={modelOverride || ""}
                      onChange={(val) => setModelOverride(val || null)}
                      options={[
                        { value: "", label: "Default Model" },
                        ...modelOptions.map((opt) => ({ value: opt.value, label: opt.label })),
                      ]}
                      placeholder="Default Model"
                    />
                  </div>
                </div>
              </div>

              {/* Additional prompt for this run */}
              <div data-qs-stagger className="mt-8 space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Additional Instructions (optional)</label>
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
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-4">Subtask Count</div>
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
        )}

        {/* ─── EDITOR PHASE ───────────────────────────────────────── */}
        {phase === "editor" && (
          <div className="p-6 sm:p-8 lg:p-10">
            <div data-qs-stagger className="flex items-center gap-3">
              <button
                onClick={() => setPhase("browse")}
                className="inline-flex min-h-[44px] min-w-[44px] h-8 w-8 items-center justify-center rounded-full border border-black/[0.06] text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
                <Settings2 className="h-3.5 w-3.5" strokeWidth={2.3} />
                {editorTemplate ? "Edit Template" : "New Template"}
              </div>
            </div>

            {/* Name */}
            <label data-qs-stagger className="mt-8 block space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Template Name</span>
              <input
                type="text"
                value={edName}
                onInput={(e) => setEdName((e.target as HTMLInputElement).value)}
                placeholder="API Integration Tests"
                className="w-full border-0 border-b-2 border-black/[0.08] bg-transparent pb-3 font-display text-[1.65rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-200 focus:border-ember-500 dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem]"
                autoFocus
              />
            </label>

            {/* Description */}
            <label data-qs-stagger className="mt-6 block space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Description</span>
              <input
                type="text"
                value={edDescription}
                onInput={(e) => setEdDescription((e.target as HTMLInputElement).value)}
                placeholder="What this template does in one line"
                className="w-full border-0 border-b-2 border-black/[0.06] bg-transparent pb-2 text-sm leading-relaxed text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-ember-500/60 dark:border-white/[0.06] dark:text-slate-300 dark:placeholder:text-slate-600"
              />
            </label>

            {/* Icon + Color + Category Tag + Default Tasks */}
            <div data-qs-stagger className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">Category Tag</div>
                <div className="flex items-center gap-3">
                  {/* Icon picker trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const container = cardRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
                      setPickerPos({ top: rect.bottom - container.top + 8, left: rect.left - container.left });
                      setShowIconPicker(!showIconPicker);
                      setShowColorPicker(false);
                    }}
                    className="flex min-h-[44px] min-w-[44px] h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-black/[0.08] bg-white/80 text-slate-600 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-md hover:border-ember-500/30 hover:text-ember-500 active:scale-95 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-ember-400"
                    title="Pick icon"
                  >
                    {(() => { const Ic = IconMap[edIcon] || Zap; return <Ic className="h-5 w-5" />; })()}
                  </button>

                  {/* Color dot picker trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const container = cardRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
                      setPickerPos({ top: rect.bottom - container.top + 8, left: rect.left - container.left });
                      setShowColorPicker(!showColorPicker);
                      setShowIconPicker(false);
                    }}
                    className="flex min-h-[44px] min-w-[44px] h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-black/[0.08] bg-white/80 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-md active:scale-95 dark:border-white/[0.08] dark:bg-white/[0.05]"
                    title="Pick tag color"
                  >
                    <span
                      className="block h-5 w-5 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),0_0_0_2px_rgba(0,0,0,0.06)] transition-transform duration-200"
                      style={{ backgroundColor: edCategoryColor }}
                    />
                  </button>

                  {/* Category text field */}
                  <input
                    type="text"
                    value={edCategory}
                    onInput={(e) => setEdCategory((e.target as HTMLInputElement).value)}
                    placeholder="e.g. engineering..."
                    className="flex-1 min-w-0 border-0 border-b-2 border-black/[0.06] bg-transparent pb-1 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-ember-500/60 dark:border-white/[0.06] dark:text-slate-300 dark:placeholder:text-slate-600"
                  />
                </div>

                {/* Live preview tag */}
                {edCategory.trim() && (
                  <div className="mt-3 flex items-center">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
                      style={{ backgroundColor: `${edCategoryColor}15`, color: edCategoryColor }}
                    >
                      <span className="block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: edCategoryColor }} />
                      {edCategory}
                    </span>
                  </div>
                )}
              </div>

              <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-2">Default Tasks</div>
                <div className="font-mono text-2xl font-black tracking-tight text-slate-900 dark:text-white">{edTaskCount}</div>
                <input
                  type="range" min="1" max="15" value={edTaskCount}
                  onInput={(e) => setEdTaskCount(parseInt((e.target as HTMLInputElement).value, 10))}
                  className="mt-2 w-full h-1.5 bg-black/[0.06] rounded-full appearance-none cursor-pointer accent-ember-500 dark:bg-white/[0.08]"
                />
              </div>
            </div>

            {/* Picker popups (absolute to section, overflow toggled) */}
            {showIconPicker && (<>
              <div className="fixed inset-0 z-[9998] cursor-default" onClick={() => setShowIconPicker(false)} />
              <div
                className="absolute z-[9999] w-[17rem] rounded-2xl border border-white/[0.08] p-3 shadow-2xl backdrop-blur-2xl bg-[#1a1d24]/95"
                style={{ top: pickerPos.top, left: pickerPos.left, animation: "qs-picker-in 0.2s cubic-bezier(0.22,1,0.36,1)" }}
              >
                <div className="grid grid-cols-6 gap-1">
                  {ICON_OPTIONS.map((opt) => {
                    const isActive = edIcon === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setEdIcon(opt.value); setShowIconPicker(false); }}
                        title={opt.value}
                        className={`flex min-h-[44px] min-w-[44px] h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-all duration-150 ${
                          isActive
                            ? "bg-ember-500/20 text-ember-500 shadow-[0_0_10px_rgba(255,107,0,0.15)] scale-110"
                            : "text-slate-400 hover:bg-white/[0.08] hover:text-white hover:scale-110"
                        }`}
                      >
                        <opt.Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>)}

            {showColorPicker && (<>
              <div className="fixed inset-0 z-[9998] cursor-default" onClick={() => setShowColorPicker(false)} />
              <div
                className="absolute z-[9999] w-52 rounded-2xl border border-white/[0.08] p-3 shadow-2xl backdrop-blur-2xl bg-[#1a1d24]/95"
                style={{ top: pickerPos.top, left: pickerPos.left, animation: "qs-picker-in 0.2s cubic-bezier(0.22,1,0.36,1)" }}
              >
                <div className="grid grid-cols-5 gap-2">
                  {TAG_COLOR_PALETTE.map((color) => {
                    const isActive = color === edCategoryColor;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => { setEdCategoryColor(color); setShowColorPicker(false); }}
                        className="group flex min-h-[44px] min-w-[44px] h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:scale-125 active:scale-95"
                      >
                        <span
                          className="block rounded-full transition-all duration-200"
                          style={{
                            backgroundColor: color,
                            width: isActive ? "1.5rem" : "1.25rem",
                            height: isActive ? "1.5rem" : "1.25rem",
                            boxShadow: isActive
                              ? `inset 0 1px 3px rgba(255,255,255,0.35), 0 0 0 2.5px ${color}44, 0 0 12px ${color}55`
                              : "inset 0 1px 3px rgba(255,255,255,0.35)",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>)}

            {/* Agent Preset */}
            {agentPresets.length > 0 && (
              <div data-qs-stagger className="mt-6">
                <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-2">Agent Preset (optional)</div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                    Attach an agent's instructions to this template. The agent's prompt will be prepended to the template instructions.
                  </p>
                  <AvantgardeSelect
                    variant="compact"
                    value={edAgentPresetId}
                    onChange={(val) => setEdAgentPresetId(val)}
                    options={[
                      { value: "", label: "No Agent" },
                      ...agentPresets.map((p) => ({ value: p.id, label: `${p.name}${p.labels.length ? ` (${p.labels.join(", ")})` : ""}` })),
                    ]}
                    placeholder="No Agent"
                  />
                </div>
              </div>
            )}

            {/* Instructions */}
            <div data-qs-stagger className="mt-6 space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Agent Instructions</span>
              <textarea
                value={edInstruction}
                onInput={(e) => setEdInstruction((e.target as HTMLTextAreaElement).value)}
                placeholder="Write detailed instructions for the planning agent. Leave empty to use only the agent preset's instructions..."
                rows={10}
                className="w-full rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 text-sm font-mono leading-relaxed text-slate-700 outline-none transition-all placeholder:text-slate-300 focus:border-ember-500/40 focus:shadow-[0_0_0_1px_rgba(255,107,0,0.16),0_0_30px_rgba(255,107,0,0.08)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:placeholder:text-slate-600 resize-y"
              />
            </div>

            {/* Footer */}
            <div data-qs-stagger className="mt-8 flex items-center justify-between">
              <div>
                {editorTemplate && !editorTemplate.isBuiltIn && (
                  <button
                    type="button"
                    onClick={handleEditorDelete}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                      edConfirmDelete
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {edConfirmDelete ? "Confirm Delete" : "Delete"}
                  </button>
                )}
              </div>
              <button
                onClick={handleEditorSave}
                disabled={edSaving || (!edName.trim() || (!edInstruction.trim() && !edAgentPresetId))}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[1.35rem] bg-ember-600 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(255,107,0,0.25)] transition-all hover:bg-ember-500 hover:shadow-[0_0_28px_rgba(255,107,0,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {edSaving ? "Saving..." : editorTemplate ? "Save Changes" : "Create Template"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

/* ═════════════════════════════════════════════════════════════════════ */
/*  Template Card                                                       */
/* ═════════════════════════════════════════════════════════════════════ */
const TemplateCard: FunctionComponent<{
  template: QuicksprintTemplateRecord;
  onSelect: () => void;
  onEdit?: () => void;
}> = ({ template, onSelect, onEdit }) => {
  const Icon = IconMap[template.icon] || Zap;
  const tagColor = template.categoryColor || "#94a3b8";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex flex-col rounded-[1.4rem] border border-black/[0.06] bg-white/60 p-5 text-left transition-all hover:border-ember-500/30 hover:shadow-[0_0_24px_rgba(255,107,0,0.08)] dark:border-white/[0.06] dark:bg-white/[0.025] dark:hover:border-ember-500/30"
    >
      {!template.isBuiltIn && onEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute top-4 right-4 rounded-lg min-h-[44px] min-w-[44px] p-1.5 text-slate-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-ember-500/10 hover:text-ember-500 dark:text-slate-500"
          title="Edit template"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ember-500/[0.08] text-ember-500 transition-colors group-hover:bg-ember-500/[0.14]">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <h3 className="flex-1 text-sm font-bold text-slate-900 dark:text-white leading-tight pr-6">{template.name}</h3>
      </div>

      <p className="flex-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400 mb-4">{template.description}</p>

      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] px-2.5 py-0.5 rounded-full"
          style={{ backgroundColor: `${tagColor}15`, color: tagColor }}
        >
          <span className="block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tagColor }} />
          {template.category}
        </span>
        <span className="text-[10px] font-medium text-slate-400">
          {template.defaultTaskCount} subtask{template.defaultTaskCount !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
};

/* ═════════════════════════════════════════════════════════════════════ */
/*  Subtask Count Slider                                                */
/* ═════════════════════════════════════════════════════════════════════ */
const SubtaskSlider: FunctionComponent<{
  value: number;
  onChange: (v: number) => void;
}> = ({ value, onChange }) => {
  const min = 1;
  const max = 15;
  const pct = ((value - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointer = useCallback((e: PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(min + x * (max - min)));
  }, [onChange]);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handlePointer(e);
  }, [handlePointer]);

  return (
    <div className="select-none">
      {/* Large number display */}
      <div className="flex items-baseline gap-2 mb-6">
        <span className="font-mono text-[3.5rem] font-black leading-none tracking-tighter text-slate-900 dark:text-white tabular-nums">
          {String(value).padStart(2, "0")}
        </span>
        <span className="text-sm font-medium text-slate-400">
          subtask{value !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-10 cursor-pointer touch-none"
        onPointerDown={handlePointerDown as any}
        onPointerMove={(e: any) => { if (e.buttons === 1) handlePointer(e); }}
      >
        {/* Background track */}
        <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
          {/* Fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ember-500 to-ember-400 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Notches */}
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex justify-between px-[2px]">
          {Array.from({ length: max - min + 1 }, (_, i) => {
            const n = min + i;
            const isActive = n <= value;
            const isMajor = n === 1 || n === 5 || n === 10 || n === 15;
            return (
              <div
                key={n}
                className={`rounded-full transition-all ${
                  isMajor ? "h-3 w-1" : "h-1.5 w-0.5"
                } ${isActive ? "bg-ember-500/60" : "bg-black/[0.08] dark:bg-white/[0.08]"}`}
              />
            );
          })}
        </div>

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-75"
          style={{ left: `${pct}%` }}
        >
          <div className="relative">
            <div className="h-6 w-6 rounded-full border-[3px] border-ember-500 bg-white shadow-[0_0_12px_rgba(255,107,0,0.3)] dark:bg-void-800" />
            <div className="absolute -inset-2 rounded-full bg-ember-500/10 animate-pulse" style={{ animationDuration: "2s" }} />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="mt-2 flex justify-between text-[10px] font-bold tracking-wider text-slate-300 dark:text-slate-600">
        <span>1</span>
        <span>5</span>
        <span>10</span>
        <span>15</span>
      </div>
    </div>
  );
};
