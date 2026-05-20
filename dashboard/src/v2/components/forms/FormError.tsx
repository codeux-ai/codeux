import { h } from "preact";

export interface FormErrorProps {
  id?: string;
  error?: string;
}

export function FormError({ id, error }: FormErrorProps) {
  if (!error) return null;
  return (
    <div
      id={id}
      role="alert"
      aria-live="assertive"
      class="text-xs font-medium text-status-red mt-1.5 motion-safe:animate-form-slide-down"
    >
      {error}
    </div>
  );
}
