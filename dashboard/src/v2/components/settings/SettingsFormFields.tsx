import type { ComponentChildren, FunctionComponent } from "preact";
import { createContext } from "preact";
import { useContext, useId } from "preact/hooks";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { PROVIDER_CARD_TOKENS } from "../../lib/settings-view-models.js";
import type { ProjectSettings } from "../../../types.js";

interface FormRowContextValue {
  labelId?: string;
  descriptionId?: string;
  id?: string;
}

const FormRowContext = createContext<FormRowContextValue>({});

export const Toggle: FunctionComponent<{
  value: boolean;
  onChange: (value: boolean) => void;
  danger?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}> = ({ value, onChange, danger, disabled, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby }) => {
  const { labelId } = useContext(FormRowContext);
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`group relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-[background-color,box-shadow,border-color] duration-300 focus:outline-none focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed disabled:opacity-60 ${
        value
          ? danger
            ? "border-status-red/40 bg-status-red shadow-[0_0_16px_rgba(227,0,15,0.24)]"
            : "border-signal-500/40 bg-signal-500 shadow-[0_0_16px_rgba(0,224,160,0.22)]"
          : "border-black/[0.08] bg-black/[0.08] dark:border-white/[0.08] dark:bg-white/[0.08]"
      }`}
      aria-pressed={value}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby || labelId}
    >
      <span
        aria-hidden
        className={`absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0))] transition-opacity ${value ? "opacity-100" : "opacity-40"}`}
      />
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_7px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-out ${
          value ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
};

export const SelectInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}> = ({ value, onChange, options, disabled, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby }) => {
  const { labelId } = useContext(FormRowContext);
  return (
    <div className="min-w-[220px]">
      <AvantgardeSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby || labelId}
      />
    </div>
  );
};

export const PillChoiceGroup: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}> = ({ value, onChange, options, disabled, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby }) => {
  const { labelId } = useContext(FormRowContext);
  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby || labelId}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-w-[104px] rounded-[1rem] border px-3.5 py-2 text-left transition-[border-color,background-color,color,transform,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? "border-signal-500/30 bg-signal-500/[0.11] text-signal-700 shadow-[0_10px_20px_rgba(0,224,160,0.08)] dark:border-signal-400/30 dark:bg-signal-400/[0.12] dark:text-signal-200"
                : "border-black/[0.07] bg-white/78 text-slate-600 hover:-translate-y-px hover:border-black/[0.12] hover:text-slate-800 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/[0.12] dark:hover:text-white"
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{option.label}</div>
            {option.hint ? (
              <div className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                {option.hint}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export const ProviderLogo: FunctionComponent<{
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

export const TextInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}> = ({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
  required,
  id: providedId,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}) => {
  const { id: contextId, labelId, descriptionId } = useContext(FormRowContext);
  const id = providedId || contextId;
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      aria-required={required}
      aria-invalid={ariaInvalid}
      aria-labelledby={!id ? labelId : undefined}
      aria-describedby={ariaDescribedby || descriptionId}
      onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
      className={`min-w-[220px] rounded-[1rem] border border-black/[0.07] bg-white/88 px-3.5 py-2.5 text-sm text-slate-700 placeholder-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[border-color,box-shadow,background-color] duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.07] dark:bg-white/[0.05] dark:text-slate-200 ${
        mono ? "font-mono" : "font-sans"
      }`}
    />
  );
};

export const TextAreaInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}> = ({
  value,
  onChange,
  placeholder,
  rows = 12,
  required,
  id: providedId,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}) => {
  const { id: contextId, labelId, descriptionId } = useContext(FormRowContext);
  const id = providedId || contextId;
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      required={required}
      aria-required={required}
      aria-invalid={ariaInvalid}
      aria-labelledby={!id ? labelId : undefined}
      aria-describedby={ariaDescribedby || descriptionId}
      onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
      className="min-h-[320px] w-full rounded-[1.3rem] border border-black/[0.06] bg-black/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-700 placeholder-slate-400 transition-colors duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-200"
    />
  );
};

export const NumberInput: FunctionComponent<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  required,
  id: providedId,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}) => {
  const { id: contextId, labelId, descriptionId } = useContext(FormRowContext);
  const id = providedId || contextId;
  return (
    <input
      id={id}
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      required={required}
      aria-required={required}
      aria-invalid={ariaInvalid}
      aria-labelledby={!id ? labelId : undefined}
      aria-describedby={ariaDescribedby || descriptionId}
      onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
      className="w-32 rounded-[1rem] border border-black/[0.07] bg-white/88 px-3.5 py-2.5 text-sm font-mono text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[border-color,box-shadow,background-color] duration-200 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.07] dark:bg-white/[0.05] dark:text-slate-200"
    />
  );
};

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
    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
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
  id?: string;
}> = ({ label, description, children, last, badge, id: providedId }) => {
  const baseId = providedId || useId();
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;

  return (
    <FormRowContext.Provider value={{ id: baseId, labelId, descriptionId }}>
      <div
        className={`flex flex-col gap-4 rounded-[1.35rem] border border-black/[0.05] bg-black/[0.02] px-4 py-4 md:flex-row md:items-start md:justify-between ${!last ? "" : ""} dark:border-white/[0.05] dark:bg-white/[0.02]`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label
              id={labelId}
              htmlFor={baseId}
              className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100"
            >
              {label}
            </label>
            {badge && typeof badge === "string" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                  !
                </span>
                {badge}
              </span>
            ) : badge}
          </div>
          {description ? (
            <div
              id={descriptionId}
              className="mt-0.5 text-xs font-medium leading-relaxed text-slate-400"
            >
              {description}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 rounded-[1.15rem] border border-black/[0.05] bg-white/75 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-white/[0.05] dark:bg-white/[0.04]">
          {children}
        </div>
      </div>
    </FormRowContext.Provider>
  );
};

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

