import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";

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
  signal: "bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.4)] disabled:shadow-none",
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
  ...props
}) => {
  const baseClasses = "group/btn inline-flex items-center justify-center gap-2 font-bold transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:opacity-60 disabled:cursor-not-allowed motion-safe:hover:-translate-y-px motion-safe:disabled:hover:translate-y-0 motion-safe:active:scale-95 motion-safe:disabled:active:scale-100 touch-target";
  const variantClasses = VARIANTS[variant];
  const sizeClasses = SIZES[size];

  return (
    <button
      {...props}
      disabled={disabled || pending}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} relative overflow-hidden ${className}`}
    >
      <div className={`flex items-center justify-center gap-2 transition-opacity duration-200 ${pending ? "opacity-0" : "opacity-100"}`}>
        {children}
      </div>

      {pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit rounded-inherit">
          <div className="w-4 h-4 rounded-full border-2 border-current/20 border-t-current animate-spin" />
        </div>
      )}
    </button>
  );
});
