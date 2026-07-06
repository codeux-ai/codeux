import type { FunctionComponent, ComponentProps, JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { SHARED_INTERACTION_CLASSES } from "./Button.js";

export interface SelectProps extends ComponentProps<"select"> {
  valid?: boolean;
  errorText?: string;
  helperText?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
  "aria-required"?: boolean | "false" | "true";
  id?: string;
}

export const Select: FunctionComponent<SelectProps> = ({
  className = "",
  disabled,
  valid,
  style,
  errorText,
  helperText,
  id,
  children,
  onBlur,
  onBlurCapture,
  onChange,
  onFocus,
  onFocusCapture,
  onFocusIn,
  onFocusOut,
  "aria-describedby": ariaDescribedBy,
  "aria-disabled": ariaDisabled,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
  "aria-required": ariaRequired,
  ...props
}) => {
  const tokens = useInteractionTokens();
  const uniqueId = useId();
  const generatedId = id || (props.name ? `select-${props.name}` : uniqueId);
  const hasInvalidState = ariaInvalid === true || ariaInvalid === "true" || !!errorText;
  const hasExternalInvalidState = ariaInvalid === true || ariaInvalid === "true";
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const helperId = helperText ? `${generatedId}-helper` : undefined;
  const isAriaDisabled = ariaDisabled === true || ariaDisabled === "true";
  const isDisabled = !!disabled || isAriaDisabled;
  const [isRecoveringFocus, setIsRecoveringFocus] = useState(false);
  const showError = !!errorText && !isRecoveringFocus;

  const handleChange = (event: JSX.TargetedEvent<HTMLSelectElement, Event>) => {
    if (isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (errorText || hasExternalInvalidState) {
      setIsRecoveringFocus(true);
    }
    onChange?.(event);
  };

  const handleFocus = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    if (errorText || hasExternalInvalidState) {
      setIsRecoveringFocus(true);
    }
    onFocus?.(event);
  };

  const handleFocusIn = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    if (errorText || hasExternalInvalidState) {
      setIsRecoveringFocus(true);
    }
    onFocusIn?.(event);
  };

  const handleFocusCapture = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    if (errorText || hasExternalInvalidState) {
      setIsRecoveringFocus(true);
    }
    onFocusCapture?.(event);
  };

  const handleBlur = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    setIsRecoveringFocus(false);
    onBlur?.(event);
  };

  const handleBlurCapture = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    setIsRecoveringFocus(false);
    onBlurCapture?.(event);
  };

  const handleFocusOut = (event: JSX.TargetedFocusEvent<HTMLSelectElement>) => {
    setIsRecoveringFocus(false);
    onFocusOut?.(event);
  };

  const describedBy = [
    showError ? errorId : helperText ? helperId : undefined,
    ariaDescribedBy
  ].filter(Boolean).join(" ") || undefined;

  const errorMessage = showError ? [errorId, ariaErrorMessage].filter(Boolean).join(" ") || undefined : ariaErrorMessage;

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={generatedId}
        aria-invalid={showError ? "true" : ariaInvalid}
        aria-errormessage={errorMessage}
        aria-describedby={describedBy}
        aria-required={ariaRequired}
        style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof style === "object" ? style : {}) }}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        onBlur={handleBlur}
        onBlurCapture={handleBlurCapture}
        onChange={handleChange}
        onFocus={handleFocus}
        onFocusCapture={handleFocusCapture}
        onFocusIn={handleFocusIn}
        onFocusOut={handleFocusOut}
        data-valid={valid && !hasInvalidState ? 'true' : undefined}
        className={`min-w-[220px] appearance-none rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3.5 py-2.5 text-sm text-slate-700 hover:bg-[var(--fill-muted-hover)] dark:text-slate-200 ${SHARED_INTERACTION_CLASSES} focus-visible:ring-[var(--accent-focus-ring)] focus:ring-0 disabled:bg-[var(--fill-muted)] aria-[invalid=true]:border-status-red aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_var(--status-static-failed-aura)] aria-[invalid=true]:focus-visible:ring-status-red/50 ${className} data-[valid=true]:border-signal-500 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_var(--status-static-running-aura)] dark:data-[valid=true]:bg-signal-500/[0.04] `}
        {...props}
      >
        {children}
      </select>
      <div className="min-h-[1.25rem] text-xs">
        {showError ? (
          <span id={errorId} className="text-status-red" role="alert">{errorText}</span>
        ) : helperText ? (
          <span id={helperId} className="text-slate-500 dark:text-slate-400">{helperText}</span>
        ) : null}
      </div>
    </div>
  );
};
