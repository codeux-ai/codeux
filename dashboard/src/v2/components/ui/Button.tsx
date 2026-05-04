import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback, useRef } from "preact/hooks";
import { Check, X, Loader2 } from "lucide-preact";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useMagnetic } from "../../hooks/use-magnetic.js";
import { useScalePop } from "../../hooks/use-scale-pop.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";

export const SHARED_INTERACTION_CLASSES = "transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus-visible:ring-signal-500 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed touch-target";

export interface ButtonProps extends ComponentProps<"button"> {
  success?: boolean;
  pending?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "signal";
  size?: "sm" | "md" | "lg";
}

const VARIANTS = {
  primary: "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100",
  secondary: "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white",
  danger: "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]",
  ghost: "bg-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]",
  signal: "bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.4)] aria-disabled:shadow-none",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs rounded-xl",
  md: "px-4 py-2 text-xs rounded-xl",
  lg: "px-6 py-3 text-sm rounded-2xl",
};

export const Button: FunctionComponent<ButtonProps> = memo(({
  children,
  className = "",
  variant = "secondary",
  size = "md",
  pending = false,
  success = false,
  disabled,
  onClick,
  ...props
}) => {
  const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);

  const isPending = pending || feedback.status === "pending";
  const isSuccess = success || feedback.status === "success";
  const isError = feedback.status === "error";
  const durations = useGsapDurations();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useMagnetic(buttonRef, contentRef, { enabled: variant === "primary" || variant === "signal" });
  useScalePop(buttonRef, Boolean(disabled) || isPending, { scaleDown: 0.98, durationDown: durations.fast, durationUp: durations.slow, easeDown: GSAP_EASINGS.smooth, easeUp: GSAP_EASINGS.spring });

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

  const childrenOpacity = (isPending || isSuccess || isError) ? "opacity-0" : "opacity-100";

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
      <div ref={contentRef} className={`flex items-center justify-center gap-2 transition-opacity duration-200 ${childrenOpacity}`}>
        {children}
      </div>

      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPending ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>

      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isSuccess ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <Check className="w-5 h-5" />
      </div>

      <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isError ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <X className="w-5 h-5" />
      </div>
    </button>
  );
});