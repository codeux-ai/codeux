import { h, ComponentChildren, VNode, cloneElement, isValidElement } from "preact";
import { useEffect, useState, useId } from "preact/hooks";
import { FormError } from "./FormError";

export interface FieldWrapperProps {
  label: string;
  error?: string;
  children: ComponentChildren;
  htmlFor?: string;
  required?: boolean;
}

export function FieldWrapper({ label, error, children, htmlFor, required }: FieldWrapperProps) {
  const [shake, setShake] = useState(false);
  const [previousError, setPreviousError] = useState<string | undefined>(undefined);
  const generatedId = useId();
  const inputId = htmlFor ?? generatedId;

  useEffect(() => {
    if (error && error !== previousError) {
      setShake(true);
      const timer = setTimeout(() => {
        setShake(false);
      }, 400); // Must be slightly longer than animation duration
      setPreviousError(error);
      return () => clearTimeout(timer);
    } else if (!error) {
      setPreviousError(undefined);
    }
  }, [error, previousError]);

  const errorId = error ? `${inputId}-error` : undefined;

  // Clone children to append aria attributes if valid
  const child = isValidElement(children) ? cloneElement(children as VNode<any>, {
    id: inputId,
    "aria-invalid": !!error,
    ...(errorId ? { "aria-errormessage": errorId } : {}),
  }) : children;

  return (
    <div class="flex flex-col mb-4">
      <label htmlFor={inputId} class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex gap-1">
        {label}
        {required && <span class="text-status-red">*</span>}
      </label>
      <div
        class={`
          relative rounded-md
          ${shake ? 'motion-safe:animate-form-shake' : ''}
          ${error ? 'ring-1 ring-status-red transition-shadow duration-200 ease-in-out' : 'transition-shadow duration-200 ease-in-out'}
        `}
      >
        <div class={`
          [&_input]:transition-colors [&_input]:duration-200 [&_input]:ease-in-out
          [&_textarea]:transition-colors [&_textarea]:duration-200 [&_textarea]:ease-in-out
          ${error ? '[&_input]:border-status-red [&_textarea]:border-status-red [&_input]:ring-status-red [&_textarea]:ring-status-red' : ''}
        `}>
          {child}
        </div>
      </div>
      <FormError error={error} id={errorId} />
    </div>
  );
}
