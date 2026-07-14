import type { ComponentChildren, FunctionComponent } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { Eye, EyeOff } from "lucide-preact";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import type { ProviderId } from "../../../types.js";

import { Toggle as UiToggle } from "../ui/Toggle.js";
import { Input as UiInput } from "../ui/Input.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export const Toggle = UiToggle;

export interface SettingsOptionCard {
  value: string;
  label: string;
  description?: string;
  countLabel?: string;
  icon?: ComponentChildren | (() => ComponentChildren);
  disabled?: boolean;
  disabledReason?: string;
  "aria-label"?: string;
}

type SharedOptionCardGroupProps = {
  options: SettingsOptionCard[];
  disabled?: boolean;
  helperText?: string;
  selectedSummaryLabel?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

type SingleOptionCardGroupProps = SharedOptionCardGroupProps & {
  selectionMode?: "single";
  value: string;
  onChange: (value: string) => void;
};

type MultipleOptionCardGroupProps = SharedOptionCardGroupProps & {
  selectionMode: "multiple";
  value: string[];
  onChange: (value: string[]) => void;
};

export type OptionCardChoiceGroupProps = SingleOptionCardGroupProps | MultipleOptionCardGroupProps;

function renderSettingsOptionIcon(icon: SettingsOptionCard["icon"]): ComponentChildren {
  return typeof icon === "function" ? icon() : icon;
}

export const SelectInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; icon?: ComponentChildren | (() => ComponentChildren) }>;
  disabled?: boolean;
  disabledReason?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}> = ({ value, onChange, options, disabled, disabledReason, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby, "aria-describedby": ariaDescribedby }) => {
  const generatedId = useId();
  const disabledReasonId = disabled && disabledReason ? `${generatedId}-disabled-reason` : undefined;
  const describedBy = [ariaDescribedby, disabledReasonId].filter(Boolean).join(" ") || undefined;

  return (
  <div className="min-w-0 w-full sm:min-w-[220px]">
    <AvantgardeSelect value={value} onChange={onChange} options={options} disabled={disabled} aria-label={ariaLabel} aria-labelledby={ariaLabelledby} aria-describedby={describedBy} />
    {disabledReasonId ? (
      <div id={disabledReasonId} className="mt-1.5 text-xs font-semibold leading-relaxed text-amber-700 dark:text-amber-200">
        {disabledReason}
      </div>
    ) : null}
  </div>
  );
};

export const PillChoiceGroup: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  disabled?: boolean;
  invalid?: boolean;
  valid?: boolean;
  busy?: boolean;
  helperText?: string;
  errorText?: string;
  forceValidation?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}> = ({ value, onChange, options, disabled, invalid, valid, busy, helperText, errorText, forceValidation, "aria-label": ariaLabel = "Setting choices", "aria-labelledby": ariaLabelledby, "aria-describedby": ariaDescribedby }) => {
  const generatedId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tokens = useInteractionTokens();
  const showError = Boolean(errorText && (invalid || forceValidation));
  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const validId = valid && !showError ? `${generatedId}-valid` : undefined;
  const describedBy = [showError ? errorId : helperId, validId, ariaDescribedby].filter(Boolean).join(" ") || undefined;

  const moveSelection = (currentIndex: number, offset: number): void => {
    if (!options.length || disabled) {
      return;
    }
    const nextIndex = (currentIndex + offset + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
    onChange(options[nextIndex].value);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label={ariaLabelledby ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-invalid={showError || invalid ? "true" : undefined}
        aria-errormessage={showError ? errorId : undefined}
        aria-describedby={describedBy}
        aria-busy={busy ? "true" : undefined}
        className="flex min-w-0 flex-wrap gap-2"
      >
        {options.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={active}
              aria-describedby={describedBy}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelection(index, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelection(index, -1);
                }
              }}
              style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
              className={`group relative min-w-[104px] max-w-full overflow-hidden rounded-[1rem] border px-4 py-2 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:active:scale-[0.98] ${
                showError || invalid
                  ? "border-status-red/60 bg-status-red/[0.04] text-status-red hover:bg-status-red/[0.08]"
                  : active
                    ? "border-signal-500/30 bg-signal-500/[0.11] text-signal-700 shadow-[0_10px_20px_rgba(0,224,160,0.08)] hover:bg-signal-500/[0.15] dark:border-signal-400/30 dark:bg-signal-400/[0.12] dark:text-signal-200 dark:hover:bg-signal-400/[0.16]"
                    : "border-black/[0.06] bg-white/70 text-slate-600 hover:-translate-y-px hover:border-black/[0.12] hover:bg-black/[0.02] hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.08] dark:hover:text-white"
              }`}
            >
              <div
                className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-signal-500 dark:bg-signal-400 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                  active ? "opacity-100 transform-none" : "opacity-0 -translate-x-full"
                }`}
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
              />
              <div className="break-words text-[11px] font-bold uppercase tracking-[0.14em]">{option.label}</div>
              {option.hint ? (
                <div
                  className={`mt-1 break-words text-[11px] leading-relaxed transition-colors ${active ? "text-signal-600/80 dark:text-signal-300/80" : "text-slate-400 dark:text-slate-500"}`}
                  style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
                >
                  {option.hint}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      {showError ? (
        <span id={errorId} className="text-xs font-medium text-status-red motion-safe:animate-form-slide-down motion-reduce:animate-none" role="alert" style={{ animationDuration: tokens.inlineValidation.duration, animationTimingFunction: tokens.inlineValidation.ease }}>{errorText}</span>
      ) : helperText ? (
        <span id={helperId} className="text-xs font-medium text-slate-500 dark:text-slate-400">{helperText}</span>
      ) : null}
      {valid && !showError ? (
        <span id={validId} className="text-xs font-semibold text-signal-700 dark:text-signal-300">Ready to save.</span>
      ) : null}
    </div>
  );
};

export const OptionCardChoiceGroup: FunctionComponent<OptionCardChoiceGroupProps> = (props) => {
  const generatedId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tokens = useInteractionTokens();
  const multiple = props.selectionMode === "multiple";
  const selectedValues = multiple ? props.value : [props.value];
  const selectedOptions = props.options.filter((option) => selectedValues.includes(option.value));
  const helperId = props.helperText ? `${generatedId}-helper` : undefined;
  const summaryId = `${generatedId}-summary`;
  const describedBy = [summaryId, helperId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const selectedSummary = props.selectedSummaryLabel
    ?? (multiple
      ? `${selectedOptions.length} selected`
      : `Selected: ${selectedOptions[0]?.label ?? "None"}`);

  const isOptionDisabled = (option: SettingsOptionCard): boolean => Boolean(props.disabled || option.disabled);

  const findNextEnabledIndex = (currentIndex: number, offset: number): number => {
    if (!props.options.length || props.disabled) {
      return currentIndex;
    }
    for (let step = 1; step <= props.options.length; step += 1) {
      const nextIndex = (currentIndex + (offset * step) + props.options.length) % props.options.length;
      if (!isOptionDisabled(props.options[nextIndex])) {
        return nextIndex;
      }
    }
    return currentIndex;
  };

  const chooseOption = (option: SettingsOptionCard): void => {
    if (isOptionDisabled(option)) {
      return;
    }
    if (props.selectionMode === "multiple") {
      const nextValue = props.value.includes(option.value)
        ? props.value.filter((value) => value !== option.value)
        : [...props.value, option.value];
      props.onChange(nextValue);
      return;
    }
    props.onChange(option.value);
  };

  const handleOptionKeyDown = (event: KeyboardEvent, index: number, option: SettingsOptionCard): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = findNextEnabledIndex(index, 1);
      optionRefs.current[nextIndex]?.focus();
      if (!multiple) {
        chooseOption(props.options[nextIndex]);
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = findNextEnabledIndex(index, -1);
      optionRefs.current[nextIndex]?.focus();
      if (!multiple) {
        chooseOption(props.options[nextIndex]);
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const offset = event.key === "Home" ? 1 : -1;
      const startIndex = event.key === "Home" ? props.options.length - 1 : 0;
      const nextIndex = findNextEnabledIndex(startIndex, offset);
      optionRefs.current[nextIndex]?.focus();
      if (!multiple) {
        chooseOption(props.options[nextIndex]);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(option);
    }
  };

  return (
    <div className="flex min-w-0 w-full flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div id={summaryId} className="min-w-0 break-words text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {selectedSummary}
        </div>
        {props.helperText ? (
          <div id={helperId} className="min-w-0 break-words text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            {props.helperText}
          </div>
        ) : null}
      </div>
      <div
        role={multiple ? "group" : "radiogroup"}
        aria-label={props["aria-labelledby"] ? undefined : props["aria-label"] ?? "Setting options"}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={describedBy}
        className="grid min-w-0 w-full grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-2"
      >
        {props.options.map((option, index) => {
          const selected = selectedValues.includes(option.value);
          const optionDisabled = isOptionDisabled(option);
          const descriptionId = option.description ? `${generatedId}-${option.value}-description` : undefined;
          const disabledReasonId = optionDisabled && option.disabledReason ? `${generatedId}-${option.value}-disabled` : undefined;
          const optionDescribedBy = [descriptionId, disabledReasonId].filter(Boolean).join(" ") || undefined;

          return (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              disabled={optionDisabled}
              aria-label={option["aria-label"] ?? option.label}
              aria-checked={selected}
              aria-describedby={optionDescribedBy}
              onClick={() => chooseOption(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, index, option)}
              style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
              className={`${SHARED_INTERACTION_CLASSES} group/card relative flex min-w-0 w-full items-start gap-3 overflow-hidden rounded-[1rem] border px-3 py-3 text-left ${
                selected
                  ? "border-signal-500/35 bg-signal-500/[0.10] text-slate-900 shadow-[0_0_0_1px_var(--status-static-running-aura)] dark:border-signal-400/35 dark:bg-signal-400/[0.12] dark:text-white"
                  : "border-[color:var(--border-hairline)] bg-[var(--surface-glass)] text-slate-700 hover:bg-[var(--surface-glass-hover)] dark:text-slate-200"
              }`}
            >
              {option.icon ? (
                <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.85rem] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] ${selected ? "text-signal-700 dark:text-signal-200" : "text-slate-500 dark:text-slate-400"}`} aria-hidden>
                  {renderSettingsOptionIcon(option.icon)}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold leading-snug">{option.label}</span>
                  {option.countLabel ? (
                    <span className="shrink-0 rounded-full border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
                      {option.countLabel}
                    </span>
                  ) : null}
                </span>
                {option.description ? (
                  <span id={descriptionId} className="mt-1 block min-w-0 break-words text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                    {option.description}
                  </span>
                ) : null}
                {disabledReasonId ? (
                  <span id={disabledReasonId} className="mt-1 block min-w-0 break-words text-xs font-semibold leading-relaxed text-amber-700 dark:text-amber-200">
                    {option.disabledReason}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const ToggleLinkedControlRow: FunctionComponent<{
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  toggleLabel: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  children: ComponentChildren;
  "aria-describedby"?: string;
}> = ({ enabled, onEnabledChange, toggleLabel, description, disabled, disabledReason, children, "aria-describedby": ariaDescribedby }) => {
  const generatedId = useId();
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const disabledReasonId = disabled && disabledReason ? `${generatedId}-disabled` : undefined;
  const describedBy = [descriptionId, disabledReasonId, ariaDescribedby].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-w-0 w-full flex-col gap-3 rounded-[1rem] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Toggle
          value={enabled}
          onChange={onEnabledChange}
          disabled={disabled}
          aria-label={toggleLabel}
          aria-describedby={describedBy}
        />
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">{toggleLabel}</div>
          {description ? (
            <div id={descriptionId} className="mt-0.5 break-words text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </div>
          ) : null}
          {disabledReasonId ? (
            <div id={disabledReasonId} className="mt-1 break-words text-xs font-semibold leading-relaxed text-amber-700 dark:text-amber-200">
              {disabledReason}
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 w-full sm:w-auto sm:min-w-[14rem]">
        {children}
      </div>
    </div>
  );
};

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
  invalid?: boolean;
  valid?: boolean;
  helperText?: string;
  errorText?: string;
  forceValidation?: boolean;
  maxLength?: number;
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-describedby"?: string;
  "aria-busy"?: boolean | "true" | "false";
}> = ({ value, onChange, placeholder, mono, disabled, invalid, valid, helperText, errorText, forceValidation, maxLength, "aria-label": ariaLabel, "aria-description": ariaDescription, "aria-describedby": ariaDescribedby, "aria-busy": ariaBusy }) => (
  <UiInput
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    aria-invalid={invalid || undefined}
    aria-label={ariaLabel}
    aria-description={ariaDescription}
    aria-describedby={ariaDescribedby}
    aria-busy={ariaBusy}
    valid={valid}
    helperText={helperText}
    errorText={errorText}
    forceValidation={forceValidation}
    maxLength={maxLength}
    onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
    className={`transition-all focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-white/[0.05] dark:text-slate-200 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)] data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.15)] dark:data-[valid=true]:bg-signal-500/[0.04] ${mono ? "font-mono" : "font-sans"}`}
  />
);

export const SecretInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  valid?: boolean;
  helperText?: string;
  errorText?: string;
  forceValidation?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-describedby"?: string;
  "aria-busy"?: boolean | "true" | "false";
  showLabel?: string;
  hideLabel?: string;
}> = ({ value, onChange, placeholder, mono, disabled, invalid, valid, helperText, errorText, forceValidation, "aria-label": ariaLabel, "aria-description": ariaDescription, "aria-describedby": ariaDescribedby, "aria-busy": ariaBusy, showLabel, hideLabel }) => {
  const generatedId = useId();
  const [revealed, setRevealed] = useState(false);
  const RevealIcon = revealed ? EyeOff : Eye;
  const showError = Boolean(errorText && (invalid || forceValidation));
  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const validId = valid && !showError ? `${generatedId}-valid` : undefined;
  const describedBy = [showError ? errorId : helperId, validId, ariaDescribedby].filter(Boolean).join(" ") || undefined;
  const secretLabel = ariaLabel || "secret";
  const revealLabel = revealed ? (hideLabel ?? `Hide ${secretLabel}`) : (showLabel ?? `Show ${secretLabel}`);

  return (
    <div className="relative flex min-w-0 flex-col gap-1.5">
      <UiInput
        type={revealed ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        spellcheck={false}
        aria-invalid={showError || invalid ? "true" : undefined}
        aria-errormessage={showError ? errorId : undefined}
        aria-label={ariaLabel}
        aria-description={ariaDescription}
        aria-describedby={describedBy}
        aria-busy={ariaBusy}
        valid={valid && !showError}
        onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
        className={`pr-11 transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-white/[0.05] dark:text-slate-200 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)] data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.15)] dark:data-[valid=true]:bg-signal-500/[0.04] ${mono ? "font-mono" : "font-sans"}`}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={revealLabel}
        aria-pressed={revealed}
        onClick={() => setRevealed((current) => !current)}
        className={`${SHARED_INTERACTION_CLASSES} absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.06] bg-white/80 text-slate-500 hover:bg-white hover:text-slate-800 dark:border-white/[0.08] dark:bg-void-900/80 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-slate-100`}
      >
        <RevealIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
      {showError ? (
        <span id={errorId} className="text-xs font-medium text-status-red motion-safe:animate-form-slide-down motion-reduce:animate-none" role="alert">{errorText}</span>
      ) : helperText ? (
        <span id={helperId} className="text-xs font-medium text-slate-500 dark:text-slate-400">{helperText}</span>
      ) : null}
      {valid && !showError ? (
        <span id={validId} className="text-xs font-semibold text-signal-700 dark:text-signal-300">Ready to save.</span>
      ) : null}
    </div>
  );
};

export const TextAreaInput: FunctionComponent<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
  valid?: boolean;
  helperText?: string;
  errorText?: string;
  forceValidation?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-describedby"?: string;
}> = ({ value, onChange, placeholder, rows = 12, disabled, invalid, valid, helperText, errorText, forceValidation, "aria-label": ariaLabel, "aria-description": ariaDescription, "aria-describedby": ariaDescribedby }) => {
  const generatedId = useId();
  const showError = Boolean(errorText && (invalid || forceValidation));
  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const validId = valid && !showError ? `${generatedId}-valid` : undefined;
  const describedBy = [showError ? errorId : helperId, validId, ariaDescribedby].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={showError || invalid ? "true" : undefined}
        aria-errormessage={showError ? errorId : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-description={ariaDescription}
        data-valid={valid && !showError ? "true" : undefined}
        onInput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
        className="min-h-[320px] w-full rounded-[1rem] border border-[var(--border-hairline)] hover:border-[var(--border-hairline)] bg-[var(--fill-muted)] px-4 py-3 text-sm leading-relaxed text-slate-700 placeholder-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-[var(--fill-muted)] dark:text-slate-200 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)] data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.15)] dark:data-[valid=true]:bg-signal-500/[0.04] "
      />
      {showError ? (
        <span id={errorId} className="text-xs font-medium text-status-red motion-safe:animate-form-slide-down motion-reduce:animate-none" role="alert">{errorText}</span>
      ) : helperText ? (
        <span id={helperId} className="text-xs font-medium text-slate-500 dark:text-slate-400">{helperText}</span>
      ) : null}
      {valid && !showError ? (
        <span id={validId} className="text-xs font-semibold text-signal-700 dark:text-signal-300">Ready to save.</span>
      ) : null}
    </div>
  );
};

export const NumberInput: FunctionComponent<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  invalid?: boolean;
  valid?: boolean;
  helperText?: string;
  errorText?: string;
  forceValidation?: boolean;
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-describedby"?: string;
}> = ({ value, onChange, min, max, step = 1, disabled, invalid, valid, helperText, errorText, forceValidation, "aria-label": ariaLabel, "aria-description": ariaDescription, "aria-describedby": ariaDescribedby }) => {
  const generatedId = useId();
  const [touched, setTouched] = useState(false);
  const derivedErrorText = Number.isFinite(value) && min !== undefined && value < min
    ? `Use a value of at least ${min}.`
    : Number.isFinite(value) && max !== undefined && value > max
      ? `Use a value no greater than ${max}.`
      : undefined;
  const resolvedErrorText = errorText || derivedErrorText;
  const showError = Boolean(resolvedErrorText && (invalid || forceValidation || (derivedErrorText && touched)));
  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const errorId = resolvedErrorText ? `${generatedId}-error` : undefined;
  const validId = valid && !showError ? `${generatedId}-valid` : undefined;
  const describedBy = [showError ? errorId : helperId, validId, ariaDescribedby].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={showError || invalid ? "true" : undefined}
        aria-errormessage={showError ? errorId : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-description={ariaDescription}
        data-valid={valid && !showError ? "true" : undefined}
        onBlur={() => setTouched(true)}
        onFocusOut={() => setTouched(true)}
        onInput={(event) => {
          setTouched(true);
          onChange(Number((event.currentTarget as HTMLInputElement).value));
        }}
        className="w-32 max-w-full rounded-[1rem] border border-[var(--border-hairline)] hover:border-[var(--border-hairline)] bg-[var(--fill-muted)] px-3.5 py-2.5 text-sm font-mono text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-[var(--fill-muted)] dark:text-slate-200 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)] data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.15)] dark:data-[valid=true]:bg-signal-500/[0.04] "
      />
      {showError ? (
        <span id={errorId} className="text-xs font-medium text-status-red motion-safe:animate-form-slide-down motion-reduce:animate-none" role="alert">{resolvedErrorText}</span>
      ) : helperText ? (
        <span id={helperId} className="text-xs font-medium text-slate-500 dark:text-slate-400">{helperText}</span>
      ) : null}
      {valid && !showError ? (
        <span id={validId} className="text-xs font-semibold text-signal-700 dark:text-signal-300">Ready to save.</span>
      ) : null}
    </div>
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
    className={`group flex flex-col gap-4 rounded-[1.35rem] border border-[color:var(--border-hairline)] hover:border-[color:var(--border-hairline)] bg-[var(--fill-muted)] hover:bg-[var(--fill-muted-hover)] px-4 py-4 md:flex-row md:items-start md:justify-between transition-colors duration-200 ${!last ? "" : ""}`}
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
                aria-label="Reset to default"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                title="Delete project override (revert to system default)"
                className="ml-1 rounded-full p-1 text-amber-600 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-300/25 dark:hover:text-amber-100 transition-colors duration-150 cursor-pointer"
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
    <div className="min-w-0 w-full shrink-0 md:w-auto md:max-w-[34rem] lg:max-w-none">
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
  <section className="rounded-[2rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-6 shadow-[var(--elevation-base)] backdrop-blur-2xl">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border-hairline)] pb-4">
      <div>
        <h3 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>
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
