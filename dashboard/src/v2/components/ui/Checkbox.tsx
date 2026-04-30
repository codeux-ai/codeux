/** @jsx h */
import { h, JSX } from "preact";
import { forwardRef } from "preact/compat";

export interface CheckboxProps extends Omit<JSX.HTMLAttributes<HTMLInputElement>, "type"> {
  invalid?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <label className={`relative inline-flex items-center ${className} cursor-pointer`}>
        <input
          type="checkbox"
          ref={ref}
          className={`
            peer w-5 h-5 rounded border border-slate-300 dark:border-white/20 bg-white dark:bg-void-900
            text-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none focus:ring-offset-0 focus:ring-offset-transparent
            disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 motion-reduce:transition-none
            ${invalid ? "border-status-red ring-1 ring-status-red/50" : ""}
          `}
          aria-invalid={invalid}
          {...props}
        />
        <svg
          className="absolute w-5 h-5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity duration-200 motion-reduce:transition-none text-signal-500"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";
