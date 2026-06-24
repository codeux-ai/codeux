import type { FunctionComponent, ComponentProps } from "preact";

export interface SelectProps extends ComponentProps<"select"> {
  valid?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-errormessage"?: string;
}

export const Select: FunctionComponent<SelectProps> = ({ className = "", disabled, valid, children, ...props }) => {
  return (
    <select
      disabled={disabled}
      data-valid={valid ? 'true' : undefined}
      className={`min-w-[220px] rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] hover:bg-[var(--fill-muted-hover)] px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-all duration-[150ms] motion-reduce:duration-0 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:ease-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--fill-muted)] aria-[invalid=true]:border-status-red aria-[invalid=true]:bg-status-red/[0.04] aria-[invalid=true]:text-status-red aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.2)] aria-[invalid=true]:focus-visible:ring-status-red/50 appearance-none ${className} data-[valid=true]:border-signal-500 data-[valid=true]:bg-signal-500/[0.02] data-[valid=true]:shadow-[0_0_0_1px_rgba(0,224,160,0.2)] dark:data-[valid=true]:bg-signal-500/[0.04] `}
      {...props}
    >
      {children}
    </select>
  );
};
