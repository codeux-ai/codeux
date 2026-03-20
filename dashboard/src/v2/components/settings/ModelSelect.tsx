import type { FunctionComponent } from "preact";
import { Bot, Brain, ChevronDown, Cpu, Sparkles, Zap } from "lucide-preact";

export type ModelProvider = "jules" | "gemini" | "codex" | "claude-code" | "virtual-worker";

export interface ModelSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ModelSelectOption[];
  provider: ModelProvider;
  mode?: "strict" | "freeform";
  disabled?: boolean;
  inputId?: string;
  placeholder?: string;
}

interface ProviderVisual {
  label: string;
  toneClassName: string;
  iconToneClassName: string;
  Icon: typeof Cpu;
}

const providerVisuals: Record<ModelProvider, ProviderVisual> = {
  jules: {
    label: "Jules",
    toneClassName: "border-signal-500/25 bg-signal-500/[0.08]",
    iconToneClassName: "text-signal-600 dark:text-signal-300",
    Icon: Sparkles,
  },
  gemini: {
    label: "Gemini",
    toneClassName: "border-sky-500/20 bg-sky-500/[0.08]",
    iconToneClassName: "text-sky-600 dark:text-sky-300",
    Icon: Zap,
  },
  codex: {
    label: "Codex",
    toneClassName: "border-emerald-500/20 bg-emerald-500/[0.08]",
    iconToneClassName: "text-emerald-600 dark:text-emerald-300",
    Icon: Cpu,
  },
  "claude-code": {
    label: "Claude Code",
    toneClassName: "border-orange-500/20 bg-orange-500/[0.08]",
    iconToneClassName: "text-orange-600 dark:text-orange-300",
    Icon: Brain,
  },
  "virtual-worker": {
    label: "Virtual Worker",
    toneClassName: "border-fuchsia-500/20 bg-fuchsia-500/[0.08]",
    iconToneClassName: "text-fuchsia-600 dark:text-fuchsia-300",
    Icon: Bot,
  },
};

const joinClasses = (...tokens: Array<string | undefined | false>): string => tokens.filter(Boolean).join(" ");

export const ModelSelect: FunctionComponent<ModelSelectProps> = ({
  value,
  onChange,
  options,
  provider,
  mode = "strict",
  disabled = false,
  inputId,
  placeholder = "Select a model",
}) => {
  const selectedOption = options.find((option) => option.value === value);
  const visual = providerVisuals[provider];
  const Icon = visual.Icon;
  const dataListId = inputId ? `${inputId}-options` : undefined;

  return (
    <div className="w-full min-w-[15rem]">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={joinClasses(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]",
            visual.toneClassName,
            visual.iconToneClassName,
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
          {visual.label}
        </span>
      </div>

      {mode === "freeform" ? (
        <div className="rounded-2xl focus-within:ring-2 focus-within:ring-signal-500/20">
          <input
            id={inputId}
            type="text"
            value={value}
            list={dataListId}
            disabled={disabled}
            placeholder={placeholder}
            onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
            className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-sm font-mono text-slate-700 outline-none transition-colors focus:border-signal-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-void-900 dark:text-slate-200"
          />
          {dataListId ? (
            <datalist id={dataListId}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </datalist>
          ) : null}
        </div>
      ) : (
        <div className="relative rounded-2xl focus-within:ring-2 focus-within:ring-signal-500/20">
          <select
            id={inputId}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
            className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 py-2 transition-colors dark:border-white/[0.08] dark:bg-void-900">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {(selectedOption?.label ?? value) || placeholder}
              </div>
              <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {selectedOption?.description ?? "Pick a model for this provider route."}
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.2} />
          </div>
        </div>
      )}

      {mode === "freeform" ? (
        <div className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {selectedOption?.description ?? "Use a recommended model or enter a custom model identifier."}
        </div>
      ) : null}
    </div>
  );
};
