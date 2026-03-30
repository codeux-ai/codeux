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
  const getFrameStyles = () => {
    switch (status) {
      case "queued":
        return "border-dashed border-slate-300 bg-slate-50/50 dark:bg-slate-900 dark:border-slate-800 widget-queued";
      case "running":
        return "border-solid border-blue-500 bg-blue-50/30 dark:bg-blue-900/30 dark:border-blue-800 widget-running";
      case "completed":
        return "border-solid border-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/30 dark:border-emerald-800 opacity-80 transition-opacity hover:opacity-100";
      case "failed":
        return "border-solid border-red-500 bg-red-50/30 dark:bg-red-900/30 dark:border-red-800";
      default:
        return "border-solid border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700";
    }
  };

  return (
    <div class={`rounded-lg border overflow-hidden transition-colors ${getFrameStyles()}`} role="region" aria-label={`Widget: ${status}`}>
      {header && (
        <div class="px-3 py-2 border-b border-inherit bg-black/5 dark:bg-white/5 flex items-center justify-between text-sm font-medium">
          {header}
        </div>
      )}
      <div class="p-3 text-sm text-slate-700 dark:text-slate-300">
        {children}
      </div>
      {footer && (
        <div class="px-3 py-2 border-t border-inherit bg-black/5 dark:bg-white/5 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
};
