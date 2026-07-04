import { h } from "preact";

export interface FormErrorProps {
  id?: string;
  error?: string;
  helperId?: string;
  helperText?: string;
}

const META_TEXT_CLASS = "min-w-0 break-words text-xs font-medium leading-relaxed text-[var(--text-metadata)]";
const ERROR_TEXT_CLASS = "min-w-0 break-words text-xs font-semibold leading-relaxed text-status-red";

export function FormError({ id, error, helperId, helperText }: FormErrorProps) {
  if (!error && !helperText) return null;

  return (
    <div class="relative mt-1.5 grid grid-cols-1 overflow-hidden">
      <div
        id={helperId}
        aria-hidden={!!error}
        class={`
          col-start-1 row-start-1
          ${META_TEXT_CLASS}
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
          class={`col-start-1 row-start-1 motion-safe:animate-form-slide-down opacity-100 visible ${ERROR_TEXT_CLASS}`}
        >
          {error}
        </div>
      )}
    </div>
  );
}
