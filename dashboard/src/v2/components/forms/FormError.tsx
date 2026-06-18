import { h } from "preact";

export interface FormErrorProps {
  id?: string;
  error?: string;
  helperId?: string;
  helperText?: string;
}

export function FormError({ id, error, helperId, helperText }: FormErrorProps) {
  if (!error && !helperText) return null;

  return (
    <div class="grid grid-cols-1 mt-1.5 overflow-hidden relative">
      <div
        id={helperId}
        class={`
          col-start-1 row-start-1
          text-xs text-slate-500 dark:text-slate-400
          motion-safe:transition-all motion-safe:duration-200 ease-in-out
          ${error
            ? 'opacity-0 -translate-y-1 pointer-events-none'
            : 'opacity-100 translate-y-0 visible'}
        `}
      >
        {helperText}
      </div>
      {error && (
        <div
          id={id}
          role="alert"
          aria-live="assertive"
          class="col-start-1 row-start-1 text-xs font-medium text-status-red motion-safe:animate-form-slide-down opacity-100 visible"
        >
          {error}
        </div>
      )}
    </div>
  );
}
