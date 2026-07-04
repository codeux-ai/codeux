import type { FunctionComponent, ComponentProps } from "preact";
import { useState, useEffect, useId } from "preact/hooks";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

export interface InputProps extends ComponentProps<"input"> {
  valid?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
  errorText?: string;
  helperText?: string;
}

const CONTROL_SHELL_CLASS =
  "min-h-10 w-full min-w-0 rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3.5 py-2.5 text-sm leading-5 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-all motion-reduce:duration-0 motion-reduce:ease-none placeholder:text-slate-400 hover:border-black/[0.1] hover:bg-[var(--fill-muted-hover)] focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-[var(--fill-muted)] disabled:text-slate-400 disabled:opacity-60 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.16)] aria-[invalid=true]:focus-visible:ring-status-red/50 data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.025] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.16)] dark:text-slate-100 dark:placeholder:text-slate-600 dark:hover:border-white/[0.12] dark:focus-visible:ring-offset-void-900 dark:data-[valid=true]:bg-signal-500/[0.04]";
const META_TEXT_CLASS = "min-w-0 break-words text-xs font-medium leading-relaxed text-[var(--text-metadata)]";
const ERROR_TEXT_CLASS = "min-w-0 break-words text-xs font-semibold leading-relaxed text-status-red";

export const Input: FunctionComponent<InputProps> = ({
  className = "",
  disabled,
  valid,
  style,
  errorText,
  helperText,
  id,
  maxLength,
  onInput,
  ...props
}) => {
  const tokens = useInteractionTokens();
  const uniqueId = useId();
  const generatedId = id || (props.name ? `input-${props.name}` : uniqueId);
  const errorId = errorText ? `${generatedId}-error` : undefined;
  const helperId = helperText ? `${generatedId}-helper` : undefined;

  const [charCount, setCharCount] = useState(() => {
    if (props.value != null) return String(props.value).length;
    if (props.defaultValue != null) return String(props.defaultValue).length;
    return 0;
  });

  useEffect(() => {
    if (props.value != null) {
      setCharCount(String(props.value).length);
    }
  }, [props.value]);

  const handleInput = (e: any) => {
    setCharCount(e.currentTarget.value.length);
    if (onInput) {
      onInput(e);
    }
  };

  const parsedMaxLength = maxLength ? Number(maxLength) : undefined;
  const showCounter = !!parsedMaxLength && charCount >= parsedMaxLength * 0.8;
  const [isCounterMounted, setIsCounterMounted] = useState(showCounter);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (showCounter) {
      setIsCounterMounted(true);
      setIsFadingOut(false);
    } else if (isCounterMounted) {
      setIsFadingOut(true);
    }
  }, [showCounter, isCounterMounted]);

  const handleTransitionEnd = () => {
    if (isFadingOut) {
      setIsCounterMounted(false);
      setIsFadingOut(false);
    }
  };

  let counterColorClass = "text-slate-400";
  if (parsedMaxLength) {
    if (charCount >= parsedMaxLength) {
      counterColorClass = "text-red-500 animate-form-shake motion-reduce:animate-none";
    } else if (charCount >= parsedMaxLength * 0.9) {
      counterColorClass = "text-amber-500";
    }
  }

  const describedBy = [
    errorText ? errorId : helperText ? helperId : undefined,
    props["aria-describedby"]
  ].filter(Boolean).join(" ") || undefined;

  const errorMessage = [errorId, props["aria-errormessage"]].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <input
        id={generatedId}
        maxLength={maxLength}
        onInput={handleInput}
        aria-invalid={errorText ? "true" : props["aria-invalid"]}
        aria-errormessage={errorMessage}
        aria-describedby={describedBy}
        style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof style === "object" ? style : {}) }}
        disabled={disabled}
        data-valid={valid ? 'true' : undefined}
        className={`${CONTROL_SHELL_CLASS} ${className}`}
        {...props}
      />
      <div className="flex min-h-[1.25rem] min-w-0 items-start justify-between gap-3 text-xs">
        <div className="min-w-0 flex-1">
          {errorText ? (
            <span id={errorId} className={ERROR_TEXT_CLASS} role="alert">{errorText}</span>
          ) : helperText ? (
            <span id={helperId} className={META_TEXT_CLASS}>{helperText}</span>
          ) : null}
        </div>
        {isCounterMounted && (
          <p
            aria-live="polite"
            onTransitionEnd={handleTransitionEnd}
            style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
            className={`shrink-0 text-right font-mono text-[11px] leading-relaxed transition-colors ${isFadingOut ? "opacity-0 transition-opacity" : "animate-form-slide-down motion-reduce:animate-none opacity-100"} ${counterColorClass}`}
          >
            {charCount} / {parsedMaxLength}
          </p>
        )}
      </div>
    </div>
  );
};
