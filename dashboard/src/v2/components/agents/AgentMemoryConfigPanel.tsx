import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { BrainCircuit, Check, ChevronDown, ChevronUp, X } from "lucide-preact";
import { DEFAULT_AGENT_MEMORY_CONFIG, MEMORY_CATEGORIES, type AgentMemoryConfig, type MemoryCategory } from "../../memory-types.js";

export interface AgentMemoryConfigPanelProps {
  onClose: () => void;
  value: AgentMemoryConfig;
  onChange: (next: AgentMemoryConfig) => void;
  disabled?: boolean;
}

const TIER_OPTIONS: Array<{ value: AgentMemoryConfig["tier"]; label: string }> = [
  { value: "short_term", label: "Short Term" },
  { value: "both", label: "Both" },
  { value: "long_term", label: "Long Term" },
];

const MAX_STRENGTH = 1;
const MIN_STRENGTH = 0;
const STRENGTH_STEP = 0.05;

const toTitleCase = (value: string): string =>
  value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const clampStrength = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, value));
};

const formatPercent = (value: number): string => `${Math.round(clampStrength(value) * 100)}%`;

const areStrengthsEqual = (left: number, right: number): boolean => Math.abs(left - right) < 1e-9;

const formatMemoryCount = (value: number): string => (value === 0 ? "" : String(value));

const parseMemoryCount = (raw: string): number | null => {
  if (raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
};

const isCategoryEnabled = (categories: MemoryCategory[], category: MemoryCategory): boolean =>
  categories.length === 0 || categories.includes(category);

const getVisibleCategories = (categories: MemoryCategory[]): MemoryCategory[] =>
  categories.length === 0 ? MEMORY_CATEGORIES : MEMORY_CATEGORIES.filter((category) => categories.includes(category));

const updateCategorySelection = (categories: MemoryCategory[], category: MemoryCategory): MemoryCategory[] => {
  if (categories.length === 0) {
    return MEMORY_CATEGORIES.filter((entry) => entry !== category);
  }

  const next = categories.includes(category)
    ? categories.filter((entry) => entry !== category)
    : [...categories, category];

  return next.length === MEMORY_CATEGORIES.length ? [] : next;
};

const updatePerCategoryStrength = (
  config: AgentMemoryConfig,
  category: MemoryCategory,
  nextStrength: number
): Pick<AgentMemoryConfig, "minStrengthPerCategory"> => {
  const normalized = clampStrength(nextStrength);
  const nextOverrides = { ...config.minStrengthPerCategory };

  if (areStrengthsEqual(normalized, config.minStrength)) {
    delete nextOverrides[category];
  } else {
    nextOverrides[category] = normalized;
  }

  return { minStrengthPerCategory: nextOverrides };
};

export const AgentMemoryConfigPanel: FunctionComponent<AgentMemoryConfigPanelProps> = ({
  onClose,
  value,
  onChange,
  disabled = false,
}) => {
  const [showOverrides, setShowOverrides] = useState(false);

  const visibleCategories = useMemo(() => getVisibleCategories(value.categories), [value.categories]);

  const setTier = (tier: AgentMemoryConfig["tier"]): void => {
    if (disabled || value.tier === tier) return;
    onChange({ ...value, tier });
  };

  const setCategories = (category: MemoryCategory): void => {
    if (disabled) return;
    onChange({ ...value, categories: updateCategorySelection(value.categories, category) });
  };

  const setMinStrength = (nextStrength: number): void => {
    if (disabled) return;

    const normalized = clampStrength(nextStrength);
    const nextOverrides = { ...value.minStrengthPerCategory };

    for (const category of MEMORY_CATEGORIES) {
      const override = nextOverrides[category];
      if (override !== undefined && areStrengthsEqual(override, normalized)) {
        delete nextOverrides[category];
      }
    }

    onChange({
      ...value,
      minStrength: normalized,
      minStrengthPerCategory: nextOverrides,
    });
  };

  const setCategoryStrength = (category: MemoryCategory, nextStrength: number): void => {
    if (disabled || !isCategoryEnabled(value.categories, category)) return;
    onChange({
      ...value,
      ...updatePerCategoryStrength(value, category, nextStrength),
    });
  };

  const setMaxCount = (field: "maxShortTerm" | "maxLongTerm", raw: string): void => {
    if (disabled) return;
    const parsed = parseMemoryCount(raw);
    if (parsed === null) return;
    onChange({
      ...value,
      [field]: parsed,
    });
  };

  const resetToDefaults = (): void => {
    if (disabled) return;
    onChange({
      ...DEFAULT_AGENT_MEMORY_CONFIG,
      categories: [],
      minStrengthPerCategory: {},
    });
  };

  return (
    <div className="flex max-h-[min(78vh,560px)] w-[min(440px,92vw)] flex-col overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.05] bg-white/75 px-5 py-4 backdrop-blur-2xl dark:border-white/[0.05] dark:bg-void-800/70">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
            <BrainCircuit className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
              Agents & Memory
            </div>
            <h2 className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white">
              Memory Injection
            </h2>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={disabled}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white/60 text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          >
            Defaults
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <section className="rounded-2xl border border-black/[0.05] bg-white/35 p-4 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                Tier
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                Choose whether this agent receives short-term, long-term, or both memory scopes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/50 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            {TIER_OPTIONS.map((option) => {
              const active = value.tier === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTier(option.value)}
                  aria-pressed={active}
                  disabled={disabled}
                  className={`inline-flex flex-1 items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                    active
                      ? "bg-signal-500 text-void-900 shadow-[0_0_12px_rgba(0,224,160,0.25)]"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.05] bg-white/35 p-4 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                Categories
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                Empty means all categories are included.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (disabled) return;
                onChange({ ...value, categories: [] });
              }}
              disabled={disabled}
              className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              Select All
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MEMORY_CATEGORIES.map((category) => {
              const selected = isCategoryEnabled(value.categories, category);
              const label = toTitleCase(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategories(category)}
                  aria-pressed={selected}
                  disabled={disabled}
                  className={`inline-flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left text-[11px] font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "border-signal-500/30 bg-signal-500/10 text-signal-700 dark:border-signal-500/25 dark:bg-signal-500/15 dark:text-signal-300"
                      : "border-black/[0.06] bg-white/50 text-slate-500 hover:border-signal-500/20 hover:text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <span className="min-w-0 truncate">{label}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.8} />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.05] bg-white/35 p-4 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                Minimum Strength
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                0% means no minimum.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowOverrides((current) => !current)}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
              aria-expanded={showOverrides}
            >
              Per-category overrides
              {showOverrides ? <ChevronUp className="h-3 w-3" strokeWidth={2.4} /> : <ChevronDown className="h-3 w-3" strokeWidth={2.4} />}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-black/[0.05] bg-white/45 p-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="agent-memory-min-strength" className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  Global minimum
                </label>
                <span className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {formatPercent(value.minStrength)}
                </span>
              </div>
              <input
                id="agent-memory-min-strength"
                type="range"
                min={MIN_STRENGTH}
                max={MAX_STRENGTH}
                step={STRENGTH_STEP}
                value={value.minStrength}
                disabled={disabled}
                onInput={(event) => setMinStrength(Number((event.currentTarget as HTMLInputElement).value))}
                aria-label="Minimum strength"
                className="w-full accent-signal-500"
              />
            </div>

            {showOverrides && (
              <div className="flex flex-col gap-2">
                {visibleCategories.map((category) => {
                  const override = value.minStrengthPerCategory[category] ?? value.minStrength;
                  const label = toTitleCase(category);
                  const inputId = `agent-memory-min-strength-${category}`;
                  return (
                    <div
                      key={category}
                      className="rounded-2xl border border-black/[0.05] bg-white/40 p-3 dark:border-white/[0.05] dark:bg-white/[0.03]"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label htmlFor={inputId} className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                          {label}
                        </label>
                        <span className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          {formatPercent(override)}
                        </span>
                      </div>
                      <input
                        id={inputId}
                        type="range"
                        min={MIN_STRENGTH}
                        max={MAX_STRENGTH}
                        step={STRENGTH_STEP}
                        value={override}
                        disabled={disabled}
                        onInput={(event) => setCategoryStrength(category, Number((event.currentTarget as HTMLInputElement).value))}
                        aria-label={`${label} minimum strength`}
                        className="w-full accent-signal-500"
                      />
                    </div>
                  );
                })}

                {visibleCategories.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/30 px-4 py-3 text-[12px] leading-relaxed text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-slate-500">
                    No categories selected for injection.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.05] bg-white/35 p-4 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="mb-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Max Memories
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              Use 0 for unlimited.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                Max Short Term
              </span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={formatMemoryCount(value.maxShortTerm)}
                placeholder="Unlimited"
                disabled={disabled}
                onInput={(event) => setMaxCount("maxShortTerm", event.currentTarget.value)}
                aria-label="Max Short Term"
                className="rounded-2xl border border-black/[0.05] bg-white/45 px-4 py-3 text-[13px] font-medium text-slate-900 outline-none transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                Max Long Term
              </span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={formatMemoryCount(value.maxLongTerm)}
                placeholder="Unlimited"
                disabled={disabled}
                onInput={(event) => setMaxCount("maxLongTerm", event.currentTarget.value)}
                aria-label="Max Long Term"
                className="rounded-2xl border border-black/[0.05] bg-white/45 px-4 py-3 text-[13px] font-medium text-slate-900 outline-none transition-all placeholder-slate-400 focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-white dark:placeholder-slate-600 dark:focus:ring-signal-500/15"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};
