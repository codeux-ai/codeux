import type { FunctionComponent, JSX } from "preact";
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "preact/hooks";
import gsap from "gsap";
import {
  Save,
  X,
  RefreshCw,
  AlertCircle,
  Tag,
  Hash,
  FileText,
  BrainCircuit,
  Sparkles,
  Plus,
  Check,
} from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarCustomizer } from "./AgentAvatarCustomizer.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { getAccentHex } from "../../lib/agent-avatar.js";
import { estimateTokens, formatTokenCount } from "../../lib/token-estimate.js";

/* ─────────────────────────────────────────────────────────
 * Validation rules
 * ──────────────────────────────────────────────────────── */
const NAME_MAX = 60;
const LABEL_MAX = 24;
const LABEL_COUNT_MAX = 12;
const INSTRUCTION_SOFT_MAX = 8000;

type FormErrors = Partial<Record<"name" | "labels" | "instruction" | "memory", string>>;

function validate({
  name,
  labels,
  instruction,
  memoryEnabled,
  memory,
}: {
  name: string;
  labels: string[];
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

  if (labels.length > LABEL_COUNT_MAX) {
    errors.labels = `Use at most ${LABEL_COUNT_MAX} labels`;
  } else if (labels.some((l) => l.length > LABEL_MAX)) {
    errors.labels = `Each label must be ${LABEL_MAX} characters or fewer`;
  } else if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
    errors.labels = "Duplicate labels are not allowed";
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
 * Label chip input
 * ──────────────────────────────────────────────────────── */
const LabelChipInput: FunctionComponent<{
  labels: string[];
  onChange: (next: string[]) => void;
  accentHex: string;
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
}> = ({ labels, onChange, accentHex, disabled, errorId, invalid }) => {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      if (labels.some((l) => l.toLowerCase() === value.toLowerCase())) {
        setDraft("");
        return;
      }
      onChange([...labels, value]);
      setDraft("");
    },
    [labels, onChange]
  );

  const handleKey = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Tab" && draft.trim()) {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && labels.length > 0) {
      event.preventDefault();
      onChange(labels.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (draft.trim()) commit(draft);
  };

  const removeAt = (index: number) => {
    onChange(labels.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const containerClass = useMemo(() => {
    return [
      "flex flex-wrap items-center gap-1.5 rounded-2xl border bg-white/40 px-3 py-2 backdrop-blur-md transition-all focus-within:border-signal-500 focus-within:ring-4 focus-within:ring-signal-500/10 dark:bg-white/[0.03] dark:focus-within:ring-signal-500/15",
      invalid
        ? "border-status-red/50"
        : "border-black/[0.05] dark:border-white/[0.07]",
      disabled ? "opacity-60" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [invalid, disabled]);

  return (
    <div className={containerClass} onClick={() => inputRef.current?.focus()}>
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className="group/chip inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-bold transition-colors"
          style={{ backgroundColor: `${accentHex}15`, color: accentHex }}
        >
          <span className="max-w-[10rem] truncate">{label}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              removeAt(index);
            }}
            disabled={disabled}
            aria-label={`Remove label ${label}`}
            className="flex h-4 w-4 items-center justify-center rounded-full opacity-50 transition-all hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        disabled={disabled || labels.length >= LABEL_COUNT_MAX}
        placeholder={labels.length === 0 ? "Type a label and press Enter" : "Add another…"}
        aria-invalid={invalid || undefined}
        aria-errormessage={errorId}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-[13px] font-medium text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-white dark:placeholder:text-slate-600"
      />
    </div>
  );
};

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
  eyebrow: string;
  title: string;
  children: preact.ComponentChildren;
}> = ({ eyebrow, title, children }) => (
  <section className="relative flex flex-col gap-5 rounded-[1.6rem] border border-black/[0.05] bg-white/40 p-6 backdrop-blur-xl dark:border-white/[0.05] dark:bg-white/[0.025]">
    <header className="flex flex-col gap-1.5 border-b border-black/[0.04] pb-4 dark:border-white/[0.04]">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">
        {eyebrow}
      </span>
      <h3 className="font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
        {title}
      </h3>
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
  onSave: (id: string, updates: Partial<AgentPreset>) => void;
  onCancel: () => void;
}> = ({ preset, saving, defaultMemoryInstruction = "", onSave, onCancel }) => {
  const panelRef = useRef<HTMLFormElement>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const memoryRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState(preset.name);
  const [labels, setLabels] = useState<string[]>(preset.labels);
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const [memoryOverrideEnabled, setMemoryOverrideEnabled] = useState(
    !!preset.memoryTemplateOverrideEnabled
  );
  const [memoryMarkdown, setMemoryMarkdown] = useState(preset.memoryTemplateMarkdown ?? "");
  const [avatarConfig, setAvatarConfig] = useState(preset.avatarConfig);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [discardOpen, setDiscardOpen] = useState(false);

  const accentHex = getAccentHex(avatarConfig?.accent);

  /* Reset when preset switches */
  useEffect(() => {
    setName(preset.name);
    setLabels(preset.labels);
    setInstructionMarkdown(preset.instructionMarkdown);
    setMemoryOverrideEnabled(!!preset.memoryTemplateOverrideEnabled);
    setMemoryMarkdown(preset.memoryTemplateMarkdown ?? "");
    setAvatarConfig(preset.avatarConfig);
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
        labels,
        instruction: instructionMarkdown,
        memoryEnabled: memoryOverrideEnabled,
        memory: memoryMarkdown,
      }),
    [name, labels, instructionMarkdown, memoryOverrideEnabled, memoryMarkdown]
  );

  const hasErrors = Object.keys(errors).length > 0;

  const isDirty = useMemo(() => {
    if (name !== preset.name) return true;
    const presetLabels = preset.labels.join("|");
    if (labels.join("|") !== presetLabels) return true;
    if (instructionMarkdown !== preset.instructionMarkdown) return true;
    if (memoryOverrideEnabled !== !!preset.memoryTemplateOverrideEnabled) return true;
    if ((preset.memoryTemplateMarkdown ?? "") !== memoryMarkdown && memoryOverrideEnabled) return true;
    if (JSON.stringify(avatarConfig ?? {}) !== JSON.stringify(preset.avatarConfig ?? {})) return true;
    return false;
  }, [
    name,
    labels,
    instructionMarkdown,
    memoryOverrideEnabled,
    memoryMarkdown,
    avatarConfig,
    preset,
  ]);

  const submitDisabled = saving || hasErrors || !isDirty;

  /* Submit */
  const handleSubmit = (event: Event) => {
    event.preventDefault();
    setTouched({ name: true, labels: true, instruction: true, memory: true });
    if (hasErrors || !isDirty) return;
    onSave(preset.id, {
      name: name.trim(),
      labels,
      instructionMarkdown,
      memoryTemplateOverrideEnabled: memoryOverrideEnabled,
      memoryTemplateMarkdown: memoryOverrideEnabled ? memoryMarkdown : undefined,
      avatarConfig,
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
        <div className="grid grid-cols-1 gap-6 p-6 md:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left column: form sections */}
          <div className="flex min-w-0 flex-col gap-5">
            <SectionCard eyebrow="Step 1" title="Identity">
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
                icon={Hash}
                label="Labels"
                helper="Tag this agent for routing — e.g. planning, review, runtime. Press Enter or comma to add."
                counter={`${labels.length}/${LABEL_COUNT_MAX}`}
                error={touched.labels ? errors.labels : undefined}
                errorId="agent-labels-error"
              >
                <LabelChipInput
                  labels={labels}
                  onChange={(next) => {
                    setLabels(next);
                    setTouched((t) => ({ ...t, labels: true }));
                  }}
                  accentHex={accentHex}
                  disabled={saving}
                  invalid={touched.labels && !!errors.labels}
                  errorId="agent-labels-error"
                />
              </FieldShell>
            </SectionCard>

            <SectionCard eyebrow="Step 2" title="Behavior">
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

          {/* Right column: avatar */}
          <div className="flex min-w-0 flex-col gap-5">
            <SectionCard eyebrow="Step 3" title="Avatar">
              <AgentAvatarCustomizer
                config={avatarConfig || {}}
                onChange={setAvatarConfig}
                disabled={saving}
              />
            </SectionCard>
          </div>
        </div>
      </form>

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
