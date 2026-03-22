import type { ComponentChildren, FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  Cpu,
  ExternalLink,
  Plug,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-preact";
import { fetchExternalSettingsHints } from "../lib/api/dashboard-api.js";
import type { ProjectSettings, SettingsValueSource, SystemSettings, ThinkingMode } from "../types.js";
import { ActionButton, NoticePanel } from "./components/settings/SettingsSurface.js";
import { AvantgardeSelect } from "./components/ui/AvantgardeSelect.js";
import { useProjectData } from "./context/project-data.js";
import {
  fetchProjectEffectiveSettings,
  fetchSystemSettings,
  resetProjectSettings,
  resetSystemDatabase,
  saveProjectSettings,
  saveSystemSettings,
} from "./lib/settings-api.js";
import {
  applyExternalHintsToSystemSettings,
  cloneProjectSettings,
  cloneSystemSettings,
  dashboardSettingsToProjectSettings,
  getFieldSource,
  getFieldSourceLabel,
  getProviderModelOptions,
  PROVIDER_CARD_TOKENS,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
} from "./lib/settings-view-models.js";

type SettingsScope = "system" | "project";
type CategoryId = "general" | "models" | "sprint" | "agents" | "memory" | "integrations" | "danger";
type AgentInstructionTemplateId = keyof ProjectSettings["agents"]["instructionTemplates"];

interface Category {
  id: CategoryId;
  num: string;
  label: string;
  description: string;
  icon: typeof Settings;
  danger?: boolean;
}

const CATEGORIES: Category[] = [
  { id: "general", num: "01", label: "General", icon: SlidersHorizontal, description: "Scope, runtime, and automation posture" },
  { id: "models", num: "02", label: "AI Models", icon: Cpu, description: "Provider routing, models, and weighting" },
  { id: "sprint", num: "03", label: "Sprint Engine", icon: Target, description: "Merge rules, loop control, and execution runtime" },
  { id: "agents", num: "04", label: "Agents", icon: Bot, description: "Project-local markdown mirrors and agent authoring behavior" },
  { id: "memory", num: "05", label: "Memory", icon: BrainCircuit, description: "Embedding models, auto-capture, and promotion policy" },
  { id: "integrations", num: "06", label: "Integrations", icon: Plug, description: "Provider keys, GitHub, and external connection policy" },
  { id: "danger", num: "07", label: "Danger Zone", icon: AlertTriangle, description: "Reset project overrides only when needed", danger: true },
];

const providerLabels: Record<keyof ProjectSettings["aiProvider"]["providers"], string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
};

const thinkingModeOptions: Array<{ value: ThinkingMode; label: string }> = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

type IntegrationId = "jules" | "gemini" | "codex" | "claude-code" | "github";

interface IntegrationDefinition {
  id: IntegrationId;
  label: string;
  description: string;
}

const INTEGRATIONS: IntegrationDefinition[] = [
  { id: "jules", label: "Jules", description: "Primary hosted coding provider and orchestration participant" },
  { id: "gemini", label: "Gemini", description: "Hosted execution provider and future worker endpoint" },
  { id: "codex", label: "Codex", description: "Hosted execution provider and future worker endpoint" },
  { id: "claude-code", label: "Claude Code", description: "Hosted execution provider and future worker endpoint" },
  { id: "github", label: "GitHub", description: "Repository, pull request, branch, and CI integration" },
];

const AGENT_INSTRUCTION_TEMPLATE_OPTIONS: Array<{
  value: AgentInstructionTemplateId;
  label: string;
  description: string;
}> = [
  { value: "planningMissing", label: "Planning Missing", description: "Shown when a sprint has no planned tasks yet." },
  { value: "planningCreated", label: "Planning Created", description: "Shown after a planning request is prepared." },
  { value: "branchMissing", label: "Branch Missing", description: "Shown when the sprint feature branch must be created first." },
  { value: "mergeHeader", label: "Merge Header", description: "Header for merge-required intervention output." },
  { value: "mergeTask", label: "Merge Task", description: "Per-task merge instruction block." },
  { value: "actionRequiredAgentHeader", label: "Agent Attention Header", description: "Header for agent-owned intervention items." },
  { value: "actionRequiredAgentTask", label: "Agent Attention Task", description: "Per-task agent intervention block." },
  { value: "actionRequiredHumanHeader", label: "Human Attention Header", description: "Header for human-owned intervention items." },
  { value: "actionRequiredHumanTask", label: "Human Attention Task", description: "Per-task human intervention block." },
  { value: "watchHeader", label: "Run Header", description: "Top section for live orchestration status output." },
  { value: "watchMergeRequired", label: "Run Merge Required", description: "Shown when orchestration pauses for merges." },
  { value: "watchNoMoreActions", label: "Run No More Actions", description: "Shown when orchestration pauses with nothing runnable." },
  { value: "completionSteps", label: "Completion Steps", description: "Final sprint completion guidance." },
  { value: "cleanupAllMerged", label: "Cleanup All Merged", description: "Shown when cleanup confirms a fully merged sprint." },
  { value: "cleanupFailed", label: "Cleanup Failed", description: "Shown when cleanup is skipped because tasks failed." },
  { value: "cleanupDeferred", label: "Cleanup Deferred", description: "Shown when cleanup waits on merges." },
  { value: "cleanupEmpty", label: "Cleanup Empty", description: "Shown when the sprint is still empty." },
];

const Toggle: FunctionComponent<{
  value: boolean;
  onChange: () => void;
  danger?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, danger, disabled }) => (
  <button
    type="button"
    onClick={onChange}
    disabled={disabled}
    className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-[background-color,box-shadow] duration-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
      value
        ? danger
          ? "bg-status-red shadow-[0_0_12px_rgba(227,0,15,0.35)]"
          : "bg-signal-500 shadow-[0_0_12px_rgba(0,224,160,0.35)]"
        : "bg-black/[0.1] dark:bg-white/[0.1]"
    }`}
  >
    <span
      className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-out ${
        value ? "translate-x-5" : "translate-x-0"
      }`}
    />
  </button>
);

const SelectInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}> = ({ value, onChange, options, disabled }) => (
  <AvantgardeSelect value={value} onChange={onChange} options={options} disabled={disabled} />
);

const ProviderLogo: FunctionComponent<{
  providerId: keyof ProjectSettings["aiProvider"]["providers"];
  disabled?: boolean;
}> = ({ providerId, disabled = false }) => {
  const token = PROVIDER_CARD_TOKENS[providerId];

  return (
    <div
      className={`flex h-11 w-11 items-center justify-center rounded-[1rem] border border-black/[0.08] bg-[#F9F8F4] font-display text-sm font-black tracking-[0.16em] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${disabled ? "opacity-60" : ""}`}
      aria-hidden
    >
      {token.logoLabel}
    </div>
  );
};

const TextInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, placeholder, mono, disabled }) => (
  <input
    type="text"
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
    className={`min-w-[210px] rounded-xl border border-black/[0.06] bg-black/[0.04] px-3 py-2 text-sm text-slate-700 placeholder-slate-400 transition-colors duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-200 ${
      mono ? "font-mono" : "font-sans"
    }`}
  />
);

const TextAreaInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ value, onChange, placeholder, rows = 12 }) => (
  <textarea
    value={value}
    rows={rows}
    placeholder={placeholder}
    onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
    className="min-h-[320px] w-full rounded-[1.3rem] border border-black/[0.06] bg-black/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-700 placeholder-slate-400 transition-colors duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-200"
  />
);

const NumberInput: FunctionComponent<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}> = ({ value, onChange, min, max, step = 1, disabled }) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
    className="w-28 rounded-xl border border-black/[0.06] bg-black/[0.04] px-3 py-2 text-sm font-mono text-slate-700 transition-colors duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-200"
  />
);

const Row: FunctionComponent<{
  label: string;
  description?: string;
  children: ComponentChildren;
  last?: boolean;
  badge?: string;
}> = ({ label, description, children, last, badge }) => (
  <div
    className={`flex items-center justify-between gap-6 py-4.5 ${!last ? "border-b border-black/[0.05] dark:border-white/[0.04]" : ""}`}
    style={{ paddingTop: "1.125rem", paddingBottom: "1.125rem" }}
  >
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">{label}</div>
        {badge ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
              !
            </span>
            {badge}
          </span>
        ) : null}
      </div>
      {description ? (
        <div className="mt-0.5 text-xs font-medium leading-relaxed text-slate-400">{description}</div>
      ) : null}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const SectionCard: FunctionComponent<{
  title: string;
  watermark: string;
  children: ComponentChildren;
  danger?: boolean;
  badge?: string;
}> = ({ title, watermark, children, danger, badge }) => (
  <div className="relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div
      aria-hidden
      className={`pointer-events-none absolute -bottom-6 -right-4 select-none font-display text-[7rem] font-black leading-none tracking-tighter ${
        danger ? "text-status-red/[0.04]" : "text-black/[0.025] dark:text-white/[0.02]"
      }`}
    >
      {watermark}
    </div>

    <div className={`flex items-center justify-between gap-3 border-b border-black/[0.05] px-7 py-5 dark:border-white/[0.04] ${danger ? "bg-status-red/[0.03]" : ""}`}>
      <h3 className={`text-[11px] font-bold uppercase tracking-[0.18em] ${danger ? "text-status-red/70" : "text-slate-400 dark:text-slate-500"}`}>
        {title}
      </h3>
      {badge ? (
        <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">
          {badge}
        </span>
      ) : null}
    </div>

    <div className="relative z-10 px-7 py-6">
      {children}
    </div>
  </div>
);


const IntegrationConfigRow: FunctionComponent<{
  label: string;
  description: string;
  connected: boolean;
  active: boolean;
  onConfigure: () => void;
  last?: boolean;
}> = ({ label, description, connected, active, onConfigure, last }) => (
  <div
    className={`flex items-center justify-between gap-6 py-4.5 ${!last ? "border-b border-black/[0.05] dark:border-white/[0.04]" : ""}`}
    style={{ paddingTop: "1.125rem", paddingBottom: "1.125rem" }}
  >
    <div className="flex items-center gap-3">
      <div className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)]" : "bg-slate-300 dark:bg-slate-600"}`} />
      <div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
        <div className="mt-0.5 text-xs font-medium text-slate-400">{description}</div>
      </div>
    </div>
    <button
      type="button"
      onClick={onConfigure}
      className={`flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-200 ${
        active
          ? "text-signal-600 dark:text-signal-300"
          : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      }`}
    >
      <ExternalLink className="h-3 w-3" strokeWidth={2} />
      Configure
    </button>
  </div>
);

const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => (
  <SectionCard title="Project Context" watermark="PRJ">
    <Row label="Project" description="The selected project receives its own override document and inherits all other values from system defaults.">
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
        {projectName}
      </div>
    </Row>
    <Row label="Project id" description="Stable identifier used by the API and runtime." >
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {projectId}
      </div>
    </Row>
    <Row label="Base directory" description="Workers and local execution enter this directory before acting." >
      <div className="max-w-[28rem] rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {baseDir}
      </div>
    </Row>
    <Row label="Source type" description="This affects how the project was provisioned, not the settings inheritance model." last>
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {sourceType}
      </div>
    </Row>
  </SectionCard>
);

const sourceLabel = (source: SettingsValueSource | "mixed"): string => {
  switch (source) {
    case "project":
      return "Project override";
    case "sprint":
      return "Sprint override";
    case "mixed":
      return "Mixed sources";
    case "system":
    default:
      return "Inherited";
  }
};

const getCombinedSource = (
  sources: Record<string, SettingsValueSource>,
  prefixes: string[],
): SettingsValueSource | "mixed" => {
  const hits = Object.entries(sources)
    .filter(([key]) => prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)))
    .map(([, source]) => source);

  if (hits.length === 0) {
    return "system";
  }

  const uniqueSources = new Set(hits);
  if (uniqueSources.size === 1) {
    return hits[0]!;
  }
  return "mixed";
};

const updateProviderSettings = (
  settings: ProjectSettings,
  providerId: keyof ProjectSettings["aiProvider"]["providers"],
  patch: Partial<ProjectSettings["aiProvider"]["providers"][keyof ProjectSettings["aiProvider"]["providers"]]>,
): ProjectSettings => ({
  ...settings,
  aiProvider: {
    ...settings.aiProvider,
    providers: {
      ...settings.aiProvider.providers,
      [providerId]: {
        ...settings.aiProvider.providers[providerId],
        ...patch,
      },
    },
  },
});

export const SettingsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { deleteProject, selectedProject, selectedProjectId } = useProjectData();

  // Tracks whether user has unsaved edits. Used as a guard in loadSettings so that
  // background realtime refreshes cannot clobber in-progress user changes.
  const isDirtyRef = useRef(false);

  const [activeCategory, setActiveCategory] = useState<CategoryId>("general");
  const [activeScope, setActiveScope] = useState<SettingsScope>("system");
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationId>("github");
  const [selectedAgentTemplate, setSelectedAgentTemplate] = useState<AgentInstructionTemplateId>("planningMissing");
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [savedSystemSettings, setSavedSystemSettings] = useState<SystemSettings | null>(null);
  const [projectSettings, setProjectSettings] = useState<ProjectSettings | null>(null);
  const [savedProjectSettings, setSavedProjectSettings] = useState<ProjectSettings | null>(null);
  const [projectSources, setProjectSources] = useState<Record<string, SettingsValueSource>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingSystem, setSavingSystem] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [resettingProject, setResettingProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [resettingDatabase, setResettingDatabase] = useState(false);
  const [importingHints, setImportingHints] = useState(false);

  useLayoutEffect(() => {
    if (!headerRef.current) {
      return;
    }
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, stagger: 0.09, duration: 0.9, ease: "power4.out", delay: 0.05 },
    );
  }, []);

  const loadSettings = useCallback(async (): Promise<void> => {
    // Do not overwrite in-progress user edits with a background refresh.
    if (isDirtyRef.current) {
      return;
    }
    setLoading(true);
    try {
      const nextSystem = await fetchSystemSettings();
      setSystemSettings(cloneSystemSettings(nextSystem));
      setSavedSystemSettings(cloneSystemSettings(nextSystem));

      if (selectedProjectId) {
        const effectiveProject = await fetchProjectEffectiveSettings(selectedProjectId);
        const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
        setProjectSettings(cloneProjectSettings(nextProject));
        setSavedProjectSettings(cloneProjectSettings(nextProject));
        setProjectSources(effectiveProject.sources);
      } else {
        setProjectSettings(null);
        setSavedProjectSettings(null);
        setProjectSources({});
      }

      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  // Depend on the stable project ID string, not the selectedProject object reference.
  // The project-data context recreates selectedProject on every realtime broadcast even
  // when the selected project has not actually changed, which previously caused this
  // callback to get a new reference → useEffect re-ran → settings reloaded → edits lost.
  }, [selectedProjectId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!selectedProject && activeScope === "project") {
      setActiveScope("system");
    }
  }, [activeScope, selectedProject]);

  useEffect(() => {
    if (!saveMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => setSaveMessage(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [saveMessage]);

  const systemDirty = useMemo(() => (
    systemSettings && savedSystemSettings
      ? JSON.stringify(systemSettings) !== JSON.stringify(savedSystemSettings)
      : false
  ), [savedSystemSettings, systemSettings]);

  const projectDirty = useMemo(() => (
    projectSettings && savedProjectSettings
      ? JSON.stringify(projectSettings) !== JSON.stringify(savedProjectSettings)
      : false
  ), [projectSettings, savedProjectSettings]);

  // Keep isDirtyRef in sync so the loadSettings guard always reflects current edit state.
  useEffect(() => {
    isDirtyRef.current = systemDirty || projectDirty;
  }, [systemDirty, projectDirty]);

  const editableSettings = activeScope === "system" ? systemSettings?.defaults ?? null : projectSettings;
  const activeCategoryConfig = CATEGORIES.find((category) => category.id === activeCategory) ?? CATEGORIES[0];

  const switchCategory = (categoryId: CategoryId): void => {
    if (!contentRef.current || categoryId === activeCategory) {
      return;
    }
    gsap.to(contentRef.current, {
      opacity: 0,
      y: 12,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => {
        setActiveCategory(categoryId);
        if (!contentRef.current) {
          return;
        }
        gsap.fromTo(
          contentRef.current,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" },
        );
      },
    });
  };

  const updateSystem = (recipe: (current: SystemSettings) => SystemSettings): void => {
    setSystemSettings((current) => (current ? recipe(current) : current));
  };

  const updateProject = (recipe: (current: ProjectSettings) => ProjectSettings): void => {
    setProjectSettings((current) => (current ? recipe(current) : current));
  };

  const updateEditableSettings = (recipe: (current: ProjectSettings) => ProjectSettings): void => {
    if (activeScope === "system") {
      updateSystem((current) => ({ ...current, defaults: recipe(current.defaults) }));
      return;
    }
    updateProject(recipe);
  };

  const handleImportHints = async (): Promise<void> => {
    if (!systemSettings) {
      return;
    }
    setImportingHints(true);
    try {
      const hints = await fetchExternalSettingsHints();
      const nextSettings = applyExternalHintsToSystemSettings(systemSettings, hints);
      setSystemSettings(nextSettings);
      setSaveMessage("Imported missing integration secrets from env/settings.json.");
      setError(null);
    } catch (hintError) {
      setError(hintError instanceof Error ? hintError.message : String(hintError));
    } finally {
      setImportingHints(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (activeScope === "system") {
      if (!systemSettings) {
        return;
      }
      setSavingSystem(true);
      try {
        const saved = await saveSystemSettings(systemSettings);
        setSystemSettings(cloneSystemSettings(saved));
        setSavedSystemSettings(cloneSystemSettings(saved));

        if (selectedProject) {
          const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
          const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
          setProjectSettings(cloneProjectSettings(nextProject));
          setSavedProjectSettings(cloneProjectSettings(nextProject));
          setProjectSources(effectiveProject.sources);
        }

        setError(null);
        setSaveMessage("System settings saved.");
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setSavingSystem(false);
      }
      return;
    }

    if (!selectedProject || !projectSettings) {
      return;
    }

    setSavingProject(true);
    try {
      await saveProjectSettings(selectedProject.id, projectSettings);
      const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
      const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
      setProjectSettings(cloneProjectSettings(nextProject));
      setSavedProjectSettings(cloneProjectSettings(nextProject));
      setProjectSources(effectiveProject.sources);
      setError(null);
      setSaveMessage(`Project settings saved for ${selectedProject.name}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingProject(false);
    }
  };

  const handleResetProject = async (): Promise<void> => {
    if (!selectedProject) {
      return;
    }
    setResettingProject(true);
    try {
      await resetProjectSettings(selectedProject.id);
      const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
      const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
      setProjectSettings(cloneProjectSettings(nextProject));
      setSavedProjectSettings(cloneProjectSettings(nextProject));
      setProjectSources(effectiveProject.sources);
      setError(null);
      setSaveMessage(`Project overrides reset for ${selectedProject.name}.`);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setResettingProject(false);
    }
  };

  const handleDeleteProject = async (): Promise<void> => {
    if (!selectedProject) {
      return;
    }
    if (!window.confirm(`Delete project "${selectedProject.name}" and all of its sprints, tasks, chats, and runtime records?`)) {
      return;
    }

    setDeletingProject(true);
    try {
      await deleteProject(selectedProject.id);
      setActiveScope("system");
      setActiveCategory("general");
      setSaveMessage(`Project ${selectedProject.name} deleted.`);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingProject(false);
    }
  };

  const handleResetDatabase = async (): Promise<void> => {
    if (!window.confirm("Reset the full database and scoped settings back to a clean development state? This deletes all projects, sprints, tasks, runtime state, chats, and saved settings.")) {
      return;
    }

    setResettingDatabase(true);
    try {
      await resetSystemDatabase();
      setActiveScope("system");
      setActiveCategory("general");
      await loadSettings();
      setSaveMessage("Database reset to a clean state.");
      setError(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setResettingDatabase(false);
    }
  };

  const activeDirty = activeScope === "system" ? systemDirty : projectDirty;
  const activeSaving = activeScope === "system" ? savingSystem : savingProject;

  const getBadge = (...prefixes: string[]): string | undefined => {
    if (activeScope !== "project") {
      return undefined;
    }
    return sourceLabel(getCombinedSource(projectSources, prefixes));
  };

  const getFieldBadge = (path: string): string | undefined => {
    if (activeScope !== "project") {
      return undefined;
    }
    return getFieldSourceLabel(getFieldSource(projectSources, path), "project") ?? undefined;
  };

  const renderGeneralSection = (): ComponentChildren => {
    if (activeScope === "system") {
      return (
        <div className="flex flex-col gap-5">
          <SectionCard title="System Runtime" watermark="SYS">
            <Row label="Dashboard port" description="System-wide HTTP port for the dashboard server.">
              <NumberInput
                value={systemSettings?.runtime.dashboardPort ?? 4444}
                onChange={(value) => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    dashboardPort: value,
                  },
                }))}
                min={1}
                max={65535}
              />
            </Row>
            <Row label="Debug log file" description="Write extra runtime diagnostics to disk for development and incident analysis." last>
              <Toggle
                value={systemSettings?.runtime.enableDebugLogFile ?? false}
                onChange={() => updateSystem((current) => ({
                  ...current,
                  runtime: {
                    ...current.runtime,
                    enableDebugLogFile: !current.runtime.enableDebugLogFile,
                  },
                }))}
              />
            </Row>
          </SectionCard>

          <SectionCard title="Inheritance Model" watermark="SCP">
            <NoticePanel title="Scope order" tone="success">
              System settings provide the live baseline. Project settings inherit from that baseline and only persist real overrides. Sprint overrides layer on top from the sprint page.
            </NoticePanel>
            <Row label="Selected project" description="Project-specific overrides are edited in the same page by switching scope.">
              <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
                {selectedProject ? selectedProject.name : "No project selected"}
              </div>
            </Row>
            <Row label="Project inheritance" description="System defaults stay live until a project explicitly overrides a field." last>
              <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">
                Live inheritance
              </div>
            </Row>
          </SectionCard>
        </div>
      );
    }

    if (!selectedProject || !projectSettings) {
      return (
        <NoticePanel title="Project scope unavailable">
          Select a project first to edit inheritable project settings.
        </NoticePanel>
      );
    }

    return (
      <div className="flex flex-col gap-5">
        <ProjectContextCard
          projectName={selectedProject.name}
          projectId={selectedProject.id}
          baseDir={selectedProject.baseDir}
          sourceType={selectedProject.sourceType}
        />

        <SectionCard title="Automation" watermark="AUTO" badge={getBadge("automationLevel", "automationInterventions")}>
          <Row label="Automation level" description="Choose how much the project should proceed without a worker stepping in." badge={getFieldBadge("automationLevel")}>
            <SelectInput
              value={projectSettings.automationLevel}
              onChange={(value) => updateProject((current) => ({ ...current, automationLevel: value as ProjectSettings["automationLevel"] }))}
              options={[
                { value: "FULL", label: "Full" },
                { value: "SEMI_AUTO", label: "Semi-auto" },
                { value: "ALWAYS_ASK", label: "Always ask" },
              ]}
            />
          </Row>
          <Row label="Auto-approve plans" description="Use the orchestrator path for routine plan confirmations." badge={getFieldBadge("automationInterventions.autoApprovePlan")}>
            <Toggle
              value={projectSettings.automationInterventions.autoApprovePlan}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoApprovePlan: !current.automationInterventions.autoApprovePlan,
                },
              }))}
            />
          </Row>
          <Row label="Auto-answer clarifications" description="Answer routine clarification requests automatically when the configured template is sufficient." badge={getFieldBadge("automationInterventions.autoAnswerClarification")}>
            <Toggle
              value={projectSettings.automationInterventions.autoAnswerClarification}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoAnswerClarification: !current.automationInterventions.autoAnswerClarification,
                },
              }))}
            />
          </Row>
          {projectSettings.automationInterventions.autoAnswerClarification && (
            <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getFieldBadge("automationInterventions.autoAnswerClarificationMode")}>
              <div className="flex gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.04]">
                <button
                  onClick={() => updateProject((current) => ({
                    ...current,
                    automationInterventions: { ...current.automationInterventions, autoAnswerClarificationMode: "TEMPLATE" },
                  }))}
                  className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                    projectSettings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE"
                      ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                      : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  Template
                </button>
                <button
                  onClick={() => updateProject((current) => ({
                    ...current,
                    automationInterventions: { ...current.automationInterventions, autoAnswerClarificationMode: "WORKER" },
                  }))}
                  className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                    projectSettings.automationInterventions.autoAnswerClarificationMode === "WORKER"
                      ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                      : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  Worker
                </button>
              </div>
            </Row>
          )}
          {(!projectSettings.automationInterventions.autoAnswerClarification || projectSettings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") && (
            <Row label="Clarification answer template" description="Template used when project automation answers a clarification request." badge={getFieldBadge("automationInterventions.clarificationAnswerTemplate")}>
              <TextInput
                value={projectSettings.automationInterventions.clarificationAnswerTemplate}
                onChange={(value) => updateProject((current) => ({
                  ...current,
                  automationInterventions: {
                    ...current.automationInterventions,
                    clarificationAnswerTemplate: value,
                  },
                }))}
                placeholder="Respond with the usual clarification template..."
              />
            </Row>
          )}
          <Row label="Auto-resume paused runs" description="Resume a project automatically when a transient pause clears." badge={getFieldBadge("automationInterventions.autoResumePaused")} last>
            <Toggle
              value={projectSettings.automationInterventions.autoResumePaused}
              onChange={() => updateProject((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoResumePaused: !current.automationInterventions.autoResumePaused,
                },
              }))}
            />
          </Row>
        </SectionCard>
      </div>
    );
  };

  const renderModelsSection = (): ComponentChildren => {
    if (!editableSettings) {
      return null;
    }

    const dockerExecutionEnabled = editableSettings.cliWorkflow.executionMode === "DOCKER";
    const virtualWorkerModeEnabled = editableSettings.workers.executionMode === "VIRTUAL";
    const connectedState = systemSettings ? {
      jules: Boolean(systemSettings.integrations.julesApiKey.trim()),
      gemini: Boolean(systemSettings.integrations.geminiApiKey.trim() || editableSettings.cliWorkflow.containerMountGeminiAuth),
      codex: Boolean(systemSettings.integrations.codexApiKey.trim() || editableSettings.cliWorkflow.containerMountCodexAuth),
      "claude-code": Boolean(systemSettings.integrations.claudeCodeApiKey.trim() || editableSettings.cliWorkflow.containerMountClaudeCodeAuth),
    } : null;

    const getProviderAuthLabel = (
      providerId: keyof ProjectSettings["aiProvider"]["providers"],
    ): string | null => {
      if (!systemSettings) {
        return null;
      }

      if (providerId === "jules") {
        return systemSettings.integrations.julesApiKey.trim() ? "API key" : null;
      }

      const apiKeyPresent = providerId === "gemini"
        ? Boolean(systemSettings.integrations.geminiApiKey.trim())
        : providerId === "codex"
          ? Boolean(systemSettings.integrations.codexApiKey.trim())
          : Boolean(systemSettings.integrations.claudeCodeApiKey.trim());

      const localAuthEnabled = dockerExecutionEnabled && (
        providerId === "gemini"
          ? editableSettings.cliWorkflow.containerMountGeminiAuth
          : providerId === "codex"
            ? editableSettings.cliWorkflow.containerMountCodexAuth
            : editableSettings.cliWorkflow.containerMountClaudeCodeAuth
      );

      if (localAuthEnabled && apiKeyPresent) {
        return "Local auth + API key";
      }
      if (localAuthEnabled) {
        return "Local auth";
      }
      if (apiKeyPresent) {
        return "API key";
      }
      return null;
    };

    const visibleProviders = Object.entries(editableSettings.aiProvider.providers).filter(([providerId]) => (
      connectedState ? connectedState[providerId as keyof typeof connectedState] : true
    ));

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Worker Runtime" watermark="WRK" badge={getBadge("workers")}>
          <Row label="Worker execution mode" description="Choose whether worker-owned dispatches and supervision run through connected MCP listeners or a short-lived internal virtual worker." badge={getFieldBadge("workers.executionMode")}>
            <SelectInput
              value={editableSettings.workers.executionMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  executionMode: value as ProjectSettings["workers"]["executionMode"],
                },
              }))}
              options={[
                { value: "CONNECTED_MCP", label: "Connected MCP" },
                { value: "VIRTUAL", label: "Virtual on-demand" },
              ]}
            />
          </Row>
          {virtualWorkerModeEnabled ? (
            <>
              <Row label="Virtual worker CLI" description="Preferred CLI provider for virtual workers. They start only when worker work exists, handle one cycle, then shut down. Jules is intentionally excluded." badge={getFieldBadge("workers.virtualWorkerProvider")}>
                <SelectInput
                  value={editableSettings.workers.virtualWorkerProvider}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    workers: {
                      ...current.workers,
                      virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                      model: "default",
                    },
                  }))}
                  options={[
                    { value: "gemini", label: "Gemini" },
                    { value: "codex", label: "Codex" },
                    { value: "claude-code", label: "Claude Code" },
                  ]}
                />
              </Row>
              <Row label="Worker model" description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used." badge={getFieldBadge("workers.model")}>
                <SelectInput
                  value={editableSettings.workers.model || "default"}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    workers: {
                      ...current.workers,
                      model: value,
                    },
                  }))}
                  options={[
                    { value: "default", label: `Default (${editableSettings.aiProvider.providers[editableSettings.workers.virtualWorkerProvider].model})` },
                    ...getProviderModelOptions(editableSettings.workers.virtualWorkerProvider),
                  ]}
                />
              </Row>
            </>
          ) : null}
          <Row label="Max concurrency" description="Maximum number of parallel tasks a worker can handle simultaneously." badge={getFieldBadge("workers.maxConcurrency")}>
            <NumberInput
              value={editableSettings.workers.maxConcurrency}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  maxConcurrency: value,
                },
              }))}
              min={1}
              max={20}
            />
          </Row>
          <Row label="Dispatch timeout" description="Seconds to wait for a worker to finish a single task dispatch before timing out." badge={getFieldBadge("workers.timeoutSeconds")} last>
            <NumberInput
              value={editableSettings.workers.timeoutSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  timeoutSeconds: value,
                },
              }))}
              min={60}
              max={3600}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Provider Routing" watermark="MDL" badge={getBadge("aiProvider")}>
          <Row label="Routing strategy" description="Manual pins one provider, weighted distributes tasks, orchestrator can decide at runtime." badge={getFieldBadge("aiProvider.strategy")} last={editableSettings.aiProvider.strategy !== "MANUAL"}>
            <SelectInput
              value={editableSettings.aiProvider.strategy}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                aiProvider: {
                  ...current.aiProvider,
                  strategy: value as ProjectSettings["aiProvider"]["strategy"],
                },
              }))}
              options={[
                { value: "MANUAL", label: "Manual" },
                { value: "WEIGHTED", label: "Weighted" },
                { value: "ORCHESTRATOR", label: "Orchestrator" },
              ]}
            />
          </Row>
          {editableSettings.aiProvider.strategy === "MANUAL" ? (
            <Row label="Primary provider" description="Default provider when routing strategy is manual." badge={getFieldBadge("aiProvider.provider")} last>
              <SelectInput
                value={editableSettings.aiProvider.provider}
                onChange={(value) => updateEditableSettings((current) => ({
                  ...current,
                  aiProvider: {
                    ...current.aiProvider,
                    provider: value as ProjectSettings["aiProvider"]["provider"],
                  },
                }))}
                options={[
                  { value: "jules", label: "Jules" },
                  { value: "gemini", label: "Gemini" },
                  { value: "codex", label: "Codex" },
                  { value: "claude-code", label: "Claude Code" },
                ]}
              />
            </Row>
          ) : null}
          <div className="mt-6">
            {visibleProviders.length === 0 ? (
              <NoticePanel title="No available providers">
                Configure a provider in Integrations first. The provider pool only shows backends that are currently available from system credentials or Docker auth mounts.
              </NoticePanel>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {visibleProviders.map(([providerId, provider]) => {
                  const providerKey = providerId as keyof ProjectSettings["aiProvider"]["providers"];
                  const supportsModelSelection = providerSupportsModelSelection(providerKey);
                  const supportsThinkingMode = providerSupportsThinkingMode(providerKey);
                  const modelOptions = getProviderModelOptions(providerKey);
                  const cardTokens = PROVIDER_CARD_TOKENS[providerKey];
                  const authLabel = getProviderAuthLabel(providerKey);

                  return (
                  <div
                    key={providerId}
                    className={`group relative overflow-hidden rounded-[1.6rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/65 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] ${provider.enabled ? "" : "opacity-60"}`}
                  >
                    <div aria-hidden className={`pointer-events-none absolute inset-0 ${cardTokens.glowClassName}`} />
                    <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full ${cardTokens.railClassName}`} />
                    <div aria-hidden className="pointer-events-none absolute -right-2 -top-3 select-none font-display text-[4.75rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.03]">
                      {cardTokens.watermark}
                    </div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="relative z-10 flex items-start gap-3">
                        <ProviderLogo providerId={providerKey} disabled={!provider.enabled} />
                        <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${cardTokens.badgeClassName}`}>
                            {cardTokens.badgeLabel}
                          </span>
                          {authLabel ? (
                            <span className="inline-flex items-center rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                              {authLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {providerLabels[providerId as keyof typeof providerLabels]}
                          </div>
                          {getFieldBadge(`aiProvider.providers.${providerId}.enabled`) ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                !
                              </span>
                              {getFieldBadge(`aiProvider.providers.${providerId}.enabled`)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                          {providerId === "jules"
                            ? "Enabled state and routing weight. Jules follows API-managed defaults for model behavior."
                            : "Enabled state, pinned model, weighting, and thinking mode."}
                        </div>
                        </div>
                      </div>
                      <Toggle
                        value={provider.enabled}
                        onChange={() => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                          enabled: !provider.enabled,
                        }))}
                      />
                    </div>
                    {!supportsModelSelection || !supportsThinkingMode ? (
                      <div className={`relative z-10 mb-3 rounded-2xl border px-4 py-3 text-xs font-medium leading-relaxed ${cardTokens.noteClassName}`}>
                        Jules API currently does not expose model selection or thinking controls, so this provider uses Jules-managed defaults.
                      </div>
                    ) : null}
                    <div className={`relative z-10 grid gap-3 ${supportsModelSelection && supportsThinkingMode ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                      {supportsModelSelection ? (
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <span>Model</span>
                          {getFieldBadge(`aiProvider.providers.${providerId}.model`) ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                !
                              </span>
                              {getFieldBadge(`aiProvider.providers.${providerId}.model`)}
                            </span>
                          ) : null}
                        </div>
                        {modelOptions.length > 0 ? (
                          <SelectInput
                            value={provider.model}
                            onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                              model: value,
                            }))}
                            options={modelOptions}
                          />
                        ) : (
                          <TextInput
                            value={provider.model}
                            onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                              model: value,
                            }))}
                            mono
                          />
                        )}
                      </div>
                      ) : null}
                      {supportsThinkingMode ? (
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <span>Thinking mode</span>
                          {getFieldBadge(`aiProvider.providers.${providerId}.thinkingMode`) ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                !
                              </span>
                              {getFieldBadge(`aiProvider.providers.${providerId}.thinkingMode`)}
                            </span>
                          ) : null}
                        </div>
                        <SelectInput
                          value={provider.thinkingMode}
                          onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                            thinkingMode: value as ThinkingMode,
                          }))}
                          options={thinkingModeOptions}
                        />
                      </div>
                      ) : null}
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <span>Weight</span>
                          {getFieldBadge(`aiProvider.providers.${providerId}.weight`) ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                !
                              </span>
                              {getFieldBadge(`aiProvider.providers.${providerId}.weight`)}
                            </span>
                          ) : null}
                        </div>
                        <NumberInput
                          value={provider.weight}
                          onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                            weight: value,
                          }))}
                          min={0}
                          max={100}
                        />
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </SectionCard>

      </div>
    );
  };

  const renderSprintSection = (): ComponentChildren => {
    if (!editableSettings) {
      return null;
    }

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Merge Gates" watermark="CI" badge={getBadge("ciIntelligence")}>
          <Row label="CI intelligence enabled" description="Let orchestration react to CI state instead of treating CI as passive metadata." badge={getFieldBadge("ciIntelligence.enabled")}>
            <Toggle
              value={editableSettings.ciIntelligence.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  enabled: !current.ciIntelligence.enabled,
                },
              }))}
            />
          </Row>
          <Row label="Live PR monitoring" description="Poll and interpret PR state while feature work is in progress." badge={getFieldBadge("ciIntelligence.enableLivePrMonitoring")}>
            <Toggle
              value={editableSettings.ciIntelligence.enableLivePrMonitoring}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  enableLivePrMonitoring: !current.ciIntelligence.enableLivePrMonitoring,
                },
              }))}
            />
          </Row>
          <Row label="Wait for CI before main merge" description="Hold main-branch merge completion until CI is green." badge={getFieldBadge("ciIntelligence.waitForCiBeforeMainMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.waitForCiBeforeMainMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForCiBeforeMainMerge: !current.ciIntelligence.waitForCiBeforeMainMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve comments before main merge" description="Require review comments to be resolved before finishing the main merge." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeMainMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveAllCommentsBeforeMainMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveAllCommentsBeforeMainMerge: !current.ciIntelligence.resolveAllCommentsBeforeMainMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve main merge conflicts" description="Escalate `feature -> main` merge conflicts to the connected worker with sprint context." badge={getFieldBadge("ciIntelligence.resolveMainMergeConflicts")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveMainMergeConflicts}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveMainMergeConflicts: !current.ciIntelligence.resolveMainMergeConflicts,
                },
              }))}
            />
          </Row>
          <Row label="Wait for CI before feature merge" description="Require green CI before merging feature branches back into sprint or main flow." badge={getFieldBadge("ciIntelligence.waitForCiBeforeFeatureMerge")}>
            <Toggle
              value={editableSettings.ciIntelligence.waitForCiBeforeFeatureMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForCiBeforeFeatureMerge: !current.ciIntelligence.waitForCiBeforeFeatureMerge,
                },
              }))}
            />
          </Row>
          <Row label="Resolve comments before feature merge" description="Do not auto-merge a feature branch until review comments are closed." badge={getFieldBadge("ciIntelligence.resolveAllCommentsBeforeFeatureMerge")} last>
            <Toggle
              value={editableSettings.ciIntelligence.resolveAllCommentsBeforeFeatureMerge}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveAllCommentsBeforeFeatureMerge: !current.ciIntelligence.resolveAllCommentsBeforeFeatureMerge,
                },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Autofix Policy" watermark="FIX" badge={getBadge("ciIntelligence")}>
          <Row label="Resolve feature merge conflicts" description="Escalate feature-branch merge conflicts to the connected worker with full branch and task context." badge={getFieldBadge("ciIntelligence.resolveMergeConflicts")}>
            <Toggle
              value={editableSettings.ciIntelligence.resolveMergeConflicts}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  resolveMergeConflicts: !current.ciIntelligence.resolveMergeConflicts,
                },
              }))}
            />
          </Row>
          <Row label="Jules CI autofix" description="Allow Jules to attempt CI autofixes before escalating to a worker." badge={getFieldBadge("ciIntelligence.waitForJulesCiAutofix")}>
            <Toggle
              value={editableSettings.ciIntelligence.waitForJulesCiAutofix}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  waitForJulesCiAutofix: !current.ciIntelligence.waitForJulesCiAutofix,
                },
              }))}
            />
          </Row>
          <Row label="Autofix retries" description="Maximum retries for the Jules CI autofix path." badge={getFieldBadge("ciIntelligence.julesCiAutofixMaxRetries")}>
            <NumberInput
              value={editableSettings.ciIntelligence.julesCiAutofixMaxRetries}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  julesCiAutofixMaxRetries: value,
                },
              }))}
              min={0}
              max={20}
            />
          </Row>
          <Row label="Feature PR auto-merge mode" description="Controls whether feature PRs auto-merge immediately, only when green, or never." badge={getFieldBadge("ciIntelligence.featurePrAutoMergeMode")}>
            <SelectInput
              value={editableSettings.ciIntelligence.featurePrAutoMergeMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  featurePrAutoMergeMode: value as ProjectSettings["ciIntelligence"]["featurePrAutoMergeMode"],
                },
              }))}
              options={[
                { value: "OFF", label: "Off" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
          <Row label="Main branch auto-merge mode" description="Controls whether the main branch PR auto-merges immediately, only when green, or never." badge={getFieldBadge("ciIntelligence.mainBranchAutoMergeMode")} last>
            <SelectInput
              value={editableSettings.ciIntelligence.mainBranchAutoMergeMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                ciIntelligence: {
                  ...current.ciIntelligence,
                  mainBranchAutoMergeMode: value as ProjectSettings["ciIntelligence"]["mainBranchAutoMergeMode"],
                },
              }))}
              options={[
                { value: "OFF", label: "Off" },
                { value: "WHEN_GREEN", label: "When green" },
                { value: "ALWAYS", label: "Always" },
              ]}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Execution Pipeline" watermark="RUN" badge={getBadge("sprintLoopSteps")}>
          <Row label="Branch preflight" description="Verify branch state before the orchestration loop starts." badge={getFieldBadge("sprintLoopSteps.branchPreflight")}>
            <Toggle value={editableSettings.sprintLoopSteps.branchPreflight} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                branchPreflight: !current.sprintLoopSteps.branchPreflight,
              },
            }))} />
          </Row>
          <Row label="Planning preflight" description="Validate the planning phase before worker or automated execution begins." badge={getFieldBadge("sprintLoopSteps.planningPreflight")}>
            <Toggle value={editableSettings.sprintLoopSteps.planningPreflight} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                planningPreflight: !current.sprintLoopSteps.planningPreflight,
              },
            }))} />
          </Row>
          <Row label="Session sync" description="Keep provider session state synchronized into the orchestration model." badge={getFieldBadge("sprintLoopSteps.sessionSync")}>
            <Toggle value={editableSettings.sprintLoopSteps.sessionSync} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                sessionSync: !current.sprintLoopSteps.sessionSync,
              },
            }))} />
          </Row>
          <Row label="Load subtasks" description="Refresh task state from persisted sprint records before orchestration decisions are made." badge={getFieldBadge("sprintLoopSteps.loadSubtasks")}>
            <Toggle value={editableSettings.sprintLoopSteps.loadSubtasks} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                loadSubtasks: !current.sprintLoopSteps.loadSubtasks,
              },
            }))} />
          </Row>
          <Row label="Status derivation" description="Derive task runtime status from session, merge, and CI state during each loop." badge={getFieldBadge("sprintLoopSteps.statusDerivation")}>
            <Toggle value={editableSettings.sprintLoopSteps.statusDerivation} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                statusDerivation: !current.sprintLoopSteps.statusDerivation,
              },
            }))} />
          </Row>
          <Row label="Start ready tasks" description="Dispatch work automatically once dependency and merge gates are clear." badge={getFieldBadge("sprintLoopSteps.startReadyTasks")}>
            <Toggle value={editableSettings.sprintLoopSteps.startReadyTasks} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                startReadyTasks: !current.sprintLoopSteps.startReadyTasks,
              },
            }))} />
          </Row>
          <Row label="Merge protocol" description="Run merge-state checks and PR integration logic as part of each loop." badge={getFieldBadge("sprintLoopSteps.mergeProtocol")}>
            <Toggle value={editableSettings.sprintLoopSteps.mergeProtocol} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                mergeProtocol: !current.sprintLoopSteps.mergeProtocol,
              },
            }))} />
          </Row>
          <Row label="Action-required protocol" description="Pause and surface manual intervention when automated resolution is not possible." badge={getFieldBadge("sprintLoopSteps.actionRequiredProtocol")}>
            <Toggle value={editableSettings.sprintLoopSteps.actionRequiredProtocol} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                actionRequiredProtocol: !current.sprintLoopSteps.actionRequiredProtocol,
              },
            }))} />
          </Row>
          <Row label="Status table output" description="Emit the orchestration status table as part of the loop output." badge={getFieldBadge("sprintLoopSteps.statusTable")} last>
            <Toggle value={editableSettings.sprintLoopSteps.statusTable} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                statusTable: !current.sprintLoopSteps.statusTable,
              },
            }))} />
          </Row>
        </SectionCard>

        <SectionCard title="Watch Loop" watermark="LOOP" badge={getBadge("sprintLoopSteps")}>
          <Row label="Watch loop" description="Keep the live watch loop running between orchestration ticks." badge={getFieldBadge("sprintLoopSteps.watchLoop")}>
            <Toggle value={editableSettings.sprintLoopSteps.watchLoop} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintLoopSteps: {
                ...current.sprintLoopSteps,
                watchLoop: !current.sprintLoopSteps.watchLoop,
              },
            }))} />
          </Row>
          <Row label="Watch loop interval" description="Seconds between watch loop evaluation cycles." badge={getFieldBadge("sprintLoopSteps.watchLoopIntervalSeconds")}>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopIntervalSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
            />
          </Row>
          <Row label="Watch output interval" description="Seconds between watch loop output emissions." badge={getFieldBadge("sprintLoopSteps.watchLoopOutputIntervalSeconds")} last>
            <NumberInput
              value={editableSettings.sprintLoopSteps.watchLoopOutputIntervalSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                sprintLoopSteps: {
                  ...current.sprintLoopSteps,
                  watchLoopOutputIntervalSeconds: value,
                },
              }))}
              min={1}
              max={3600}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Workspace Hygiene" watermark="CLI" badge={getBadge("cliWorkflow")}>
          <Row label="Cleanup worktree on success" description="Remove temporary worktree state after successful CLI execution." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnSuccess")}>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnSuccess} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnSuccess: !current.cliWorkflow.cleanupWorktreeOnSuccess,
              },
            }))} />
          </Row>
          <Row label="Cleanup worktree on failure" description="Clean up failed workspaces after execution terminates unsuccessfully." badge={getFieldBadge("cliWorkflow.cleanupWorktreeOnFailure")}>
            <Toggle value={editableSettings.cliWorkflow.cleanupWorktreeOnFailure} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                cleanupWorktreeOnFailure: !current.cliWorkflow.cleanupWorktreeOnFailure,
              },
            }))} />
          </Row>
          <Row label="Retry on read-file errors" description="Retry when a CLI agent fails on a transient file read issue." badge={getFieldBadge("cliWorkflow.retryOnReadFileNotFound")}>
            <Toggle value={editableSettings.cliWorkflow.retryOnReadFileNotFound} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                retryOnReadFileNotFound: !current.cliWorkflow.retryOnReadFileNotFound,
              },
            }))} />
          </Row>
          <Row label="Resume failed task in same workspace" description="Reuse the same workspace for a retry instead of provisioning a fresh one." badge={getFieldBadge("cliWorkflow.resumeFailedTaskInSameWorkspace")} last>
            <Toggle value={editableSettings.cliWorkflow.resumeFailedTaskInSameWorkspace} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                resumeFailedTaskInSameWorkspace: !current.cliWorkflow.resumeFailedTaskInSameWorkspace,
              },
            }))} />
          </Row>
        </SectionCard>

        <SectionCard title="Execution Runtime" watermark="RT" badge={getBadge("cliWorkflow")}>
          <Row label="Execution mode" description="Run worker CLI processes directly on the host or inside a container." badge={getFieldBadge("cliWorkflow.executionMode")}>
            <SelectInput
              value={editableSettings.cliWorkflow.executionMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  executionMode: value as ProjectSettings["cliWorkflow"]["executionMode"],
                },
              }))}
              options={[
                { value: "HOST", label: "Host" },
                { value: "DOCKER", label: "Docker" },
              ]}
            />
          </Row>
          <Row label="Container image" description="Default container image when execution mode is Docker." badge={getFieldBadge("cliWorkflow.containerImage")}>
            <TextInput
              value={editableSettings.cliWorkflow.containerImage}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                  containerImage: value,
                },
              }))}
              mono
            />
          </Row>
          <Row label="Container setup script" description="Optional setup script run inside the container before task execution." badge={getFieldBadge("cliWorkflow.containerSetupScriptPath")}>
            <TextInput
              value={editableSettings.cliWorkflow.containerSetupScriptPath}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                cliWorkflow: {
                  ...current.cliWorkflow,
                containerSetupScriptPath: value,
              },
            }))}
              mono
            />
          </Row>
          <Row label="Cache setup as image" description="Build and reuse a derived Docker image from the base image plus setup script contents." badge={getFieldBadge("cliWorkflow.containerCacheSetupScriptImage")}>
            <Toggle value={editableSettings.cliWorkflow.containerCacheSetupScriptImage} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                containerCacheSetupScriptImage: !current.cliWorkflow.containerCacheSetupScriptImage,
              },
            }))} />
          </Row>
          <Row label="Mount git config" description="Share host git config with the task container." badge={getFieldBadge("cliWorkflow.containerMountGitConfig")} last>
            <Toggle value={editableSettings.cliWorkflow.containerMountGitConfig} onChange={() => updateEditableSettings((current) => ({
              ...current,
              cliWorkflow: {
                ...current.cliWorkflow,
                containerMountGitConfig: !current.cliWorkflow.containerMountGitConfig,
              },
            }))} />
          </Row>
        </SectionCard>
      </div>
    );
  };

  const renderIntegrationsSection = (): ComponentChildren => {
    if (!editableSettings || !systemSettings) {
      return null;
    }

    const connectedState: Record<IntegrationId, boolean> = {
      jules: Boolean(systemSettings.integrations.julesApiKey.trim()),
      gemini: Boolean(systemSettings.integrations.geminiApiKey.trim() || editableSettings.cliWorkflow.containerMountGeminiAuth),
      codex: Boolean(systemSettings.integrations.codexApiKey.trim() || editableSettings.cliWorkflow.containerMountCodexAuth),
      "claude-code": Boolean(systemSettings.integrations.claudeCodeApiKey.trim() || editableSettings.cliWorkflow.containerMountClaudeCodeAuth),
      github: Boolean(systemSettings.integrations.githubToken.trim() || editableSettings.cliWorkflow.containerMountGithubAuth),
    };
    const dockerExecutionEnabled = editableSettings.cliWorkflow.executionMode === "DOCKER";

    const renderIntegrationConfig = (): ComponentChildren => {
      switch (selectedIntegration) {
        case "jules":
          if (activeScope === "project") {
            return (
              <SectionCard title="Jules Configuration" watermark="JUL">
                <NoticePanel title="System-owned credential">
                  The Jules API key is shared system infrastructure. Configure it from system scope here, and use the AI Models category for project-level routing and model choices.
                </NoticePanel>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Jules Configuration" watermark="JUL">
              <Row label="Jules API key" description="System-wide credential for the Jules provider integration." last>
                <TextInput
                  value={systemSettings.integrations.julesApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      julesApiKey: value,
                    },
                  }))}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "gemini":
          if (activeScope === "project") {
            return (
              <SectionCard title="Gemini Configuration" watermark="GEM">
                <NoticePanel title="System-owned credential">
                  The Gemini API key is shared at system scope so hosted worker integrations can reuse it across projects.
                </NoticePanel>
                <Row label="Mount Gemini auth" description="Copy Gemini CLI auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountGeminiAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountGeminiAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountGeminiAuth: !current.cliWorkflow.containerMountGeminiAuth,
                    },
                  }))} />
                </Row>
                <Row label="Gemini auth path" description="Host path copied into the Docker runtime for Gemini auth." badge={getFieldBadge("cliWorkflow.containerGeminiAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerGeminiAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerGeminiAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountGeminiAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Gemini Configuration" watermark="GEM">
              <Row label="Gemini API key" description="Shared credential for Gemini-backed execution and future hosted workers. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.geminiApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      geminiApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountGeminiAuth}
                  mono
                />
              </Row>
              <Row label="Mount Gemini auth" description="Copy Gemini CLI auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountGeminiAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountGeminiAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountGeminiAuth: !current.cliWorkflow.containerMountGeminiAuth,
                  },
                }))} />
              </Row>
              <Row label="Gemini auth path" description="Host path copied into the Docker runtime for Gemini auth." badge={getFieldBadge("cliWorkflow.containerGeminiAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerGeminiAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerGeminiAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountGeminiAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "codex":
          if (activeScope === "project") {
            return (
              <SectionCard title="Codex Configuration" watermark="CDX">
                <NoticePanel title="System-owned credential">
                  The Codex API key is managed once at system scope and then reused by projects and future worker providers.
                </NoticePanel>
                <Row label="Mount Codex auth" description="Copy Codex auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountCodexAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountCodexAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountCodexAuth: !current.cliWorkflow.containerMountCodexAuth,
                    },
                  }))} />
                </Row>
                <Row label="Codex auth path" description="Host path copied into the Docker runtime for Codex auth." badge={getFieldBadge("cliWorkflow.containerCodexAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerCodexAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerCodexAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountCodexAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Codex Configuration" watermark="CDX">
              <Row label="Codex API key" description="Shared credential for Codex-backed execution and worker routing. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.codexApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      codexApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountCodexAuth}
                  mono
                />
              </Row>
              <Row label="Mount Codex auth" description="Copy Codex auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountCodexAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountCodexAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountCodexAuth: !current.cliWorkflow.containerMountCodexAuth,
                  },
                }))} />
              </Row>
              <Row label="Codex auth path" description="Host path copied into the Docker runtime for Codex auth." badge={getFieldBadge("cliWorkflow.containerCodexAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerCodexAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerCodexAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountCodexAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "claude-code":
          if (activeScope === "project") {
            return (
              <SectionCard title="Claude Code Configuration" watermark="CCD">
                <NoticePanel title="System-owned credential">
                  The Claude Code API key is shared system-wide. Project-level provider selection still lives under AI Models.
                </NoticePanel>
                <Row label="Mount Claude Code auth" description="Copy Claude Code auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountClaudeCodeAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountClaudeCodeAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountClaudeCodeAuth: !current.cliWorkflow.containerMountClaudeCodeAuth,
                    },
                  }))} />
                </Row>
                <Row label="Claude Code auth path" description="Host path copied into the Docker runtime for Claude Code auth." badge={getFieldBadge("cliWorkflow.containerClaudeCodeAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerClaudeCodeAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerClaudeCodeAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Claude Code Configuration" watermark="CCD">
              <Row label="Claude Code API key" description="Shared credential for Claude Code-backed execution. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.claudeCodeApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      claudeCodeApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                  mono
                />
              </Row>
              <Row label="Mount Claude Code auth" description="Copy Claude Code auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountClaudeCodeAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountClaudeCodeAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountClaudeCodeAuth: !current.cliWorkflow.containerMountClaudeCodeAuth,
                  },
                }))} />
              </Row>
              <Row label="Claude Code auth path" description="Host path copied into the Docker runtime for Claude Code auth." badge={getFieldBadge("cliWorkflow.containerClaudeCodeAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerClaudeCodeAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerClaudeCodeAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "github":
        default:
          return (
            <SectionCard title="GitHub Configuration" watermark="GTH" badge={getBadge("git")}>
              {activeScope === "system" ? (
                <Row label="GitHub token" description="Shared token for repository, pull request, branch, and CI integration.">
                  <TextInput
                    value={systemSettings.integrations.githubToken}
                    onChange={(value) => updateSystem((current) => ({
                      ...current,
                      integrations: {
                        ...current.integrations,
                        githubToken: value,
                      },
                    }))}
                    disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountGithubAuth}
                    mono
                  />
                </Row>
              ) : null}
              <Row label="Mount GitHub auth" description="Copy GitHub CLI auth into Docker instead of passing the token." badge={getFieldBadge("cliWorkflow.containerMountGithubAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountGithubAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountGithubAuth: !current.cliWorkflow.containerMountGithubAuth,
                  },
                }))} />
              </Row>
              <Row label="GitHub auth path" description="Host path copied into the Docker runtime for GitHub CLI auth." badge={getFieldBadge("cliWorkflow.containerGithubAuthPath")}>
                <TextInput
                  value={editableSettings.cliWorkflow.containerGithubAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerGithubAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountGithubAuth}
                  mono
                />
              </Row>
              <Row label="GitHub mode" description="Remote uses GitHub APIs; local keeps workflow on the local repository only." badge={getFieldBadge("git.githubMode")}>
                <SelectInput
                  value={editableSettings.git.githubMode}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      githubMode: value as ProjectSettings["git"]["githubMode"],
                    },
                  }))}
                  options={[
                    { value: "REMOTE", label: "Remote" },
                    { value: "LOCAL", label: "Local" },
                  ]}
                />
              </Row>
              <Row label="Default branch" description="Main GitHub integration branch used for merge and release flow." badge={getFieldBadge("git.defaultBranch")}>
                <TextInput
                  value={editableSettings.git.defaultBranch}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      defaultBranch: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Feature branch prefix" description="Prefix used when workers or automation create GitHub feature branches." badge={getFieldBadge("git.featureBranchPrefix")}>
                <TextInput
                  value={editableSettings.git.featureBranchPrefix}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      featureBranchPrefix: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Sprint branch scheme" description="Naming scheme for sprint-level GitHub branches and aggregation flow." badge={getFieldBadge("git.sprintBranchScheme")}>
                <TextInput
                  value={editableSettings.git.sprintBranchScheme}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      sprintBranchScheme: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Auto-create pull requests" description="Open GitHub pull requests automatically when work completes and the flow supports it." badge={getFieldBadge("git.autoCreatePr")} last>
                <Toggle
                  value={editableSettings.git.autoCreatePr}
                  onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      autoCreatePr: !current.git.autoCreatePr,
                    },
                  }))}
                />
              </Row>
            </SectionCard>
          );
      }
    };

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Connected Integrations" watermark="INT">
          {INTEGRATIONS.map((integration, index) => (
            <IntegrationConfigRow
              key={integration.id}
              label={integration.label}
              description={integration.description}
              connected={connectedState[integration.id]}
              active={selectedIntegration === integration.id}
              onConfigure={() => setSelectedIntegration(integration.id)}
              last={index === INTEGRATIONS.length - 1}
            />
          ))}
        </SectionCard>

        {renderIntegrationConfig()}

        {activeScope === "system" ? (
          <SectionCard title="Integration Import" watermark="ENV">
            <Row label="Import from environment" description="Pull missing provider credentials from `.env` or `settings.json` without overwriting filled fields." last>
              <ActionButton label="Import Hints" onClick={() => void handleImportHints()} busy={importingHints} />
            </Row>
          </SectionCard>
        ) : null}

        <NoticePanel title="Integration ownership">
          Shared provider credentials remain system-owned. GitHub workflow defaults can be set at system scope and overridden at project scope, which keeps integration ownership clean while still letting each repository tune its behavior.
        </NoticePanel>
      </div>
    );
  };

  const renderAgentsSection = (): ComponentChildren => {
    if (!editableSettings) {
      return null;
    }

    const selectedTemplateConfig = AGENT_INSTRUCTION_TEMPLATE_OPTIONS.find((option) => option.value === selectedAgentTemplate)
      ?? AGENT_INSTRUCTION_TEMPLATE_OPTIONS[0]!;
    const selectedTemplateValue = editableSettings.agents.instructionTemplates[selectedAgentTemplate] || "";

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Project Markdown Mirror" watermark="AGT" badge={getBadge("agents")}>
          <Row label="Save agent markdown to project directory" description="When enabled, dashboard edits write a companion markdown file under `.sprint-os/agents` for the selected project. Default and home agent files are never modified." badge={getFieldBadge("agents.saveToProjectDirectory")}>
            <Toggle
              value={editableSettings.agents.saveToProjectDirectory}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                agents: {
                  ...current.agents,
                  saveToProjectDirectory: !current.agents.saveToProjectDirectory,
                },
              }))}
            />
          </Row>
          <Row label="Mirror directory" description="Dashboard-authored markdown companions live alongside other project-local Sprint OS files." last>
            <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
              .sprint-os/agents
            </div>
          </Row>
        </SectionCard>

        <SectionCard title="Instruction Templates" watermark="TXT" badge={getBadge("agents")}>
          <Row label="Template" description="Pick the orchestration instruction block you want to edit in the database-backed settings store.">
            <SelectInput
              value={selectedAgentTemplate}
              onChange={(value) => setSelectedAgentTemplate(value as AgentInstructionTemplateId)}
              options={AGENT_INSTRUCTION_TEMPLATE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </Row>
          <div className="py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
                {selectedTemplateConfig.label}
              </div>
              {getFieldBadge(`agents.instructionTemplates.${selectedAgentTemplate}`) ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                    !
                  </span>
                  {getFieldBadge(`agents.instructionTemplates.${selectedAgentTemplate}`)}
                </span>
              ) : null}
            </div>
            <div className="mb-4 text-xs font-medium leading-relaxed text-slate-400">
              {selectedTemplateConfig.description}
            </div>
            <TextAreaInput
              value={selectedTemplateValue}
              placeholder="Markdown template text with {{variables}} placeholders."
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                agents: {
                  ...current.agents,
                  instructionTemplates: {
                    ...current.agents.instructionTemplates,
                    [selectedAgentTemplate]: value,
                  },
                },
              }))}
            />
          </div>
        </SectionCard>

        <NoticePanel title="Agent sync behavior" tone="success">
          The database stays authoritative for agent records, labels, and routing metadata. When the mirror is enabled, dashboard edits also refresh a project-local markdown file, and local markdown drift can be imported back into the dashboard from the Agents page.
        </NoticePanel>

        <NoticePanel title="Instruction template storage">
          Sprint protocol and intervention templates are now stored in scoped settings. Built-in defaults stay in code, system scope defines the default copy, and project scope can override any template without relying on `.sprint-os/instructions`.
        </NoticePanel>
      </div>
    );
  };

  const renderMemorySection = (): ComponentChildren => {
    if (!editableSettings) {
      return null;
    }

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Memory System" watermark="MEM" badge={getBadge("memory")}>
          <Row label="Enable memory" description="Turn on the memory system for automatic capture, storage, and semantic search of sprint knowledge." badge={getFieldBadge("memory.enabled")}>
            <Toggle
              value={editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, enabled: !current.memory.enabled },
              }))}
            />
          </Row>
          <Row label="Auto-capture sprint events" description="Automatically create memories when tasks complete, fail, or encounter CI issues during sprint execution." badge={getFieldBadge("memory.autoCaptureSprint")}>
            <Toggle
              value={editableSettings.memory.autoCaptureSprint}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureSprint: !current.memory.autoCaptureSprint },
              }))}
            />
          </Row>
          <Row label="Auto-capture agent events" description="Capture memories from notable agent interactions such as retries and clarifications." badge={getFieldBadge("memory.autoCaptureAgent")}>
            <Toggle
              value={editableSettings.memory.autoCaptureAgent}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureAgent: !current.memory.autoCaptureAgent },
              }))}
            />
          </Row>
          <Row label="Auto-promote to project scope" description="Automatically promote recurring or high-strength sprint memories to long-term project knowledge when a sprint completes." badge={getFieldBadge("memory.autoPromote")} last>
            <Toggle
              value={editableSettings.memory.autoPromote}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoPromote: !current.memory.autoPromote },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Limits" watermark="CAP" badge={getBadge("memory")}>
          <Row label="Promotion threshold" description="Minimum score (0.0–1.0) a sprint memory needs to be auto-promoted to project scope." badge={getFieldBadge("memory.promotionThreshold")}>
            <NumberInput
              value={editableSettings.memory.promotionThreshold}
              min={0}
              max={1}
              step={0.05}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, promotionThreshold: value },
              }))}
            />
          </Row>
          <Row label="Max sprint memories" description="Maximum number of memories retained per sprint. Lowest-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxSprintMemories")}>
            <NumberInput
              value={editableSettings.memory.maxSprintMemories}
              min={10}
              max={5000}
              step={10}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxSprintMemories: value },
              }))}
            />
          </Row>
          <Row label="Max project memories" description="Maximum number of long-term project-scoped memories. Oldest low-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxProjectMemories")} last>
            <NumberInput
              value={editableSettings.memory.maxProjectMemories}
              min={10}
              max={10000}
              step={50}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxProjectMemories: value },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Worker Learnings Instruction" watermark="LRN" badge={getBadge("memory")}>
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium leading-relaxed text-slate-400 mb-3">
              This instruction is appended to every worker task prompt when auto-capture is enabled. It tells the AI provider what to observe and record in a temporary learnings file that gets processed into sprint memories.
            </div>
            <TextAreaInput
              value={editableSettings.memory.workerLearningsInstruction}
              rows={16}
              placeholder="Enter the instruction that tells workers what to capture..."
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, workerLearningsInstruction: value },
              }))}
            />
          </div>
        </SectionCard>

        <NoticePanel title="Embedding models" tone="success">
          Download and manage embedding models from the Memory page. Once a model is active, new memories are automatically embedded for semantic search. The memory system works without a model — search falls back to text matching.
        </NoticePanel>
      </div>
    );
  };

  const renderDangerSection = (): ComponentChildren => (
    <div className="flex flex-col gap-5">
      {activeScope === "project" ? (
        <SectionCard title="Project Danger Zone" watermark="RST" danger>
          <div className="pt-5 pb-2">
            <NoticePanel title="Reset behavior" tone="warning">
              Project scope can clear only overrides or remove the entire project. Both actions are destructive.
            </NoticePanel>
          </div>
          <Row label="Reset project overrides" description="Use this when a project should return to pure inheritance instead of keeping stale overrides.">
            <ActionButton
              label="Reset Overrides"
              onClick={() => void handleResetProject()}
              tone="danger"
              busy={resettingProject}
              disabled={!selectedProject}
            />
          </Row>
          <Row label="Delete project" description="Remove the selected project and all related sprints, tasks, chats, execution state, and overrides." last>
            <ActionButton
              label="Delete Project"
              onClick={() => void handleDeleteProject()}
              tone="danger"
              busy={deletingProject}
              disabled={!selectedProject}
            />
          </Row>
        </SectionCard>
      ) : (
        <SectionCard title="System Danger Zone" watermark="SYS" danger>
          <div className="pt-5 pb-2">
            <NoticePanel title="Development-only reset" tone="warning">
              Reset Database wipes the app database and scoped settings storage back to a clean state. Use it only when you really want to start fresh.
            </NoticePanel>
          </div>
          <Row label="Reset database" description="Delete all projects, sprints, tasks, chats, runtime state, and stored settings across the system." last>
            <ActionButton
              label="Reset Database"
              onClick={() => void handleResetDatabase()}
              tone="danger"
              busy={resettingDatabase}
            />
          </Row>
        </SectionCard>
      )}
    </div>
  );

  const renderContent = (): ComponentChildren => {
    if (loading) {
      return (
        <NoticePanel title="Loading settings">
          Pulling the current scoped settings documents and effective project inheritance.
        </NoticePanel>
      );
    }

    switch (activeCategory) {
      case "general":
        return renderGeneralSection();
      case "models":
        return renderModelsSection();
      case "sprint":
        return renderSprintSection();
      case "agents":
        return renderAgentsSection();
      case "memory":
        return renderMemorySection();
      case "integrations":
        return renderIntegrationsSection();
      case "danger":
        return renderDangerSection();
      default:
        return null;
    }
  };

  return (
    <div className="relative z-10 mx-auto flex max-w-[1920px] flex-col gap-16 px-8 py-24 md:px-20">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.04)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.06)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.025)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
      </div>

      <div ref={headerRef} className="flex items-end justify-between gap-8">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono">
            <Settings className="h-3.5 w-3.5" strokeWidth={2.5} />
            Configuration
          </div>

          <div className="relative overflow-hidden">
            <h2
              aria-hidden
              className="pointer-events-none absolute -left-3 -top-10 select-none font-display text-[7rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03]"
            >
              CONF
            </h2>
            <h1 className="relative z-10 font-display text-5xl font-black leading-[0.92] tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Settings
              <br />
              <span className="text-slate-400 dark:text-slate-500">Integration.</span>
            </h1>
          </div>

          <p className="mt-1 max-w-2xl text-lg font-medium leading-relaxed text-slate-500 dark:text-slate-500">
            Keep the original settings surface, but drive it from the new scoped model: system-wide runtime and integrations, project-level inherited behavior, and sprint overrides from the sprint page.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-[1rem] border border-black/[0.06] bg-white/70 p-1 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60">
              <button
                type="button"
                onClick={() => setActiveScope("system")}
                className={`rounded-[0.9rem] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
                  activeScope === "system"
                    ? "bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                System
              </button>
              <button
                type="button"
                onClick={() => selectedProject && setActiveScope("project")}
                disabled={!selectedProject}
                className={`rounded-[0.9rem] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeScope === "project"
                    ? "bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                Project
              </button>
            </div>

            <div className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:text-slate-300">
              {activeScope === "system"
                ? "Editing live system defaults"
                : selectedProject
                  ? `Editing overrides for ${selectedProject.name}`
                  : "Select a project to edit overrides"}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          {activeScope === "project" ? (
            <ActionButton
              label="Reset Project"
              onClick={() => void handleResetProject()}
              tone="danger"
              busy={resettingProject}
              disabled={!selectedProject}
            />
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!activeDirty || activeSaving || loading || (activeScope === "project" && !selectedProject)}
            className={`group flex items-center gap-2.5 rounded-2xl px-6 py-3.5 text-sm font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${
              saveMessage && !error
                ? "bg-status-green text-white shadow-[0_4px_20px_rgba(0,171,132,0.3)]"
                : "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
            }`}
          >
            {activeSaving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                Saving
              </>
            ) : saveMessage && !error ? (
              <>
                <Check className="h-4 w-4" strokeWidth={2.5} />
                Saved
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" strokeWidth={2} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[300px_1fr]">
        <div className="sticky top-24 flex flex-col gap-1 rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-3 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          <div className="px-4 pb-3 pt-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">
              Categories
            </span>
          </div>

          {CATEGORIES.map((category) => {
            const isActive = activeCategory === category.id;
            const isDanger = category.danger;

            return (
              <button
                key={category.id}
                type="button"
                onClick={() => switchCategory(category.id)}
                className={`group relative flex w-full items-center gap-3.5 rounded-[1.1rem] px-4 py-3.5 text-left transition-colors duration-200 ${
                  isActive
                    ? isDanger
                      ? "bg-status-red/[0.07] dark:bg-status-red/[0.08]"
                      : "bg-signal-500/[0.08] dark:bg-signal-500/[0.1]"
                    : "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                }`}
              >
                {isActive ? (
                  <div className={`absolute left-0 top-3 bottom-3 w-[2.5px] rounded-full ${isDanger ? "bg-status-red" : "bg-signal-500"}`} />
                ) : null}

                <span className="w-5 shrink-0 text-right font-mono text-[9px] font-bold text-slate-300 dark:text-slate-600">
                  {category.num}
                </span>

                <category.icon
                  className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                    isActive
                      ? isDanger
                        ? "text-status-red"
                        : "text-signal-500"
                      : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
                  }`}
                  strokeWidth={1.75}
                />

                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold transition-colors duration-200 ${
                    isActive
                      ? isDanger
                        ? "text-status-red"
                        : "text-signal-600 dark:text-signal-400"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                  >
                    {category.label}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] font-medium leading-tight text-slate-400 dark:text-slate-600">
                    {category.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div ref={contentRef} className="flex min-w-0 flex-col gap-5">
          <div className="mb-1 flex items-center gap-3">
            <activeCategoryConfig.icon
              className={`h-4 w-4 ${activeCategoryConfig.danger ? "text-status-red" : "text-signal-500"}`}
              strokeWidth={2}
            />
            <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${
              activeCategoryConfig.danger ? "text-status-red/70" : "text-signal-500"
            }`}
            >
              {activeCategoryConfig.label}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-black/[0.06] to-transparent dark:from-white/[0.06]" />
          </div>

          {error ? (
            <NoticePanel title="Settings error" tone="warning">
              {error}
            </NoticePanel>
          ) : null}

          {renderContent()}
        </div>
      </div>
    </div>
  );
};
