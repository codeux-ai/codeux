import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback, useRef, useLayoutEffect } from "preact/hooks";
import { Check, X, Loader2 } from "lucide-preact";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useMagnetic } from "../../hooks/use-magnetic.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";

export const SHARED_INTERACTION_CLASSES = "cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed motion-safe:active:scale-[0.98] touch-target";

export interface ButtonProps extends ComponentProps<"button"> {
  success?: boolean;
  pending?: boolean;
  isLoading?: boolean;
  icon?: any;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "signal";
  size?: "sm" | "md" | "lg";
}

const VARIANTS = {
  primary: "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100",
  secondary: "border border-[color:var(--color-border-muted)] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white",
  danger: "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]",
  ghost: "bg-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]",
  signal: "bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.4)] aria-disabled:shadow-none",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs rounded-[var(--radius-ui)]",
  md: "px-4 py-2 text-xs rounded-[var(--radius-ui)]",
  lg: "px-6 py-3 text-sm rounded-[var(--radius-ui)]",
};

export const Button: FunctionComponent<ButtonProps> = memo(({
  children,
  className = "",
  variant = "secondary",
  size = "md",
  pending = false,
  isLoading = false,
  success = false,
  disabled,
  icon: Icon,
  onClick,
  ...props
}) => {
  const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);

  const isPending = pending || isLoading || feedback.status === "pending";
  const isSuccess = success || feedback.status === "success";
  const isError = feedback.status === "error";
  const durations = useGsapDurations();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fixedWidthRef = useRef<number | null>(null);

  useMagnetic(buttonRef, contentRef, { enabled: variant === "primary" || variant === "signal" });

  useLayoutEffect(() => {
    if (isPending && buttonRef.current && fixedWidthRef.current === null) {
      fixedWidthRef.current = buttonRef.current.offsetWidth;
      buttonRef.current.style.width = `${fixedWidthRef.current}px`;
    } else if (!isPending && buttonRef.current) {
      fixedWidthRef.current = null;
      buttonRef.current.style.width = "";
    }
  }, [isPending]);

  const handleClick = useCallback(
    (e: any) => {
      if (isPending) {
        e?.preventDefault();
        return;
      }
      if (!onClick) return;

      const result = (onClick as any)(e);
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
        setPending("");
        result
          .then(() => setSuccess(""))
          .catch((err: unknown) => {
            setError("");
            throw err;
          });
      }
      return result;
    },
    [onClick, isPending, setPending, setSuccess, setError]
  );

  const baseClasses = `group/btn inline-flex items-center justify-center gap-2 font-bold ${SHARED_INTERACTION_CLASSES}`;
  const variantClasses = VARIANTS[variant];
  const sizeClasses = SIZES[size];

  let overrideClasses = "";
  if (isSuccess) overrideClasses = "!bg-status-green !text-white !border-status-green ring-2 ring-status-green ring-offset-2 ring-offset-white dark:ring-offset-void-900";
  else if (isError) overrideClasses = "!bg-status-red !text-white !border-transparent";

  return (
    <button
      {...props}
      ref={buttonRef}
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled || isPending}
      aria-busy={isPending}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} ${overrideClasses} relative overflow-hidden ${className}`}
    >
      <div ref={contentRef} className={`flex items-center justify-center gap-2`}>
        {(Icon || isPending || isSuccess || isError) && (
          <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending || isSuccess || isError ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}>
              {Icon && <Icon className="w-4 h-4" />}
            </div>

            <div key={`pending-${feedback.status}`} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending ? "scale-100 opacity-100 motion-safe:animate-[icon-pop_0.18s_ease-out]" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>

            <div key={`success-${feedback.status}`} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isSuccess ? "scale-100 opacity-100 motion-safe:animate-[icon-pop_0.18s_ease-out]" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Check className="w-4 h-4" strokeWidth={3} />
            </div>

            <div key={`error-${feedback.status}`} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isError ? "scale-100 opacity-100 motion-safe:animate-[icon-pop_0.18s_ease-out]" : "scale-0 opacity-0 pointer-events-none"}`}>
              <X className="w-4 h-4" strokeWidth={3} />
            </div>
          </div>
        )}
        {children}
      </div>
    </button>
  );
});
