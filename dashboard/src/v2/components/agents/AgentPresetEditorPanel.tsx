import type { FunctionComponent } from "preact";
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
  Save,
  X,
  RefreshCw,
  AlertCircle,
  Tag,
  FileText,
  BrainCircuit,
  Cpu,
  Sparkles,
  Plus,
  Check,
  Route,
  Plug,
  Settings2,
  UserRound,
  Palette,
  SlidersHorizontal,
  Library,
  Database,
  ShieldCheck,
} from "lucide-preact";
import type { AgentMcpAccessConfig, AgentPreset, CustomMcpServer, SkillStorageRecord } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { DEFAULT_AGENT_MEMORY_CONFIG, type AgentMemoryConfig } from "../../memory-types.js";
import { AgentMemoryConfigPanel } from "./AgentMemoryConfigPanel.js";
import { AgentKnowledgePanel } from "./AgentKnowledgePanel.js";
import { AgentAvatarCustomizer } from "./AgentAvatarCustomizer.js";
import { AgentAvatarStage } from "./AgentAvatarStage.js";
import { AgentMcpManagePanel } from "./AgentMcpManageModal.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { Popover } from "../ui/Popover.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { MarkdownEditorField } from "../ui/MarkdownEditorField.js";
import { getAccentHex, generateRandomAgentAvatar } from "../../lib/agent-avatar.js";
import { defaultAgentMcpAccess, normalizeAgentMcpAccess } from "../../lib/agent-mcp-display.js";
import { estimateTokens, formatTokenCount } from "../../lib/token-estimate.js";
import { PersistentSkillStorageChip } from "./PersistentSkillStorageChip.js";
import { useDashboardI18n } from "../../i18n/index.js";
import type { DashboardMessageVariables, DashboardTextMessageKey } from "../../i18n/index.js";
import { agentsMessages } from "../../i18n/messages/agents.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import type { AgentEditorNavigationStateChange } from "./editor-navigation-state.js";

/* ─────────────────────────────────────────────────────────
 * Validation rules
 * ──────────────────────────────────────────────────────── */
const NAME_MAX = 60;
const DESCRIPTION_MAX = 180;
const INSTRUCTION_SOFT_MAX = 8000;

type FormErrors = Partial<Record<"name" | "description" | "instruction" | "memory", string>>;
type ActionStatus = { tone: "neutral" | "success" | "error" | "pending"; message: string };
type ContainerRootMode = "inherit" | "non_root" | "root";

export interface AgentProviderOption {
  value: string;
  label: string;
  provider: string;
  model: string;
  enabled: boolean;
}

function validate({
  name,
  description,
  instruction,
  memoryEnabled,
  memory,
}: {
  name: string;
  description: string;
  instruction: string;
  memoryEnabled: boolean;
  memory: string;
}, localize: (key: DashboardTextMessageKey<typeof agentsMessages>, variables?: DashboardMessageVariables) => string, formatNumber: (value: number) => string): FormErrors {
  const errors: FormErrors = {};
  const trimmedName = name.trim();
  if (!trimmedName) {
    errors.name = localize("nameRequired");
  } else if (trimmedName.length > NAME_MAX) {
    errors.name = localize("nameTooLong", { limit: formatNumber(NAME_MAX) });
  }

  if (description.trim().length > DESCRIPTION_MAX) {
    errors.description = localize("descriptionTooLong", { limit: formatNumber(DESCRIPTION_MAX) });
  }

  if (instruction.length > INSTRUCTION_SOFT_MAX * 1.5) {
    errors.instruction = localize("instructionsTooLong", { current: formatNumber(instruction.length), limit: formatNumber(INSTRUCTION_SOFT_MAX * 1.5) });
  }

  if (memoryEnabled && memory.trim().length === 0) {
    errors.memory = localize("memoryOverrideRequired");
  }

  return errors;
}

const toContainerRootMode = (value: boolean | null | undefined): ContainerRootMode => {
  if (value === true) return "root";
  if (value === false) return "non_root";
  return "inherit";
};

const fromContainerRootMode = (value: ContainerRootMode): boolean | null => {
  if (value === "root") return true;
  if (value === "non_root") return false;
  return null;
};

const CONTAINER_ROOT_MODE_OPTIONS: Array<{
  value: ContainerRootMode;
  labelKey: "inherit" | "forceNonRoot" | "forceRoot";
  hintKey: "inheritRootHint" | "forceNonRootHint" | "forceRootHint";
  ariaLabelKey: "inheritRootAria" | "forceNonRootAria" | "forceRootAria";
}> = [
  {
    value: "inherit",
    labelKey: "inherit", hintKey: "inheritRootHint", ariaLabelKey: "inheritRootAria",
  },
  {
    value: "non_root",
    labelKey: "forceNonRoot", hintKey: "forceNonRootHint", ariaLabelKey: "forceNonRootAria",
  },
  {
    value: "root",
    labelKey: "forceRoot", hintKey: "forceRootHint", ariaLabelKey: "forceRootAria",
  },
];

/* ─────────────────────────────────────────────────────────
 * Field helpers
 * ──────────────────────────────────────────────────────── */
const FieldShell: FunctionComponent<{
  icon: typeof Tag;
  label: string;
  htmlFor?: string;
  helper?: string;
  required?: boolean;
  counter?: string;
  error?: string;
  errorId?: string;
  children: preact.ComponentChildren;
}> = ({ icon: Icon, label, htmlFor, helper, required, counter, error, errorId, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-3">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
      >
        <Icon className="h-3 w-3" strokeWidth={2.4} />
        {label}
        {required && <span className="text-signal-500">*</span>}
      </label>
      {counter && (
        <span aria-live="polite" className="font-mono text-[10px] font-bold text-slate-400 dark:text-slate-500">
          {counter}
        </span>
      )}
    </div>
    {children}
    {helper && !error && (
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{helper}</p>
    )}
    {error && (
      <p
        id={errorId}
        role="alert"
        className="flex items-center gap-1.5 text-[11px] font-medium text-status-red"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
        {error}
      </p>
    )}
  </div>
);

const SectionCard: FunctionComponent<{
  icon: typeof Tag;
  eyebrow: string;
  title: string;
  action?: preact.ComponentChildren;
  className?: string;
  children: preact.ComponentChildren;
}> = ({ icon: Icon, eyebrow, title, action, className = "", children }) => (
  <section className={`relative flex flex-col gap-5 rounded-[1.6rem] border border-black/[0.05] bg-white/40 p-6 backdrop-blur-xl dark:border-white/[0.05] dark:bg-white/[0.025] ${className}`}>
    <header className="flex items-start justify-between gap-3 border-b border-black/[0.04] pb-4 dark:border-white/[0.04]">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 ring-1 ring-inset ring-signal-500/15 dark:bg-signal-500/15 dark:text-signal-400">
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">
            {eyebrow}
          </span>
          <h3 className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h3>
        </div>
      </div>
      {action}
    </header>
    {children}
  </section>
);

const formatMemoryStrength = (value: number): string => {
  if (value === 0) return "0";
  return value.toFixed(2).replace(/\.?0+$/, "");
};

const formatMemoryConfigSummary = (
  config: AgentMemoryConfig,
  localize: (key: DashboardTextMessageKey<typeof agentsMessages>, variables?: DashboardMessageVariables) => string,
  pluralize: (key: "categoryCount", count: number) => string,
  formatNumber: (value: number) => string,
): string => {
  const tierLabel =
    config.tier === "both"
      ? localize("bothTiers")
      : config.tier === "short_term"
        ? localize("shortTerm")
        : localize("longTerm");

  const categoryLabel =
    config.categories.length === 0
      ? localize("allCategories")
      : pluralize("categoryCount", config.categories.length);

  const parts = [tierLabel, categoryLabel];

  if (config.minStrength > 0) {
    parts.push(localize("minStrengthSummary", { value: formatMemoryStrength(config.minStrength) }));
  }

  if (config.maxShortTerm > 0) {
    parts.push(localize("shortTermCount", { count: formatNumber(config.maxShortTerm) }));
  }

  if (config.maxLongTerm > 0) {
    parts.push(localize("longTermCount", { count: formatNumber(config.maxLongTerm) }));
  }

  return parts.join(" · ");
};

/* ─────────────────────────────────────────────────────────
 * Main editor
 * ──────────────────────────────────────────────────────── */
const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

export const AgentPresetEditorPanel: FunctionComponent<{
  preset: AgentPreset;
  saving: boolean;
  defaultMemoryInstruction?: string;
  providerOptions?: AgentProviderOption[];
  availableMcpServers?: CustomMcpServer[];
  availableSkillStorages?: SkillStorageRecord[];
  isDashboardReplyAgent?: boolean;
  onSave: (id: string, updates: Partial<AgentPreset>) => Promise<boolean> | boolean;
  onCancel: () => void;
  onEditorStateChange?: AgentEditorNavigationStateChange;
}> = ({ preset, saving, defaultMemoryInstruction = "", providerOptions = [], availableMcpServers = [], availableSkillStorages = [], isDashboardReplyAgent = false, onSave, onCancel, onEditorStateChange }) => {
  const { formatDate, formatNumber, locale, translate, translatePlural } = useDashboardI18n();
  const t = useCallback((key: DashboardTextMessageKey<typeof agentsMessages>, variables?: DashboardMessageVariables): string => (
    translate(agentsMessages, key, variables)
  ), [translate]);
  const panelRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const instructionHostRef = useRef<HTMLDivElement>(null);
  const memoryHostRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const interactionTokens = useInteractionTokens();

  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description || "");
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const [memoryOverrideEnabled, setMemoryOverrideEnabled] = useState(
    !!preset.memoryTemplateOverrideEnabled
  );
  const [memoryMarkdown, setMemoryMarkdown] = useState(preset.memoryTemplateMarkdown ?? "");
  const [providerConfigId, setProviderConfigId] = useState(preset.providerConfigId || "");
  const [model, setModel] = useState(preset.model || "");
  const [containerRootMode, setContainerRootMode] = useState<ContainerRootMode>(
    toContainerRootMode(preset.containerRunAsRoot)
  );
  const [avatarConfig, setAvatarConfig] = useState(preset.avatarConfig);
  const [mcpAccess, setMcpAccess] = useState<AgentMcpAccessConfig>(
    normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess())
  );
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [memoryConfig, setMemoryConfig] = useState<AgentMemoryConfig>(
    preset.memoryConfig ?? DEFAULT_AGENT_MEMORY_CONFIG
  );
  const [persistentSkillStorageIds, setPersistentSkillStorageIds] = useState<string[]>(preset.persistentSkillStorageIds ?? []);
  const [persistentSkillsEnabled, setPersistentSkillsEnabled] = useState(Boolean(preset.persistentSkillStorage?.enabled));
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const memoryButtonRef = useRef<HTMLButtonElement>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [avatarExpression, setAvatarExpression] = useState<AgentAvatarExpression>("happy");
  const [knowledgeDirty, setKnowledgeDirty] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus>({
    tone: "neutral",
    message: t("validationHint"),
  });

  const setMcpAccessNormalized = (next: AgentMcpAccessConfig): void => setMcpAccess(normalizeAgentMcpAccess(next));

  const accentHex = getAccentHex(avatarConfig?.accent);

  const handleRandomizeAvatar = (): void => {
    const seed = Date.now().toString(36) + Math.random().toString(36).substring(2);
    setAvatarConfig(generateRandomAgentAvatar(seed));
    setActionStatus({ tone: "success", message: t("avatarRandomizedSave") });
  };

  /* Reset when preset switches */
  useEffect(() => {
    setName(preset.name);
    setDescription(preset.description || "");
    setInstructionMarkdown(preset.instructionMarkdown);
    setMemoryOverrideEnabled(!!preset.memoryTemplateOverrideEnabled);
    setMemoryMarkdown(preset.memoryTemplateMarkdown ?? "");
    setProviderConfigId(preset.providerConfigId || "");
    setModel(preset.model || "");
    setContainerRootMode(toContainerRootMode(preset.containerRunAsRoot));
    setAvatarConfig(preset.avatarConfig);
    setMcpAccess(normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess()));
    setMemoryConfig(preset.memoryConfig ?? DEFAULT_AGENT_MEMORY_CONFIG);
    setPersistentSkillStorageIds(preset.persistentSkillStorageIds ?? []);
    setPersistentSkillsEnabled(Boolean(preset.persistentSkillStorage?.enabled));
    setShowMemoryPanel(false);
    setTouched({});
    setKnowledgeDirty(false);
    setActionStatus({ tone: "neutral", message: t("validationHint") });
  }, [preset.id, t]);

  /* Entry animation */
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : 16 },
      { opacity: 1, x: 0, duration: gsapTokens.selectionMovement.duration, ease: gsapTokens.selectionMovement.ease },
    );
  }, [preset.id, reducedMotion, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

  /* Validation + dirty tracking */
  const errors = useMemo(
    () =>
      validate({
        name,
        description,
        instruction: instructionMarkdown,
        memoryEnabled: memoryOverrideEnabled,
        memory: memoryMarkdown,
      }, t, (value) => formatNumber(value)),
    [name, description, instructionMarkdown, memoryOverrideEnabled, memoryMarkdown, t, formatNumber]
  );

  const hasErrors = Object.keys(errors).length > 0;

  const isDirty = useMemo(() => {
    if (knowledgeDirty) return true;
    if (name !== preset.name) return true;
    if (description !== (preset.description || "")) return true;
    if (instructionMarkdown !== preset.instructionMarkdown) return true;
    if (memoryOverrideEnabled !== !!preset.memoryTemplateOverrideEnabled) return true;
    if ((preset.memoryTemplateMarkdown ?? "") !== memoryMarkdown && memoryOverrideEnabled) return true;
    if (providerConfigId !== (preset.providerConfigId || "")) return true;
    if (model !== (preset.model || "")) return true;
    if (containerRootMode !== toContainerRootMode(preset.containerRunAsRoot)) return true;
    if (JSON.stringify(avatarConfig ?? {}) !== JSON.stringify(preset.avatarConfig ?? {})) return true;
    if (JSON.stringify(mcpAccess) !== JSON.stringify(normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess()))) return true;
    if (JSON.stringify(memoryConfig) !== JSON.stringify(preset.memoryConfig ?? DEFAULT_AGENT_MEMORY_CONFIG)) return true;
    if (JSON.stringify(persistentSkillStorageIds) !== JSON.stringify(preset.persistentSkillStorageIds ?? [])) return true;
    if (persistentSkillsEnabled !== Boolean(preset.persistentSkillStorage?.enabled)) return true;
    return false;
  }, [
    name,
    description,
    instructionMarkdown,
    memoryOverrideEnabled,
    memoryMarkdown,
    providerConfigId,
    model,
    containerRootMode,
    avatarConfig,
    mcpAccess,
    memoryConfig,
    persistentSkillStorageIds,
    persistentSkillsEnabled,
    preset,
    knowledgeDirty,
  ]);

  const submitDisabled = saving || hasErrors || !isDirty;

  /* Submit */
  const focusFirstInvalidField = (nextErrors: FormErrors): void => {
    if (nextErrors.name) {
      nameRef.current?.focus();
      return;
    }
    if (nextErrors.description) {
      descriptionRef.current?.focus();
      return;
    }
    if (nextErrors.instruction) {
      instructionHostRef.current?.querySelector<HTMLElement>("textarea, [contenteditable='true'], button")?.focus();
      return;
    }
    if (nextErrors.memory) {
      memoryHostRef.current?.querySelector<HTMLElement>("textarea, [contenteditable='true'], button")?.focus();
    }
  };

  const saveDraft = useCallback(async (): Promise<boolean> => {
    setTouched({ name: true, description: true, instruction: true, memory: true });
    if (hasErrors) {
      focusFirstInvalidField(errors);
      setActionStatus({ tone: "error", message: t("fixHighlighted") });
      return false;
    }
    if (!isDirty) {
      setActionStatus({ tone: "neutral", message: t("noChangesToSave") });
      return false;
    }
    setActionStatus({ tone: "pending", message: t("savingAgentChanges") });
    const saved = await onSave(preset.id, {
      name: name.trim(),
      description: description.trim(),
      instructionMarkdown,
      memoryTemplateOverrideEnabled: memoryOverrideEnabled,
      memoryTemplateMarkdown: memoryOverrideEnabled ? memoryMarkdown : undefined,
      providerConfigId: providerConfigId || null,
      model: model.trim() || null,
      containerRunAsRoot: fromContainerRootMode(containerRootMode),
      avatarConfig,
      mcpAccess,
      memoryConfig,
      persistentSkillStorageIds,
      persistentSkillStorage: { enabled: persistentSkillsEnabled && persistentSkillStorageIds.length > 0 },
    });
    if (saved) {
      setKnowledgeDirty(false);
    }
    return saved;
  }, [
    avatarConfig,
    containerRootMode,
    description,
    errors,
    hasErrors,
    instructionMarkdown,
    isDirty,
    mcpAccess,
    memoryConfig,
    memoryMarkdown,
    memoryOverrideEnabled,
    model,
    name,
    onSave,
    persistentSkillStorageIds,
    persistentSkillsEnabled,
    preset.id,
    providerConfigId,
    t,
  ]);

  const handleSubmit = (event: Event): void => {
    event.preventDefault();
    void saveDraft();
  };

  useEffect(() => {
    if (!onEditorStateChange) return undefined;
    const editorKey = `agent:${preset.id}`;
    onEditorStateChange(editorKey, {
      editorKey,
      dirty: isDirty,
      pending: saving,
      save: saveDraft,
    });
    return () => onEditorStateChange(editorKey, null);
  }, [isDirty, onEditorStateChange, preset.id, saveDraft, saving]);

  const attemptCancel = useCallback(() => {
    if (saving) return;
    onCancel();
  }, [saving, onCancel]);

  /* Keyboard shortcuts: Cmd/Ctrl+S to save, Esc to cancel */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const formEl = panelRef.current;
      if (!formEl) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && !formEl.contains(active)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!submitDisabled) {
          formEl.requestSubmit();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        attemptCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submitDisabled, attemptCancel]);

  const useDefaultMemory = () => {
    setMemoryMarkdown(defaultMemoryInstruction);
  };

  const memoryIsDefault =
    memoryMarkdown.trim() === defaultMemoryInstruction.trim() && defaultMemoryInstruction.trim().length > 0;
  const memoryConfigSummary = useMemo(() => formatMemoryConfigSummary(
    memoryConfig,
    t,
    (_key, count) => translatePlural(agentsMessages, "categoryCount", count),
    (value) => formatNumber(value),
  ), [memoryConfig, t, translatePlural, formatNumber]);

  const instructionLength = instructionMarkdown.length;
  const instructionOver = instructionLength > INSTRUCTION_SOFT_MAX;
  const instructionTokens = estimateTokens(instructionMarkdown);
  const memoryTokens = estimateTokens(memoryMarkdown);
  const selectedProvider = providerOptions.find((option) => option.value === providerConfigId) || null;

  const mcpItems = useMemo(() => ([
    {
      id: "code_ux",
      label: isDashboardReplyAgent && !mcpAccess.codeUxEnabled ? `Code UX · ${t("runtime")}` : "Code UX",
      active: mcpAccess.codeUxEnabled,
      kind: "code_ux" as const,
    },
    ...availableMcpServers.map((server) => ({
      id: server.id,
      label: server.label || server.name,
      active: mcpAccess.linkedServerIds.includes(server.id),
      kind: "custom" as const,
    })),
  ]), [mcpAccess, availableMcpServers, isDashboardReplyAgent, t]);
  const visibleMcpItems = mcpItems.slice(0, 5);
  const hiddenMcpCount = mcpItems.length - visibleMcpItems.length;
  const activeMcpCount = mcpItems.filter((item) => item.active).length;
  const persistentSkillsActive = persistentSkillsEnabled && persistentSkillStorageIds.length > 0;

  const toggleMcpItem = (item: (typeof mcpItems)[number]): void => {
    if (item.kind === "code_ux" && !item.active) {
      setMcpModalOpen(true);
      setActionStatus({
        tone: isDashboardReplyAgent ? "neutral" : "error",
        message: isDashboardReplyAgent
          ? t("reviewDashboardMcp")
          : t("reviewRiskMcp"),
      });
      return;
    }
    setActionStatus({
      tone: "success",
      message: t("mcpItemChanged", { name: item.label, state: t(item.active ? "stateDisabled" : "stateEnabled") }),
    });
    if (item.kind === "code_ux") {
      setMcpAccessNormalized({ ...mcpAccess, codeUxEnabled: !item.active });
    } else {
      setMcpAccessNormalized({
        ...mcpAccess,
        linkedServerIds: item.active
          ? mcpAccess.linkedServerIds.filter((id) => id !== item.id)
          : [...mcpAccess.linkedServerIds, item.id],
      });
    }
  };

  const actionStatusClass = {
    neutral: "border-black/[0.06] bg-white/50 text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400",
    success: "border-status-green/20 bg-status-green/[0.08] text-status-green",
    error: "border-status-red/20 bg-status-red/[0.08] text-status-red",
    pending: "border-signal-500/25 bg-signal-500/[0.08] text-signal-600 dark:text-signal-400",
  }[actionStatus.tone];

  return (
    <>
      <form
        ref={panelRef}
        onSubmit={handleSubmit}
        noValidate
        aria-label={t("editAgentAria", { name: preset.name })}
        data-motion-contract="selectionMovement"
        data-editor-selected="true"
        className="relative flex flex-col overflow-hidden rounded-[1.9rem] border border-signal-500/20 bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-signal-500/[0.06] backdrop-blur-2xl dark:border-signal-500/20 dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
      >
        <BorderTrace accentHex={accentHex} />

        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-20 flex flex-col gap-4 border-b border-black/[0.05] bg-white/75 px-6 py-5 backdrop-blur-2xl md:flex-row md:items-center md:justify-between md:px-8 md:py-6 dark:border-white/[0.05] dark:bg-void-800/70">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
              <Sparkles className="h-3 w-3" strokeWidth={2.4} />
              {t("editingAgent")}
              {isDirty && !saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-amber-600 dark:text-amber-400">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  {t("unsaved")}
                </span>
              )}
              {!isDirty && !saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/60 px-2 py-0.5 text-[9px] tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  {t("saved")}
                </span>
              )}
              {saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-signal-600 dark:text-signal-400">
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
                  {t("saving")}
                </span>
              )}
            </div>
            <h2 className="truncate font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {name.trim() || t("unnamedAgent")}
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="hidden font-mono text-[10px] text-slate-400 dark:text-slate-500 md:inline">
              {t("shortcutSaveCancel", { saveShortcut: isMac ? "⌘S" : "Ctrl+S" })}
            </span>
            <button
              type="button"
              onClick={attemptCancel}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/40 px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600 backdrop-blur-md transition-colors hover:bg-white/70 hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              aria-disabled={submitDisabled}
              aria-busy={saving}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white dark:text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:scale-100 dark:disabled:bg-white/[0.05] dark:disabled:text-slate-500"
            >
              {saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
              {t("saveAgent")}
            </button>
          </div>
          {submitDisabled && !saving && (
            <p className="mt-2 text-right text-[11px] text-slate-500">
              {t(hasErrors ? "fixErrorsToSave" : "noChanges")}
            </p>
          )}
          <div
            role={actionStatus.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            data-motion-contract={actionStatus.tone === "error" ? "inlineValidation" : "asyncFeedback"}
            style={{
              transitionDuration: actionStatus.tone === "error" ? interactionTokens.inlineValidation.duration : interactionTokens.asyncFeedback.duration,
              transitionTimingFunction: actionStatus.tone === "error" ? interactionTokens.inlineValidation.ease : interactionTokens.asyncFeedback.ease,
            }}
            className={`min-h-[2rem] rounded-full border px-3 py-1.5 text-[11px] font-semibold ${actionStatusClass}`}
          >
            {actionStatus.message}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col gap-6 p-6 md:p-8">
          {/* Row 1 — profile identity + live appearance customizer */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionCard icon={UserRound} eyebrow={t("profile")} title={t("identity")}>
              <AgentAvatarStage
                config={avatarConfig}
                expression={avatarExpression}
                accentHex={accentHex}
                onExpressionChange={setAvatarExpression}
                onRandomize={saving ? undefined : handleRandomizeAvatar}
                heightClass="h-full"
                className="min-h-[260px] flex-1"
                disabled={saving}
              />
              <FieldShell
                icon={Tag}
                label={t("agentName")}
                htmlFor="agent-name"
                helper={t("agentNameHelper")}
                required
                counter={`${formatNumber(name.length)}/${formatNumber(NAME_MAX)}`}
                error={touched.name ? errors.name : undefined}
                errorId="agent-name-error"
              >
                <input
                  ref={nameRef}
                  id="agent-name"
                  type="text"
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  placeholder={t("namePlaceholder")}
                  maxLength={NAME_MAX + 20}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={touched.name && !!errors.name}
                  aria-errormessage={touched.name && errors.name ? "agent-name-error" : undefined}
                  className={`rounded-2xl border bg-white/40 px-4 py-3 text-base font-medium text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15 ${
                    touched.name && errors.name
                      ? "border-status-red/50"
                      : "border-black/[0.05] dark:border-white/[0.07]"
                  }`}
                />
              </FieldShell>

              <FieldShell
                icon={FileText}
                label={t("shortDescription")}
                htmlFor="agent-description"
                helper={t("descriptionHelper")}
                counter={`${formatNumber(description.length)}/${formatNumber(DESCRIPTION_MAX)}`}
                error={touched.description ? errors.description : undefined}
                errorId="agent-description-error"
              >
                <textarea
                  ref={descriptionRef}
                  id="agent-description"
                  value={description}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  onBlur={() => setTouched((t) => ({ ...t, description: true }))}
                  placeholder={t("descriptionPlaceholder")}
                  rows={3}
                  maxLength={DESCRIPTION_MAX + 60}
                  aria-invalid={touched.description && !!errors.description}
                  aria-errormessage={touched.description && errors.description ? "agent-description-error" : undefined}
                  className={`block w-full resize-none rounded-2xl border bg-white/40 px-4 py-3 text-[13px] leading-relaxed text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15 ${
                    touched.description && errors.description
                      ? "border-status-red/50"
                      : "border-black/[0.05] dark:border-white/[0.07]"
                  }`}
                />
              </FieldShell>
            </SectionCard>

            <SectionCard icon={Palette} eyebrow={t("appearance")} title={t("customize")}>
              <AgentAvatarCustomizer
                config={avatarConfig || {}}
                onChange={(next) => {
                  setAvatarConfig(next);
                  setActionStatus({ tone: "success", message: t("avatarChangedSave") });
                }}
                disabled={saving}
              />
            </SectionCard>
          </div>

          {/* Row 2 — behavior (full width for long prompts) */}
          <SectionCard icon={FileText} eyebrow={t("behavior")} title={t("systemPromptMemory")}>
              <FieldShell
                icon={FileText}
                label={t("systemInstructions")}
                htmlFor="agent-instructions"
                helper={t("instructionsHelper")}
                counter={t("characterTokenCount", { characters: formatNumber(instructionLength), tokens: formatTokenCount(instructionTokens, locale) })}
                error={touched.instruction ? errors.instruction : undefined}
                errorId="agent-instructions-error"
              >
                <div ref={instructionHostRef}>
                  <MarkdownEditorField
                    key={`instructions-${preset.id}`}
                    id="agent-instructions"
                    value={instructionMarkdown}
                    onChange={setInstructionMarkdown}
                    onBlur={() => setTouched((t) => ({ ...t, instruction: true }))}
                    placeholder={t("instructionsPlaceholder")}
                    minRows={8}
                    minHeightClass="min-h-[14rem]"
                    invalid={touched.instruction && !!errors.instruction}
                    ariaErrorId={touched.instruction && errors.instruction ? "agent-instructions-error" : undefined}
                    emptyPreviewHint={t("noInstructionsPreview")}
                    toolbarNote={instructionOver ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
                        {t("longPrompt")}
                      </span>
                    ) : undefined}
                  />
                </div>
                {instructionOver && !errors.instruction && (
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
                    {t("instructionLengthWarning", { count: formatNumber(instructionLength), limit: formatNumber(INSTRUCTION_SOFT_MAX) })}
                  </p>
                )}
              </FieldShell>

              {/* Memory override */}
              <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                    <BrainCircuit className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                          {t("memoryTemplateOverride")}
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("memoryTemplateHelper")}
                        </p>
                      </div>
                      <label className="relative inline-flex cursor-pointer shrink-0 items-center">
                        <input
                          type="checkbox"
                          aria-label={t("enableMemoryTemplateOverride")}
                          checked={memoryOverrideEnabled}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setMemoryOverrideEnabled(checked);
                            if (checked && memoryMarkdown.trim() === "") {
                              setMemoryMarkdown(defaultMemoryInstruction);
                            }
                          }}
                          className="peer sr-only"
                          disabled={saving}
                        />
                        <div className="h-6 w-11 rounded-full border border-black/[0.08] bg-slate-200 transition-colors peer-checked:border-signal-500/40 peer-checked:bg-signal-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-void-800" />
                        <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all peer-checked:translate-x-5 peer-checked:bg-signal-500 dark:bg-slate-500 dark:peer-checked:bg-signal-400" />
                      </label>
                    </div>
                  </div>
                </div>

                {memoryOverrideEnabled && (
                  <div className="flex flex-col gap-2 pl-13">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="agent-memory"
                        className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
                      >
                        {t("memoryTemplateMarkdown")}
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-slate-400 dark:text-slate-500">
                          {t("characterTokenCount", { characters: formatNumber(memoryMarkdown.length), tokens: formatTokenCount(memoryTokens, locale) })}
                        </span>
                        {memoryIsDefault && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            {t("default")}
                          </span>
                        )}
                        {!memoryIsDefault && defaultMemoryInstruction.trim().length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              useDefaultMemory();
                              setActionStatus({ tone: "success", message: t("memoryResetSave") });
                            }}
                            disabled={saving}
                            className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                          >
                            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
                            {t("resetToDefault")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div ref={memoryHostRef}>
                      <MarkdownEditorField
                        key={`memory-${preset.id}`}
                        id="agent-memory"
                        value={memoryMarkdown}
                        onChange={setMemoryMarkdown}
                        onBlur={() => setTouched((t) => ({ ...t, memory: true }))}
                        placeholder={t("memoryOverridePlaceholder")}
                        minRows={5}
                        minHeightClass="min-h-[10rem]"
                        invalid={touched.memory && !!errors.memory}
                        ariaErrorId={touched.memory && errors.memory ? "agent-memory-error" : undefined}
                        emptyPreviewHint={t("noMemoryPreview")}
                      />
                    </div>
                    {touched.memory && errors.memory && (
                      <p
                        id="agent-memory-error"
                        role="alert"
                        className="flex items-center gap-1.5 text-[11px] font-medium text-status-red"
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
                        {errors.memory}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3 pl-13">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {t("memoryInjectionFilters")}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {t("memoryFiltersBody")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Popover
                        isOpen={showMemoryPanel}
                        onOpenChange={(open) => {
                          if (!saving) {
                            setShowMemoryPanel(open);
                          }
                        }}
                        position="bottom"
                        align="end"
                        triggerRef={memoryButtonRef}
                        className="w-[min(440px,92vw)] overflow-hidden p-0"
                        content={
                          <AgentMemoryConfigPanel
                            value={memoryConfig}
                            onChange={(next) => {
                              setMemoryConfig(next);
                              setActionStatus({ tone: "success", message: t("memoryFiltersSave") });
                            }}
                            onClose={() => setShowMemoryPanel(false)}
                            disabled={saving}
                          />
                        }
                      >
                        <button
                          ref={memoryButtonRef}
                          type="button"
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                        >
                          <SlidersHorizontal className="h-3 w-3" strokeWidth={2.4} />
                          {t("manageMemory")}
                        </button>
                      </Popover>
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/60 px-3 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                        <BrainCircuit className="h-3 w-3 shrink-0" strokeWidth={2.4} />
                        <span className="truncate">{memoryConfigSummary}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

          <SectionCard icon={Database} eyebrow={t("persistentSkills")} title={t("storageAttachments")}>
            <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    {t("persistentSkillRetrieval")}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("persistentSkillBody")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${persistentSkillsActive ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"}`}>
                    {t(persistentSkillsActive ? "enabled" : "defaultOff")}
                  </span>
                  <label className="relative inline-flex cursor-pointer shrink-0 items-center">
                    <input
                      type="checkbox"
                      aria-label={t("enablePersistentSkills")}
                      checked={persistentSkillsEnabled}
                      disabled={saving || persistentSkillStorageIds.length === 0}
                      onChange={(event) => setPersistentSkillsEnabled(event.currentTarget.checked)}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-11 rounded-full border border-black/[0.08] bg-slate-200 transition-colors peer-checked:border-signal-500/40 peer-checked:bg-signal-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-signal-500/30 peer-disabled:opacity-50 dark:border-white/[0.08] dark:bg-void-800" />
                    <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all peer-checked:translate-x-5 peer-checked:bg-signal-500 dark:bg-slate-500 dark:peer-checked:bg-signal-400" />
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableSkillStorages.length === 0 ? (
                  <div className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                    {t("noSkillStorages")}
                  </div>
                ) : availableSkillStorages.map((storage) => {
                  const checked = persistentSkillStorageIds.includes(storage.id);
                  const toggleStorageAttachment = (): void => {
                    if (saving) return;
                    const nextIds = checked
                      ? persistentSkillStorageIds.filter((id) => id !== storage.id)
                      : [...persistentSkillStorageIds, storage.id];
                    setPersistentSkillStorageIds(nextIds);
                    if (nextIds.length === 0) {
                      setPersistentSkillsEnabled(false);
                    }
                  };
                  return (
                    <div
                      key={storage.id}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors ${checked ? "border-signal-500/30 bg-signal-500/[0.1] text-signal-800 dark:text-signal-100" : "border-black/[0.06] bg-black/[0.02] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300"}`}
                    >
                      <label className="inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          aria-label={storage.name}
                          checked={checked}
                          disabled={saving}
                          onChange={toggleStorageAttachment}
                          className="h-4 w-4 rounded border-black/20 text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)]"
                        />
                        {!checked ? (
                          <PersistentSkillStorageChip
                            storage={storage}
                            attached={false}
                            className="border-0 bg-transparent px-0 text-slate-600 dark:bg-transparent dark:text-slate-300"
                          />
                        ) : null}
                      </label>
                      {checked ? (
                        <PersistentSkillStorageChip
                          storage={storage}
                          className="border-0 bg-transparent px-0 dark:bg-transparent"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          {/* Knowledge subscriptions */}
          <SectionCard icon={Library} eyebrow={t("grounding")} title={t("knowledgeBase")}>
            <p className="-mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t("knowledgeSubscriptionsBody")}
            </p>
            <AgentKnowledgePanel
              agentPresetId={preset.id}
              projectId={preset.projectId}
              disabled={saving}
              onSubscriptionsChanged={() => setKnowledgeDirty(true)}
            />
          </SectionCard>

          {/* Row 3 — routing + connected tools */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard icon={Route} eyebrow={t("routing")} title={t("providerModel")}>
              <div className="rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">
                    <Route className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {t("optionalProvider")}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {t("optionalProviderBody")}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <FieldShell icon={Cpu} label={t("providerInstance")} helper={t("providerInstanceHelper")}>
                    <AvantgardeSelect
                      aria-label={t("providerInstance")}
                      value={providerConfigId}
                      onChange={(next) => {
                        setProviderConfigId(next);
                        setModel("");
                      }}
                      disabled={saving || providerOptions.length === 0}
                      placeholder={t("inheritRouteDefault")}
                      options={[
                        {
                          value: "",
                          label: t("inheritRouteDefault"),
                          icon: <Route className="h-4 w-4 text-slate-400" strokeWidth={2.2} />,
                        },
                        ...providerOptions.map((option) => ({
                          value: option.value,
                          label: `${option.label}${option.enabled ? "" : ` (${t("paused")})`}`,
                          icon: <ProviderBrandIcon id={option.provider} disabled={!option.enabled} className="h-5 w-5 rounded-md" imageClassName="h-3 w-3" />,
                        })),
                      ]}
                    />
                  </FieldShell>

                  {selectedProvider ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.035]">
                      <ProviderBrandIcon id={selectedProvider.provider} disabled={!selectedProvider.enabled} className="h-9 w-9 rounded-xl" imageClassName="h-5 w-5" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{selectedProvider.label}</div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{selectedProvider.model || t("defaultModel")}</div>
                      </div>
                    </div>
                  ) : null}

                  <FieldShell icon={Sparkles} label={t("modelOverride")} htmlFor="agent-model" helper={t("modelOverrideHelper")}>
                    <input
                      id="agent-model"
                      type="text"
                      value={model}
                      onInput={(event) => setModel(event.currentTarget.value)}
                      disabled={saving || !providerConfigId}
                      placeholder={selectedProvider?.model || t("inherited")}
                      className="rounded-2xl border border-black/[0.05] bg-white/40 px-5 py-3 shadow-sm text-[13px] font-medium text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15"
                    />
                  </FieldShell>

                  <FieldShell
                    icon={ShieldCheck}
                    label={t("dockerRootMode")}
                    helper={t("dockerRootBody")}
                  >
                    <div role="radiogroup" aria-label={t("agentDockerRootMode")} className="grid gap-2 sm:grid-cols-3">
                      {CONTAINER_ROOT_MODE_OPTIONS.map((option) => {
                        const active = containerRootMode === option.value;
                        return (
                          <label
                            key={option.value}
                            className={`relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-2xl border px-4 py-3 transition-colors ${
                              active
                                ? option.value === "root"
                                  ? "border-status-red/30 bg-status-red/[0.08] text-status-red"
                                  : "border-signal-500/30 bg-signal-500/[0.1] text-signal-700 dark:text-signal-200"
                                : "border-black/[0.06] bg-white/50 text-slate-600 hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`container-root-mode-${preset.id}`}
                              value={option.value}
                              checked={active}
                              disabled={saving}
                              aria-label={t(option.ariaLabelKey)}
                              onChange={() => {
                                setContainerRootMode(option.value);
                                setActionStatus({ tone: "success", message: t("dockerRootChanged") });
                              }}
                              className="peer sr-only"
                            />
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal-500">
                              {t(option.labelKey)}
                            </span>
                            <span className={`text-[11px] leading-relaxed ${active ? "text-current/75" : "text-slate-400 dark:text-slate-500"}`}>
                              {t(option.hintKey)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </FieldShell>
                </div>
              </div>
            </SectionCard>
            <SectionCard icon={Plug} eyebrow={t("tools")} title={t("connectedMcps")}>
              <div className="rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">
                    <Plug className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {t("mcpServers")}
                      </div>
                      <Popover
                        isOpen={mcpModalOpen}
                        onOpenChange={(open) => { if (!saving) setMcpModalOpen(open); }}
                        position="bottom"
                        align="end"
                        className="w-[min(440px,92vw)] overflow-hidden p-0"
                        content={(
                          <AgentMcpManagePanel
                            value={mcpAccess}
                            onChange={(next) => {
                              setMcpAccessNormalized(next);
                              setActionStatus({ tone: "success", message: t("mcpPending") });
                            }}
                            availableServers={availableMcpServers}
                            isDashboardReplyAgent={isDashboardReplyAgent}
                            onClose={() => setMcpModalOpen(false)}
                          />
                        )}
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white ${saving ? "pointer-events-none opacity-50" : ""}`}
                        >
                          <Settings2 className="h-3 w-3" strokeWidth={2.4} />
                          {t("manage")}
                        </span>
                      </Popover>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {t("mcpActiveSummary", { count: formatNumber(activeMcpCount) })}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {visibleMcpItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleMcpItem(item)}
                      disabled={saving}
                      aria-pressed={item.active}
                      aria-label={`${item.label} ${t(item.active ? "enabled" : "disabled")}`}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 ${
                        item.active
                          ? "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-200"
                          : "border-black/[0.08] bg-white/50 text-slate-400 hover:text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500 dark:hover:text-slate-300"
                      }`}
                    >
                      {item.active
                        ? <Check className="h-3 w-3" strokeWidth={3} />
                        : <Plug className="h-3 w-3" strokeWidth={2.4} />}
                      {item.label}
                      <span className="rounded-full border border-current/20 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em]">
                        {t(item.active ? "enabled" : "disabled")}
                      </span>
                    </button>
                  ))}
                  {hiddenMcpCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setMcpModalOpen(true)}
                      disabled={saving}
                      className="inline-flex items-center rounded-full border border-black/[0.08] bg-white/50 px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-colors hover:text-slate-600 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                    >
                      {t("moreCount", { count: formatNumber(hiddenMcpCount) })}
                    </button>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Agent metadata footer */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/20 px-4 py-3 text-[10px] font-mono text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.01] dark:text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-3 w-3" strokeWidth={2.2} />
              {t("createdAt", { date: formatDate(new Date(preset.createdAt)) })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t("updatedAt", { date: formatDate(new Date(preset.updatedAt)) })}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">id {preset.id}</span>
          </div>
        </div>
      </form>

    </>
  );
};
