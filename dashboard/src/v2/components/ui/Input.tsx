/** @jsx h */
import { h, JSX } from "preact";
import { forwardRef } from "preact/compat";
import { getFormControlClasses } from "./form-controls.js";
import { AlertCircle } from "lucide-preact";

export interface InputProps extends Omit<JSX.HTMLAttributes<HTMLInputElement>, "size" | "icon"> {
  invalid?: boolean;
  errorMessage?: string;
  icon?: h.JSX.Element;
  containerClassName?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, errorMessage, icon, containerClassName, className, readOnly, disabled, ...props }, ref) => {
    const errorId = props.id ? `${props.id}-error` : undefined;

    let describedBy = props["aria-describedby"] || "";
    if (invalid && errorMessage && errorId) {
        describedBy = describedBy ? `${describedBy} ${errorId}` : errorId;
    }

    return (
      <div className={`w-full flex flex-col gap-1.5 ${containerClassName || ""}`}>
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-3 text-slate-400 pointer-events-none">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`${getFormControlClasses({ invalid, readOnly, disabled, className: className as string | undefined })} ${
              icon ? "pl-9" : "px-3"
            } py-2`}
            aria-invalid={invalid}
            aria-describedby={describedBy || undefined}
            readOnly={readOnly}
            disabled={disabled}
            {...props}
          />
          {invalid && !icon && (
            <div className="absolute right-3 text-status-red pointer-events-none">
              <AlertCircle size={16} />
            </div>
          )}
        </div>
        {invalid && errorMessage && (
          <span id={errorId} role="status" className="text-xs text-status-red font-medium flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:transition-none motion-reduce:animate-none">
            {errorMessage}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
