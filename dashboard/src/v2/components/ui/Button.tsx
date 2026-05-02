import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback, useRef } from "preact/hooks";
import { Check, X, Loader2 } from "lucide-preact";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useMagnetic } from "../../hooks/use-magnetic.js";

export const SHARED_INTERACTION_CLASSES = "transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed motion-safe:hover:-translate-y-px aria-disabled:hover:translate-y-0 motion-safe:active:scale-95 aria-disabled:active:scale-100 touch-target";

export interface ButtonProps extends ComponentProps<"button"> {
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
  disabled,
  onClick,
  ...props
}) => {
  const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);

  const isPending = pending || feedback.status === "pending";
  const isSuccess = feedback.status === "success";
  const isError = feedback.status === "error";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useMagnetic(buttonRef, contentRef, { enabled: variant === "primary" || variant === "signal" });

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
  if (isSuccess) overrideClasses = "!bg-status-green !text-white !border-transparent";
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

      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {isSuccess && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Check className="w-5 h-5" />
        </div>
      )}

      {isError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <X className="w-5 h-5" />
        </div>
      )}
    </button>
  );
});