import { type FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { X, AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-preact";

export type ToastType = "info" | "success" | "warning" | "error";

interface ToastProps {
  message: string;
  title?: string;
  type?: ToastType;
  duration?: number; // ms
  onClose: () => void;
}

/**
 * A simple accessible toast notification component.
 * Uses aria-live="assertive" for errors and "polite" for others.
 */
export const Toast: FunctionComponent<ToastProps> = ({
  message,
  title,
  type = "info",
  duration = 5000,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for fade out animation
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  const getIcon = () => {
    switch (type) {
      case "success": return <CheckCircle2 className="w-5 h-5 text-status-green" />;
      case "warning": return <AlertTriangle className="w-5 h-5 text-status-amber" />;
      case "error": return <AlertCircle className="w-5 h-5 text-status-red" />;
      default: return <Info className="w-5 h-5 text-signal-500" />;
    }
  };

  const getTypeStyles = () => {
    switch (type) {
      case "success": return "border-status-green/20 bg-status-green/[0.04]";
      case "warning": return "border-status-amber/20 bg-status-amber/[0.04]";
      case "error": return "border-status-red/20 bg-status-red/[0.04]";
      default: return "border-signal-500/20 bg-signal-500/[0.04]";
    }
  };

  // High priority for errors, polite for others
  const ariaLive = type === "error" ? "assertive" : "polite";

  return (
    <div
      role="status"
      aria-live={ariaLive}
      className={`fixed bottom-6 right-6 z-[300] flex w-full max-w-sm transform items-start gap-4 rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-300 ${getTypeStyles()} ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex shrink-0 pt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        {title && <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{title}</h4>}
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
          {message}
        </p>
      </div>
      <button
        onClick={handleClose}
        aria-label="Close notification"
        className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
