/** @jsx h */
import { h, JSX } from "preact";
import { forwardRef } from "preact/compat";
import { getFormControlClasses } from "./form-controls.js";

export interface TextareaProps extends JSX.HTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  errorMessage?: string;
  containerClassName?: string;
  readOnly?: boolean;
  disabled?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, errorMessage, containerClassName, className, readOnly, disabled, ...props }, ref) => {
    const errorId = props.id ? `${props.id}-error` : undefined;

    let describedBy = props["aria-describedby"] || "";
    if (invalid && errorMessage && errorId) {
        describedBy = describedBy ? `${describedBy} ${errorId}` : errorId;
    }

    return (
      <div className={`w-full flex flex-col gap-1.5 ${containerClassName || ""}`}>
        <textarea
          ref={ref}
          className={`${getFormControlClasses({ invalid, readOnly, disabled, className: className as string | undefined })} px-3 py-2 min-h-[80px] resize-y`}
          aria-invalid={invalid}
          aria-describedby={describedBy || undefined}
          readOnly={readOnly}
          disabled={disabled}
          {...props}
        />
        {invalid && errorMessage && (
          <span id={errorId} role="status" className="text-xs text-status-red font-medium animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:transition-none motion-reduce:animate-none">
            {errorMessage}
          </span>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
