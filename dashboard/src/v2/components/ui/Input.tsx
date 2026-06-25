import type { FunctionComponent, ComponentProps } from "preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export interface InputProps extends ComponentProps<"input"> {
  valid?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
  errorText?: string;
  helperText?: string;
}

export const Input: FunctionComponent<InputProps> = ({ className = "", disabled, valid, style, errorText, helperText, id, ...props }) => {
  const tokens = useInteractionTokens();
  const generatedId = id || (props.name ? `input-${props.name}` : undefined);
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const helperId = helperText ? `${generatedId}-helper` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={generatedId}
        aria-invalid={!!errorText || props["aria-invalid"]}
        aria-errormessage={errorId || props["aria-errormessage"]}
        aria-describedby={helperId || props["aria-describedby"]}
      style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof style === "object" ? style : {}) }}
      disabled={disabled}
      data-valid={valid ? 'true' : undefined}
      className={`min-w-[220px] rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] hover:bg-[var(--fill-muted-hover)] px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 transition-all duration-[150ms] motion-reduce:duration-0 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:ease-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--fill-muted)] aria-[invalid=true]:border-status-red aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.2)] aria-[invalid=true]:focus-visible:ring-status-red/50 ${className} data-[valid=true]:border-signal-500 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.2)] dark:data-[valid=true]:bg-signal-500/[0.04] `}
      {...props}
    />
      <div className="min-h-[1.25rem] text-xs">
        {errorText ? (
          <span id={errorId} className="text-status-red" role="alert">{errorText}</span>
        ) : helperText ? (
          <span id={helperId} className="text-slate-500 dark:text-slate-400">{helperText}</span>
        ) : null}
      </div>
    </div>
  );
};
