import { type FunctionComponent, type ComponentChildren } from "preact";

export type ExecutionStatus = "queued" | "running" | "completed" | "failed";

export interface ChatWidgetFrameProps {
  status: ExecutionStatus;
  children: ComponentChildren;
  header?: ComponentChildren;
  footer?: ComponentChildren;
}

export const ChatWidgetFrame: FunctionComponent<ChatWidgetFrameProps> = ({
  status,
  children,
  header,
  footer
}) => {
  const getAccentBar = (): string => {
    switch (status) {
      case "running":
        return "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:rounded-full before:bg-signal-500 before:motion-safe:animate-pulse";
      case "completed":
        return "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:rounded-full before:bg-signal-500/40";
      case "failed":
        return "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[2px] before:rounded-full before:bg-status-red/60";
      case "queued":
        return "";
      default:
        return "";
    }
  };

  const getContainerStyles = (): string => {
    const base = "relative rounded-2xl bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-xl border transition-all duration-300";

    if (status === "queued") {
      return `${base} border-dashed border-black/[0.08] dark:border-white/[0.08]`;
    }

    return `${base} border-black/[0.05] dark:border-white/[0.05]`;
  };

  const opacityClass = status === "completed"
    ? "opacity-80 hover:opacity-100 transition-opacity duration-300"
    : "";

  return (
    <div
      class={`${getContainerStyles()} ${getAccentBar()} ${opacityClass} overflow-hidden`}
      role="region"
      aria-label={`Widget: ${status}`}
    >
      {header && (
        <div class="px-4 py-2.5 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between text-[12px] font-medium text-slate-700 dark:text-slate-300">
          {header}
        </div>
      )}
      <div class="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 min-w-0 overflow-wrap-anywhere">
        {children}
      </div>
      {footer && (
        <div class="px-4 py-2 border-t border-black/[0.04] dark:border-white/[0.04] text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {footer}
        </div>
      )}
    </div>
  );
};
