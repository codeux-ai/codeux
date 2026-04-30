/** @jsx h */
import { h, JSX } from "preact";
import { forwardRef } from "preact/compat";

export interface SwitchProps extends Omit<JSX.HTMLAttributes<HTMLInputElement>, "type"> {
  invalid?: boolean;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <label className={`relative inline-flex items-center ${className}`}>
        <input
          type="checkbox"
          role="switch"
          ref={ref}
          className="peer sr-only"
          aria-invalid={invalid}
          {...props}
        />
        <div className={`
          w-10 h-5 bg-slate-200 dark:bg-void-800 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-signal-500/50
          peer-checked:bg-signal-500 dark:peer-checked:bg-signal-500 transition-colors duration-200 ease-in-out motion-reduce:transition-none cursor-pointer
          peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
          ${invalid ? "ring-2 ring-status-red/50 border border-status-red" : ""}
        `}>
          <div className="
            w-4 h-4 mt-0.5 ml-0.5 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out motion-reduce:transition-none
            peer-checked:translate-x-5
          " />
        </div>
      </label>
    );
  }
);
Switch.displayName = "Switch";
