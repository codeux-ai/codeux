import type { FunctionComponent, ComponentProps } from "preact";
import { useId } from "preact/hooks";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

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

const SELECT_SHELL_CLASS =
  "min-h-10 w-full min-w-0 appearance-none rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3.5 py-2.5 text-sm leading-5 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-all duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-0 motion-reduce:ease-none hover:border-black/[0.1] hover:bg-[var(--fill-muted-hover)] focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-[var(--fill-muted)] disabled:text-slate-400 disabled:opacity-60 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.16)] aria-[invalid=true]:focus-visible:ring-status-red/50 data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.025] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.16)] dark:text-slate-100 dark:hover:border-white/[0.12] dark:focus-visible:ring-offset-void-900 dark:data-[valid=true]:bg-signal-500/[0.04]";
const META_TEXT_CLASS = "min-w-0 break-words text-xs font-medium leading-relaxed text-[var(--text-metadata)]";
const ERROR_TEXT_CLASS = "min-w-0 break-words text-xs font-semibold leading-relaxed text-status-red";

export const Select: FunctionComponent<SelectProps> = ({
  className = "",
  disabled,
  valid,
  style,
  errorText,
  helperText,
  id,
  children,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
  "aria-required": ariaRequired,
  ...props
}) => {
  const tokens = useInteractionTokens();
  const uniqueId = useId();
  const generatedId = id || (props.name ? `select-${props.name}` : uniqueId);
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const helperId = helperText ? `${generatedId}-helper` : undefined;

  const describedBy = [
    errorText ? errorId : helperText ? helperId : undefined,
    ariaDescribedBy
  ].filter(Boolean).join(" ") || undefined;

  const errorMessage = [errorId, ariaErrorMessage].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <select
        id={generatedId}
        aria-invalid={ariaInvalid !== undefined ? ariaInvalid : (errorText ? "true" : undefined)}
        aria-errormessage={errorMessage}
        aria-describedby={describedBy}
        aria-required={ariaRequired}
        style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof style === "object" ? style : {}) }}
        disabled={disabled}
        data-valid={valid ? 'true' : undefined}
        className={`${SELECT_SHELL_CLASS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <div className="min-h-[1.25rem] min-w-0 text-xs">
        {errorText ? (
          <span id={errorId} className={ERROR_TEXT_CLASS} role="alert">{errorText}</span>
        ) : helperText ? (
          <span id={helperId} className={META_TEXT_CLASS}>{helperText}</span>
        ) : null}
      </div>
    </div>
  );
};
