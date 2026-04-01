import { type FunctionComponent } from "preact";
import { Loader2 } from "lucide-preact";

interface LoadingSpinnerProps {
  label?: string;
  className?: string;
  size?: number | string;
}

/**
 * A reusable loading spinner component with ARIA accessibility.
 * It uses aria-live="polite" and aria-busy="true" to inform screen readers
 * about the asynchronous loading state.
 */
export const LoadingSpinner: FunctionComponent<LoadingSpinnerProps> = ({ 
  label = "Loading...", 
  className = "text-signal-500",
  size = 24
}) => {
  return (
    <div 
      role="status" 
      aria-live="polite" 
      aria-busy="true"
      className="flex items-center gap-3"
    >
      <Loader2 
        className={`animate-spin ${className}`} 
        size={size} 
        aria-hidden="true" 
      />
      {label && (
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
};
