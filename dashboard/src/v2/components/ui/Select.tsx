/** @jsx h */
import { h, JSX } from "preact";
import { forwardRef } from "preact/compat";
import { getFormControlClasses } from "./form-controls.js";
import { ChevronDown } from "lucide-preact";

export interface SelectProps extends JSX.HTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  errorMessage?: string;
  containerClassName?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ invalid, errorMessage, containerClassName, className, readOnly, disabled, children, ...props }, ref) => {
    const errorId = props.id ? `${props.id}-error` : undefined;

    let describedBy = props["aria-describedby"] || "";
    if (invalid && errorMessage && errorId) {
        describedBy = describedBy ? `${describedBy} ${errorId}` : errorId;
    }

    return (
      <div className={`w-full flex flex-col gap-1.5 ${containerClassName || ""}`}>
        <div className="relative flex items-center">
          <select
            ref={ref}
            className={`${getFormControlClasses({ invalid, readOnly, disabled, className: className as string | undefined })} pl-3 pr-10 py-2 appearance-none`}
            aria-invalid={invalid}
            aria-describedby={describedBy || undefined}
            disabled={disabled}
            {...props}
          >
            {children}
          </select>
          <div className="absolute right-3 text-slate-400 pointer-events-none">
            <ChevronDown size={16} />
          </div>
        </div>
        {invalid && errorMessage && (
          <span id={errorId} role="status" className="text-xs text-status-red font-medium animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:transition-none motion-reduce:animate-none">
            {errorMessage}
          </span>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";
