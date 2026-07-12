import type { FunctionComponent } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { ArrowRight, Clock3, X } from "lucide-preact";
import type { DashboardNotification } from "../hooks/use-notifications.js";
import { Modal } from "./ui/Modal.js";

const formatDetailValue = (label: string, value: string): string => {
  if (label !== "Timestamp") return value;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
};

export const NotificationDetailsModal: FunctionComponent<{
  notification: DashboardNotification | null;
  onClose: () => void;
  onAction: (notification: DashboardNotification) => void;
  onNavigate?: (href: string) => void | Promise<void>;
}> = ({ notification, onClose, onAction, onNavigate }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = notification ? `notification-details-title-${notification.id}` : "notification-details-title";
  const descriptionId = notification ? `notification-details-description-${notification.id}` : "notification-details-description";
  const details = useMemo(() => notification?.details ?? [], [notification]);

  return (
    <Modal
      isOpen={notification !== null}
      onClose={onClose}
      className="flex w-[44rem] max-w-[calc(100vw-2rem)] flex-col !overflow-hidden rounded-2xl"
      titleId={titleId}
      ariaDescribedBy={descriptionId}
      initialFocusRef={closeButtonRef}
    >
      {notification ? (
        <>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.06] sm:px-6 sm:py-5">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-signal-700 dark:text-signal-300">
                Attention details
              </div>
              <h2 id={titleId} className="mt-1 break-words text-xl font-black tracking-tight text-slate-900 dark:text-white">
                {notification.title}
              </h2>
              <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Review the execution context and recommended recovery path.
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors motion-reduce:transition-none hover:bg-black/[0.05] hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06] dark:hover:text-white"
              aria-label="Close notification details"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="dashboard-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              {details.map((detail) => {
                const wide = detail.label === "What went wrong"
                  || detail.label === "Why this needs attention"
                  || detail.label === "Recommended next steps"
                  || detail.label === "Source context";
                return (
                  <div
                    key={detail.label}
                    className={`rounded-2xl border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035] ${wide ? "sm:col-span-2" : ""}`}
                  >
                    <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                      {detail.label}
                    </dt>
                    <dd className="mt-1.5 break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-200">
                      {detail.label === "Timestamp" ? (
                        <time dateTime={detail.value} className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          {formatDetailValue(detail.label, detail.value)}
                        </time>
                      ) : formatDetailValue(detail.label, detail.value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <footer className="flex shrink-0 flex-col-reverse items-stretch gap-2 border-t border-black/[0.06] bg-black/[0.015] px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-black/10 px-4 text-sm font-bold text-slate-600 transition-colors motion-reduce:transition-none hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.05]"
            >
              Close
            </button>
            {notification.actionHref && notification.actionLabel ? (
              <a
                href={notification.actionHref}
                onClick={(event) => {
                  onAction(notification);
                  if (onNavigate) {
                    event.preventDefault();
                    onClose();
                    void onNavigate(notification.actionHref!);
                  }
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-signal-600 px-4 text-sm font-black text-white transition-colors motion-reduce:transition-none hover:bg-signal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 dark:ring-offset-void-800"
              >
                {notification.actionLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
          </footer>
        </>
      ) : null}
    </Modal>
  );
};
