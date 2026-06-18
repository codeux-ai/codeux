import type { ComponentChildren, FunctionComponent } from "preact";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import type { ProviderId } from "../../../types.js";

import { Toggle as UiToggle } from "../ui/Toggle.js";
import { Input as UiInput } from "../ui/Input.js";

export const Toggle = UiToggle;

export const SelectInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; icon?: ComponentChildren | (() => ComponentChildren) }>;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}> = ({ value, onChange, options, disabled, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby }) => (
  <div className="min-w-[220px]">
    <AvantgardeSelect value={value} onChange={onChange} options={options} disabled={disabled} aria-label={ariaLabel} aria-labelledby={ariaLabelledby} />
  </div>
);

export const PillChoiceGroup: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  disabled?: boolean;
}> = ({ value, onChange, options, disabled }) => (
  <div className="flex flex-wrap gap-2">
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`group relative min-w-[104px] overflow-hidden rounded-[1rem] border px-4 py-2 text-left transition-[border-color,background-color,color,transform,box-shadow] duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 ${
            active
              ? "border-signal-500/30 bg-signal-500/[0.11] text-signal-700 shadow-[0_10px_20px_rgba(0,224,160,0.08)] hover:bg-signal-500/[0.15] dark:border-signal-400/30 dark:bg-signal-400/[0.12] dark:text-signal-200 dark:hover:bg-signal-400/[0.16]"
              : "border-black/[0.06] bg-white/70 text-slate-600 hover:-translate-y-px hover:border-black/[0.12] hover:bg-black/[0.02] hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.08] dark:hover:text-white"
          }`}
        >
          <div
            className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-signal-500 dark:bg-signal-400 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              active ? "opacity-100 transform-none" : "opacity-0 -translate-x-full"
            }`}
          />
          <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{option.label}</div>
          {option.hint ? (
            <div className={`mt-1 text-[11px] leading-relaxed transition-colors duration-200 ${active ? "text-signal-600/80 dark:text-signal-300/80" : "text-slate-400 dark:text-slate-500"}`}>
              {option.hint}
            </div>
          ) : null}
        </button>
      );
    })}
  </div>
);

export const ProviderLogo: FunctionComponent<{
  providerId: ProviderId | string;
  disabled?: boolean;
}> = ({ providerId, disabled = false }) => (
  <ProviderBrandIcon id={providerId} disabled={disabled} />
);

export const TextInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
}> = ({ value, onChange, placeholder, mono, disabled, "aria-label": ariaLabel, "aria-description": ariaDescription }) => (
  <UiInput
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    aria-label={ariaLabel}
    aria-description={ariaDescription}
    onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
    className={mono ? "font-mono" : "font-sans"}
  />
);

export const TextAreaInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  "aria-label"?: string;
  "aria-description"?: string;
}> = ({ value, onChange, placeholder, rows = 12, "aria-label": ariaLabel, "aria-description": ariaDescription }) => (
  <textarea
    value={value}
    rows={rows}
    placeholder={placeholder}
    aria-label={ariaLabel}
    aria-description={ariaDescription}
    onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
    className="min-h-[320px] w-full rounded-[1rem] border border-black/[0.06] hover:border-black/[0.12] bg-black/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-700 placeholder-slate-400 transition-colors duration-200 focus:border-signal-500/40 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 focus:ring-0 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-white/[0.04] dark:text-slate-200"
  />
);

export const NumberInput: FunctionComponent<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
}> = ({ value, onChange, min, max, step = 1, disabled, "aria-label": ariaLabel, "aria-description": ariaDescription }) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    aria-label={ariaLabel}
    aria-description={ariaDescription}
    onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
    className="w-32 rounded-[1rem] border border-black/[0.06] hover:border-black/[0.12] bg-white/80 px-3.5 py-2.5 text-sm font-mono text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[border-color,box-shadow,background-color] duration-200 focus:border-signal-500/40 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-white/[0.05] dark:text-slate-200"
  />
);

export const MetricPill: FunctionComponent<{
  label: string;
  value: string;
  tone?: "neutral" | "signal";
}> = ({ label, value, tone = "neutral" }) => (
  <div className={`rounded-[1rem] border px-3 py-2 ${
    tone === "signal"
      ? "border-signal-500/20 bg-signal-500/[0.08] dark:border-signal-400/20 dark:bg-signal-400/[0.1]"
      : "border-black/[0.06] bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03]"
  }`}
  >
    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className={`mt-1 text-sm font-semibold ${
      tone === "signal" ? "text-signal-700 dark:text-signal-200" : "text-slate-800 dark:text-slate-100"
    }`}
    >
      {value}
    </div>
  </div>
);

export const Row: FunctionComponent<{
  label: string;
  description?: string;
  children: ComponentChildren;
  last?: boolean;
  badge?: ComponentChildren;
  info?: ComponentChildren;
  onReset?: () => void;
}> = ({ label, description, children, last, badge, info, onReset }) => (
  <div
    className={`group flex flex-col gap-4 rounded-[1.35rem] border border-black/[0.05] hover:border-black/[0.1] bg-black/[0.02] hover:bg-black/[0.03] px-4 py-4 md:flex-row md:items-start md:justify-between transition-colors duration-200 ${!last ? "" : ""} dark:border-white/[0.05] dark:hover:border-white/[0.1] dark:bg-white/[0.02] dark:hover:bg-white/[0.03]`}
  >
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold leading-snug text-slate-800 group-hover:text-slate-900 dark:text-slate-100 dark:group-hover:text-white transition-colors duration-200">{label}</div>
          {info ? info : null}
        </div>
        {badge && typeof badge === "string" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
            {badge}
            {onReset && badge === "Project override" ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                title="Delete project override (revert to system default)"
                className="ml-1 rounded-full p-0.5 text-amber-600 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-300/25 dark:hover:text-amber-100 transition-colors duration-150 cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" className="h-2.5 w-2.5">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            ) : null}
          </span>
        ) : badge}
      </div>
      {description ? (
        <div className="mt-0.5 text-xs font-medium leading-relaxed text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-400 transition-colors duration-200">{description}</div>
      ) : null}
    </div>
    <div className="w-full shrink-0 md:w-auto md:max-w-[34rem] lg:max-w-none">
      {children}
    </div>
  </div>
);

export const Card: FunctionComponent<{ title: string; description: string; badge?: string; children: ComponentChildren }> = ({
  title,
  description,
  badge,
  children,
}) => (
  <section className="rounded-[2rem] border border-black/[0.06] bg-white/72 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
      <div>
        <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {badge ? (
        <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
          {badge}
        </span>
      ) : null}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);
