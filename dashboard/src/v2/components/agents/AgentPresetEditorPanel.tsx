import type { FunctionComponent, JSX } from "preact";
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
} from "lucide-preact";
import type { AgentMcpAccessConfig, AgentPreset, CustomMcpServer } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AgentAvatarCustomizer } from "./AgentAvatarCustomizer.js";
import { AgentAvatarStage } from "./AgentAvatarStage.js";
import { AgentMcpManageModal } from "./AgentMcpManageModal.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { getAccentHex, generateRandomAgentAvatar } from "../../lib/agent-avatar.js";
import { defaultAgentMcpAccess, normalizeAgentMcpAccess } from "../../lib/agent-mcp-display.js";
import { estimateTokens, formatTokenCount } from "../../lib/token-estimate.js";

/* ─────────────────────────────────────────────────────────
 * Validation rules
 * ──────────────────────────────────────────────────────── */
const NAME_MAX = 60;
const DESCRIPTION_MAX = 180;
const INSTRUCTION_SOFT_MAX = 8000;

type FormErrors = Partial<Record<"name" | "description" | "instruction" | "memory", string>>;

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
}): FormErrors {
  const errors: FormErrors = {};
  const trimmedName = name.trim();
  if (!trimmedName) {
    errors.name = "Name is required";
  } else if (trimmedName.length > NAME_MAX) {
    errors.name = `Name must be ${NAME_MAX} characters or fewer`;
  }

  if (description.trim().length > DESCRIPTION_MAX) {
    errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer`;
  }

  if (instruction.length > INSTRUCTION_SOFT_MAX * 1.5) {
    errors.instruction = `Instructions exceed safe limit (${instruction.length.toLocaleString()} / ${(INSTRUCTION_SOFT_MAX * 1.5).toLocaleString()})`;
  }

  if (memoryEnabled && memory.trim().length === 0) {
    errors.memory = "Provide an override or disable the toggle";
  }

  return errors;
}

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
        <span className="font-mono text-[10px] font-bold text-slate-400 dark:text-slate-500">
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
          <h3 className="font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
            {title}
          </h3>
        </div>
      </div>
      {action}
    </header>
    {children}
  </section>
);

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
  onSave: (id: string, updates: Partial<AgentPreset>) => void;
  onCancel: () => void;
}> = ({ preset, saving, defaultMemoryInstruction = "", providerOptions = [], availableMcpServers = [], onSave, onCancel }) => {
  const panelRef = useRef<HTMLFormElement>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const memoryRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description || "");
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const [memoryOverrideEnabled, setMemoryOverrideEnabled] = useState(
    !!preset.memoryTemplateOverrideEnabled
  );
  const [memoryMarkdown, setMemoryMarkdown] = useState(preset.memoryTemplateMarkdown ?? "");
  const [providerConfigId, setProviderConfigId] = useState(preset.providerConfigId || "");
  const [model, setModel] = useState(preset.model || "");
  const [avatarConfig, setAvatarConfig] = useState(preset.avatarConfig);
  const [mcpAccess, setMcpAccess] = useState<AgentMcpAccessConfig>(
    normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess())
  );
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [avatarExpression, setAvatarExpression] = useState<AgentAvatarExpression>("happy");

  const setMcpAccessNormalized = (next: AgentMcpAccessConfig): void => setMcpAccess(normalizeAgentMcpAccess(next));

  const accentHex = getAccentHex(avatarConfig?.accent);

  const handleRandomizeAvatar = (): void => {
    const seed = Date.now().toString(36) + Math.random().toString(36).substring(2);
    setAvatarConfig(generateRandomAgentAvatar(seed));
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
    setAvatarConfig(preset.avatarConfig);
    setMcpAccess(normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess()));
    setTouched({});
  }, [preset.id]);

  /* Entry animation */
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(panelRef.current, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" });
  }, [preset.id]);

  /* Auto-grow textareas after preset change */
  useEffect(() => {
    const grow = (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
    };
    grow(instructionRef.current);
    grow(memoryRef.current);
  }, [preset.id, memoryOverrideEnabled]);

  const handleTextareaInput = (
    setter: (value: string) => void
  ) => (event: JSX.TargetedEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
    setter(el.value);
  };

  /* Validation + dirty tracking */
  const errors = useMemo(
    () =>
      validate({
        name,
        description,
        instruction: instructionMarkdown,
        memoryEnabled: memoryOverrideEnabled,
        memory: memoryMarkdown,
      }),
    [name, description, instructionMarkdown, memoryOverrideEnabled, memoryMarkdown]
  );

  const hasErrors = Object.keys(errors).length > 0;

  const isDirty = useMemo(() => {
    if (name !== preset.name) return true;
    if (description !== (preset.description || "")) return true;
    if (instructionMarkdown !== preset.instructionMarkdown) return true;
    if (memoryOverrideEnabled !== !!preset.memoryTemplateOverrideEnabled) return true;
    if ((preset.memoryTemplateMarkdown ?? "") !== memoryMarkdown && memoryOverrideEnabled) return true;
    if (providerConfigId !== (preset.providerConfigId || "")) return true;
    if (model !== (preset.model || "")) return true;
    if (JSON.stringify(avatarConfig ?? {}) !== JSON.stringify(preset.avatarConfig ?? {})) return true;
    if (JSON.stringify(mcpAccess) !== JSON.stringify(normalizeAgentMcpAccess(preset.mcpAccess ?? defaultAgentMcpAccess()))) return true;
    return false;
  }, [
    name,
    description,
    instructionMarkdown,
    memoryOverrideEnabled,
    memoryMarkdown,
    providerConfigId,
    model,
    avatarConfig,
    mcpAccess,
    preset,
  ]);

  const submitDisabled = saving || hasErrors || !isDirty;

  /* Submit */
  const handleSubmit = (event: Event) => {
    event.preventDefault();
    setTouched({ name: true, description: true, instruction: true, memory: true });
    if (hasErrors || !isDirty) return;
    onSave(preset.id, {
      name: name.trim(),
      description: description.trim(),
      instructionMarkdown,
      memoryTemplateOverrideEnabled: memoryOverrideEnabled,
      memoryTemplateMarkdown: memoryOverrideEnabled ? memoryMarkdown : undefined,
      providerConfigId: providerConfigId || null,
      model: model.trim() || null,
      avatarConfig,
      mcpAccess,
    });
  };

  const attemptCancel = useCallback(() => {
    if (saving) return;
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onCancel();
    }
  }, [saving, isDirty, onCancel]);

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

  const instructionLength = instructionMarkdown.length;
  const instructionOver = instructionLength > INSTRUCTION_SOFT_MAX;
  const instructionTokens = estimateTokens(instructionMarkdown);
  const memoryTokens = estimateTokens(memoryMarkdown);
  const selectedProvider = providerOptions.find((option) => option.value === providerConfigId) || null;

  const mcpItems = useMemo(() => ([
    { id: "code_ux", label: "Code UX", active: mcpAccess.codeUxEnabled, kind: "code_ux" as const },
    ...availableMcpServers.map((server) => ({
      id: server.id,
      label: server.label || server.name,
      active: mcpAccess.linkedServerIds.includes(server.id),
      kind: "custom" as const,
    })),
  ]), [mcpAccess, availableMcpServers]);
  const visibleMcpItems = mcpItems.slice(0, 5);
  const hiddenMcpCount = mcpItems.length - visibleMcpItems.length;
  const activeMcpCount = mcpItems.filter((item) => item.active).length;

  const toggleMcpItem = (item: (typeof mcpItems)[number]): void => {
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

  return (
    <>
      <form
        ref={panelRef}
        onSubmit={handleSubmit}
        noValidate
        aria-label={`Edit ${preset.name}`}
        className="relative flex flex-col overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
      >
        <BorderTrace accentHex={accentHex} />

        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-20 flex flex-col gap-4 border-b border-black/[0.05] bg-white/75 px-6 py-5 backdrop-blur-2xl md:flex-row md:items-center md:justify-between md:px-8 md:py-6 dark:border-white/[0.05] dark:bg-void-800/70">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
              <Sparkles className="h-3 w-3" strokeWidth={2.4} />
              Editing Agent
              {isDirty && !saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-amber-600 dark:text-amber-400">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  Unsaved
                </span>
              )}
              {!isDirty && !saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/60 px-2 py-0.5 text-[9px] tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  Saved
                </span>
              )}
              {saving && (
                <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/30 bg-signal-500/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-signal-600 dark:text-signal-400">
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
                  Saving
                </span>
              )}
            </div>
            <h2 className="truncate font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {name.trim() || "Unnamed Agent"}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden font-mono text-[10px] text-slate-400 dark:text-slate-500 md:inline">
              {isMac ? "⌘S" : "Ctrl+S"} to save · Esc to cancel
            </span>
            <button
              type="button"
              onClick={attemptCancel}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/40 px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-600 backdrop-blur-md transition-colors hover:bg-white/70 hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              aria-disabled={submitDisabled}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:scale-100 dark:disabled:bg-white/[0.05] dark:disabled:text-slate-500"
            >
              {saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={2.4} />
              )}
              Save Agent
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col gap-6 p-6 md:p-8">
          {/* Row 1 — profile identity + live appearance customizer */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionCard icon={UserRound} eyebrow="Profile" title="Identity">
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
                label="Agent Name"
                htmlFor="agent-name"
                helper="Shown across the dashboard, sprints, and worker logs."
                required
                counter={`${name.length}/${NAME_MAX}`}
                error={touched.name ? errors.name : undefined}
                errorId="agent-name-error"
              >
                <input
                  id="agent-name"
                  type="text"
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  placeholder="e.g. Planning Agent"
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
                label="Short Description"
                htmlFor="agent-description"
                helper="Used by the Planning agent when it chooses the best coding specialist for each task."
                counter={`${description.length}/${DESCRIPTION_MAX}`}
                error={touched.description ? errors.description : undefined}
                errorId="agent-description-error"
              >
                <textarea
                  id="agent-description"
                  value={description}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  onBlur={() => setTouched((t) => ({ ...t, description: true }))}
                  placeholder="e.g. Frontend specialist for Preact, Tailwind, responsive UI, and accessibility work."
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

            <SectionCard icon={Palette} eyebrow="Appearance" title="Customize">
              <AgentAvatarCustomizer
                config={avatarConfig || {}}
                onChange={setAvatarConfig}
                disabled={saving}
              />
            </SectionCard>
          </div>

          {/* Row 2 — behavior (full width for long prompts) */}
          <SectionCard icon={FileText} eyebrow="Behavior" title="System Prompt & Memory">
              <FieldShell
                icon={FileText}
                label="System Instructions"
                htmlFor="agent-instructions"
                helper="Markdown is supported. This becomes the system prompt prepended to every conversation."
                counter={`${instructionLength.toLocaleString()} chars · ~${formatTokenCount(instructionTokens)} tok`}
                error={touched.instruction ? errors.instruction : undefined}
                errorId="agent-instructions-error"
              >
                <div className="relative">
                  <textarea
                    ref={instructionRef}
                    id="agent-instructions"
                    value={instructionMarkdown}
                    onInput={handleTextareaInput(setInstructionMarkdown)}
                    onBlur={() => setTouched((t) => ({ ...t, instruction: true }))}
                    placeholder={"You are a planning specialist. Decompose user goals into clear, testable subtasks…"}
                    rows={8}
                    aria-invalid={touched.instruction && !!errors.instruction}
                    aria-errormessage={touched.instruction && errors.instruction ? "agent-instructions-error" : undefined}
                    className={`block w-full resize-none rounded-2xl border bg-white/40 px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15 ${
                      touched.instruction && errors.instruction
                        ? "border-status-red/50"
                        : "border-black/[0.05] dark:border-white/[0.07]"
                    }`}
                  />
                  <span
                    className={`absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                      instructionOver
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-400"
                        : "border-black/[0.06] bg-white/60 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500"
                    }`}
                  >
                    MD
                  </span>
                </div>
                {instructionOver && !errors.instruction && (
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
                    {instructionLength.toLocaleString()} characters exceeds the recommended {INSTRUCTION_SOFT_MAX.toLocaleString()} — long prompts increase latency and cost.
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
                          Memory Template Override
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                          Replace the project default with a bespoke memory prompt for this agent only.
                        </p>
                      </div>
                      <label className="relative inline-flex cursor-pointer shrink-0 items-center">
                        <input
                          type="checkbox"
                          aria-label="Enable Memory Template Override"
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
                        Memory Template Markdown
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-slate-400 dark:text-slate-500">
                          {memoryMarkdown.length.toLocaleString()} chars · ~{formatTokenCount(memoryTokens)} tok
                        </span>
                        {memoryIsDefault && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-signal-500/20 bg-signal-500/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            Default
                          </span>
                        )}
                        {!memoryIsDefault && defaultMemoryInstruction.trim().length > 0 && (
                          <button
                            type="button"
                            onClick={useDefaultMemory}
                            disabled={saving}
                            className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                          >
                            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
                            Reset to default
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      ref={memoryRef}
                      id="agent-memory"
                      value={memoryMarkdown}
                      onInput={handleTextareaInput(setMemoryMarkdown)}
                      onBlur={() => setTouched((t) => ({ ...t, memory: true }))}
                      placeholder="Override the default memory prompt template for this agent."
                      rows={5}
                      aria-invalid={touched.memory && !!errors.memory}
                      aria-errormessage={touched.memory && errors.memory ? "agent-memory-error" : undefined}
                      className={`block w-full resize-none rounded-2xl border bg-white/40 px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15 ${
                        touched.memory && errors.memory
                          ? "border-status-red/50"
                          : "border-black/[0.05] dark:border-white/[0.07]"
                      }`}
                    />
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
              </div>
            </SectionCard>

          {/* Row 3 — routing + connected tools */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard icon={Route} eyebrow="Routing" title="Provider & Model">
              <div className="rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">
                    <Route className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      Optional Agent Provider
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      Used only when a route is set to the Agent strategy. Blank agents inherit that route's primary instance.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <FieldShell icon={Cpu} label="Provider Instance" htmlFor="agent-provider" helper="Leave unset to inherit route, worker, or global defaults.">
                    <select
                      id="agent-provider"
                      value={providerConfigId}
                      onChange={(event) => {
                        const nextProviderConfigId = event.currentTarget.value;
                        setProviderConfigId(nextProviderConfigId);
                        setModel("");
                      }}
                      disabled={saving || providerOptions.length === 0}
                      className="rounded-2xl border border-black/[0.05] bg-white/40 px-4 py-3 text-[13px] font-medium text-slate-900 outline-none backdrop-blur-md transition-all focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:focus:ring-signal-500/15"
                    >
                      <option value="">Inherit route default</option>
                      {providerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}{option.enabled ? "" : " (paused)"}
                        </option>
                      ))}
                    </select>
                  </FieldShell>

                  {selectedProvider ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.035]">
                      <ProviderBrandIcon id={selectedProvider.provider} disabled={!selectedProvider.enabled} className="h-9 w-9 rounded-xl" imageClassName="h-5 w-5" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{selectedProvider.label}</div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{selectedProvider.model || "default model"}</div>
                      </div>
                    </div>
                  ) : null}

                  <FieldShell icon={Sparkles} label="Model Override" htmlFor="agent-model" helper="Optional. Leave blank to use the selected provider instance model.">
                    <input
                      id="agent-model"
                      type="text"
                      value={model}
                      onInput={(event) => setModel(event.currentTarget.value)}
                      disabled={saving || !providerConfigId}
                      placeholder={selectedProvider?.model || "Inherited"}
                      className="rounded-2xl border border-black/[0.05] bg-white/40 px-4 py-3 text-[13px] font-medium text-slate-900 outline-none backdrop-blur-md transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15"
                    />
                  </FieldShell>
                </div>
              </div>
            </SectionCard>
            <SectionCard icon={Plug} eyebrow="Tools" title="Connected MCPs">
              <div className="rounded-2xl border border-black/[0.05] bg-white/30 p-5 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-slate-500 dark:bg-white/[0.04] dark:text-slate-300">
                    <Plug className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        MCP Servers
                      </div>
                      <button
                        type="button"
                        onClick={() => setMcpModalOpen(true)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                      >
                        <Settings2 className="h-3 w-3" strokeWidth={2.4} />
                        Manage
                      </button>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      Tap to link or unlink. {activeMcpCount} active. Use Manage to configure Code UX tools.
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
                    </button>
                  ))}
                  {hiddenMcpCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setMcpModalOpen(true)}
                      disabled={saving}
                      className="inline-flex items-center rounded-full border border-black/[0.08] bg-white/50 px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-colors hover:text-slate-600 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                    >
                      +{hiddenMcpCount} more
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
              Created {new Date(preset.createdAt).toLocaleDateString()}
            </span>
            <span aria-hidden="true">·</span>
            <span>Updated {new Date(preset.updatedAt).toLocaleDateString()}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">id {preset.id}</span>
          </div>
        </div>
      </form>

      <AgentMcpManageModal
        isOpen={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        value={mcpAccess}
        onChange={setMcpAccessNormalized}
        availableServers={availableMcpServers}
      />

      <ConfirmDialog
        isOpen={discardOpen}
        options={{
          title: "Discard unsaved changes?",
          body: "Your edits to this agent will be lost. This action can't be undone.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          destructive: true,
        }}
        onConfirm={() => {
          setDiscardOpen(false);
          onCancel();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
};
