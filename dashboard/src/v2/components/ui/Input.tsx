import type { FunctionComponent, ComponentProps } from "preact";

export interface InputProps extends ComponentProps<"input"> {
  valid?: boolean;
}

export const Input: FunctionComponent<InputProps> = ({ className = "", disabled, valid, ...props }) => {
  return (
    <input
      disabled={disabled}
      data-valid={valid ? 'true' : undefined}
      className={`min-w-[220px] rounded-[var(--radius-ui)] border border-[color:var(--color-border-muted)] hover:border-[color:var(--color-border-muted)] bg-white/80 px-3.5 py-2.5 text-sm text-slate-700 placeholder-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:hover:border-white/[0.12] dark:bg-white/[0.05] dark:text-slate-200 aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)] ${className} data-[valid=true]:border-signal-500/50 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.15)] dark:data-[valid=true]:bg-signal-500/[0.04] `}
      {...props}
    />
  );
};
