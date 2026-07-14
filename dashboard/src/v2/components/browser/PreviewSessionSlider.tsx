import type { FunctionComponent } from "preact";
import { useRef } from "preact/hooks";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, Trash2, Loader2, CheckCircle2, SlidersHorizontal } from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";
import { buildPreviewOrigin, formatPreviewPortMappingsSummary, getPrimaryPreviewPortMapping } from "../../lib/preview-origin.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/index.js";
import {
  browserPreviewMessages,
  type BrowserPreviewMessageKey,
  type BrowserPreviewMessageVariables,
} from "../../i18n/messages/browser-preview.js";

interface PreviewSessionSliderProps {
  sessions: SprintPreviewSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onRemoveSession: (sessionId: string) => void;
  onManageEnvironment: (sessionId: string) => void;
  removingSessionIds?: string[];
}

const statusTone: Record<SprintPreviewSession["status"], string> = {
  running: "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400",
  starting: "border-ember-500/30 bg-ember-500/10 text-ember-600 dark:text-ember-400",
  stopped: "border-slate-400/25 bg-slate-500/10 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300",
  error: "border-status-red/30 bg-status-red/10 text-status-red",
};

const healthTone: Record<SprintPreviewSession["healthStatus"], string> = {
  healthy: "text-signal-500",
  unreachable: "text-status-red",
  unknown: "text-slate-400",
};

const cardTransition = buildInteractionTransition("selectionMovement");
const controlTransition = buildInteractionTransition("controlFeedback");

const getPreviewRailScrollBehavior = (): ScrollBehavior => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
};

export const PreviewSessionSlider: FunctionComponent<PreviewSessionSliderProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onRemoveSession,
  onManageEnvironment,
  removingSessionIds = [],
}) => {
  const { formatNumber, locale, translate, translatePlural } = useDashboardI18n();
  const t = (key: BrowserPreviewMessageKey, variables?: BrowserPreviewMessageVariables) => (
    translate(browserPreviewMessages, key, variables)
  );
  const statusLabel: Record<SprintPreviewSession["status"], string> = {
    running: t("statusRunning"),
    starting: t("statusStarting"),
    stopped: t("statusStopped"),
    error: t("statusError"),
  };
  const healthLabel: Record<SprintPreviewSession["healthStatus"], string> = {
    healthy: t("healthHealthy"),
    unreachable: t("healthUnreachable"),
    unknown: t("healthUnknown"),
  };
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardCount = sessions.length;
  const removingSessionIdSet = new Set(removingSessionIds);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const railId = "preview-session-rail";
  const hasOverflowControls = cardCount > 5;

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -320, behavior: getPreviewRailScrollBehavior() });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 320, behavior: getPreviewRailScrollBehavior() });
    }
  };

  return (
    <section className="relative w-full min-w-0 group" aria-label={t("previewSessions")}>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectedSession
          ? t("selectedSessionAnnouncement", { name: selectedSession.sprintName, status: statusLabel[selectedSession.status] })
          : cardCount > 0
            ? t("noPreviewSessionSelected")
            : t("noPreviewSessionsAvailable")}
        {removingSessionIds.length > 0 ? ` ${t("removingSessionAnnouncement")}` : ""}
      </div>
      {hasOverflowControls && (
        <>
          <button
            type="button"
            onClick={scrollLeft}
            aria-label={t("scrollSessionsLeft")}
            aria-controls={railId}
            className="absolute -left-4 top-1/2 z-10 flex -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/95 p-2 text-slate-700 opacity-100 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 group-focus-within:opacity-100 motion-reduce:transition-none dark:border-white/[0.08] dark:bg-[#05080d]/95 dark:text-slate-300 dark:hover:bg-[#05080d] dark:hover:text-white lg:opacity-0 lg:group-hover:opacity-100"
            style={{ transition: controlTransition }}
            title={t("scrollLeft")}
          >
            <ChevronLeft aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={scrollRight}
            aria-label={t("scrollSessionsRight")}
            aria-controls={railId}
            className="absolute -right-4 top-1/2 z-10 flex -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/95 p-2 text-slate-700 opacity-100 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 group-focus-within:opacity-100 motion-reduce:transition-none dark:border-white/[0.08] dark:bg-[#05080d]/95 dark:text-slate-300 dark:hover:bg-[#05080d] dark:hover:text-white lg:opacity-0 lg:group-hover:opacity-100"
            style={{ transition: controlTransition }}
            title={t("scrollRight")}
          >
            <ChevronRight aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </>
      )}
      <div
        id={railId}
        ref={scrollContainerRef}
        role="list"
        aria-label={cardCount > 0
          ? translatePlural(browserPreviewMessages, "previewSessionCount", cardCount, { count: formatNumber(cardCount) })
          : t("noPreviewSessions")}
        className="flex w-full max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 pt-1 scrollbar-hide"
      >
        {sessions.map((session) => {
          const active = selectedSessionId === session.id;
          const origin = buildPreviewOrigin(session.id);
          const primaryMapping = getPrimaryPreviewPortMapping(session);
          const canOpen = Boolean(primaryMapping?.hostPort) && session.status === "running";
          const removing = removingSessionIdSet.has(session.id);
          const linkUnavailableReason = session.status === "starting"
            ? t("linkWaitingStarting")
            : session.status === "stopped"
              ? t("linkStopped")
              : session.status === "error"
                ? t("linkError")
            : t("linkWaitingPort");
          const removePendingReason = t("removePendingReason", { name: session.sprintName });
          const removeDescriptionId = `preview-session-${session.id}-remove-state`;

          return (
            <div
              key={session.id}
              role="listitem"
              aria-busy={removing || session.status === "starting"}
              className={`relative w-[280px] flex-none snap-start rounded-[1.25rem] border p-4 transition-all motion-reduce:transition-none lg:w-[calc(20%-0.6rem)] ${
                active
                  ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_10px_28px_rgba(0,224,160,0.1)] ring-1 ring-signal-500/25 dark:bg-signal-500/[0.1]"
                  : "border-[color:var(--border-hairline)] bg-[var(--surface-glass)] shadow-[var(--elevation-base)] backdrop-blur-xl hover:bg-[var(--surface-glass-hover)]"
              }`}
              style={{ transition: cardTransition }}
            >
              {active && (
                <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-signal-500 shadow-sm dark:border-void-900">
                  <CheckCircle2 aria-hidden="true" className="w-2.5 h-2.5 text-void-900" strokeWidth={3} />
                </div>
              )}
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                aria-label={t("selectPreviewSession", { name: session.sprintName })}
                aria-pressed={active}
                aria-current={active ? "true" : undefined}
                aria-describedby={`preview-session-${session.id}-status`}
                className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-900 dark:text-white">
                    {session.sprintName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5 ${
                      statusTone[session.status]
                    }`}
                  >
                    {session.status === 'starting' && <Loader2 aria-hidden="true" className="w-2.5 h-2.5 animate-spin motion-reduce:animate-none" />}
                    {statusLabel[session.status]}
                  </span>
                </div>

                <div id={`preview-session-${session.id}-status`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <Globe
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${healthTone[session.healthStatus]}`}
                    strokeWidth={2}
                  />
                  <span className={`font-semibold ${healthTone[session.healthStatus]}`}>
                    {healthLabel[session.healthStatus]}
                  </span>
                  <span className="break-words">{formatPreviewPortMappingsSummary(session, locale)}</span>
                </div>

                <div className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-500">
                  {removing
                    ? t("removingSessionInline")
                    : primaryMapping?.hostPort
                      ? `127.0.0.1:${primaryMapping.hostPort}`
                      : session.status === "starting"
                        ? t("startingWaitingPort")
                        : t("waitingPort")}
                </div>
                {!canOpen && (
                  <div id={`preview-session-${session.id}-link-state`} className="mt-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {linkUnavailableReason}
                  </div>
                )}
                {active && (
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                    {t("selected")}
                  </div>
                )}
                {removing && (
                  <div id={removeDescriptionId} className="mt-2 text-[10px] font-semibold text-status-red">
                    {removePendingReason}
                  </div>
                )}
              </button>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onManageEnvironment(session.id);
                    }}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
                    style={{ transition: controlTransition }}
                    title={t("manageEnvironmentTitle")}
                    aria-label={t("manageEnvironmentForSession", { name: session.sprintName })}
                  >
                    <SlidersHorizontal aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                    {t("environmentShort")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!removing) {
                        onRemoveSession(session.id);
                      }
                    }}
                    className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/50 motion-reduce:transition-none ${
                      removing
                      ? "border-status-red/15 text-status-red cursor-not-allowed disabled:opacity-50"
                      : "border-status-red/15 text-status-red hover:border-status-red/30 hover:bg-status-red/8"
                    }`}
                    style={{ transition: controlTransition }}
                    title={removing ? removePendingReason : t("removePreviewContainer")}
                    aria-label={removing ? t("removingPreviewSession", { name: session.sprintName }) : t("removePreviewSession", { name: session.sprintName })}
                    disabled={removing}
                    aria-disabled={removing}
                    aria-busy={removing}
                    aria-describedby={removing ? removeDescriptionId : undefined}
                  >
                    {removing ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} /> : <Trash2 aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />}
                    {removing ? t("removing") : t("remove")}
                  </button>
                </div>
                <a
                  href={canOpen ? getSafeUrl(origin) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 motion-reduce:transition-none ${
                    canOpen
                      ? "border-black/[0.08] text-slate-600 hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
                      : "cursor-not-allowed border-slate-400/25 bg-slate-500/10 text-slate-500 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-400"
                  }`}
                  style={{ transition: controlTransition }}
                  title={canOpen ? t("openPreviewNewTabTitle") : linkUnavailableReason}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canOpen) {
                      e.preventDefault();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!canOpen && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                    }
                  }}
                  role={!canOpen ? "link" : undefined}
                  aria-label={canOpen ? t("openPreviewNewTab", { name: session.sprintName }) : t("openPreviewUnavailable", { name: session.sprintName })}
                  aria-disabled={!canOpen}
                  aria-describedby={!canOpen ? `preview-session-${session.id}-link-state` : undefined}
                  tabIndex={canOpen ? undefined : 0}
                >
                  <ExternalLink aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                  {canOpen ? t("openLink") : t("linkUnavailable")}
                </a>
              </div>
            </div>
          );
        })}

      </div>
    </section>
  );
};
