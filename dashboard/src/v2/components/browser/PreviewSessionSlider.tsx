import type { FunctionComponent } from "preact";
import { useRef } from "preact/hooks";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, Trash2, Loader2, CheckCircle2 } from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";
import { buildPreviewOrigin } from "../../lib/preview-origin.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";

interface PreviewSessionSliderProps {
  sessions: SprintPreviewSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onRemoveSession: (sessionId: string) => void;
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

const statusLabel: Record<SprintPreviewSession["status"], string> = {
  running: "Running",
  starting: "Starting",
  stopped: "Stopped",
  error: "Error",
};

const cardTransition = buildInteractionTransition("selectionMovement");
const controlTransition = buildInteractionTransition("controlFeedback");

const formatPortMapping = (session: SprintPreviewSession): string => {
  const sourcePort = typeof session.containerAppPort === "number" ? session.containerAppPort : null;
  const routedPort = typeof session.hostPort === "number" ? session.hostPort : null;
  if (sourcePort && routedPort) {
    return `:${sourcePort} -> :${routedPort}`;
  }
  if (sourcePort) {
    return `:${sourcePort} -> pending`;
  }
  if (routedPort) {
    return `pending -> :${routedPort}`;
  }
  return "port pending";
};

export const PreviewSessionSlider: FunctionComponent<PreviewSessionSliderProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onRemoveSession,
  removingSessionIds = [],
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardCount = sessions.length;
  const removingSessionIdSet = new Set(removingSessionIds);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -320, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 320, behavior: "smooth" });
    }
  };

  return (
    <section className="relative w-full min-w-0 group" aria-label="Preview sessions">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectedSession
          ? `Selected preview session ${selectedSession.sprintName}. Status ${statusLabel[selectedSession.status]}.`
          : cardCount > 0
            ? "No preview session is selected."
            : "No preview sessions are available."}
        {removingSessionIds.length > 0 ? " Removing preview session." : ""}
      </div>
      {cardCount > 5 && (
        <>
          <button
            type="button"
            onClick={scrollLeft}
            aria-label="Scroll preview sessions left"
            className="absolute -left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/90 p-2 text-slate-600 opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-within:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none dark:border-white/[0.08] dark:bg-[#05080d]/90 dark:text-slate-400 dark:hover:bg-[#05080d] dark:hover:text-white lg:flex lg:group-focus-within:flex hidden"
            style={{ transition: controlTransition }}
            title="Scroll left"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={scrollRight}
            aria-label="Scroll preview sessions right"
            className="absolute -right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/90 p-2 text-slate-600 opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-within:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none dark:border-white/[0.08] dark:bg-[#05080d]/90 dark:text-slate-400 dark:hover:bg-[#05080d] dark:hover:text-white lg:flex lg:group-focus-within:flex hidden"
            style={{ transition: controlTransition }}
            title="Scroll right"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </>
      )}
      <div
        ref={scrollContainerRef}
        role="list"
        aria-label={cardCount > 0 ? `${cardCount} preview sessions` : "No preview sessions"}
        className="flex w-full max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 pt-1 scrollbar-hide"
      >
        {sessions.map((session) => {
          const active = selectedSessionId === session.id;
          const origin = buildPreviewOrigin(session.id);
          const canOpen = Boolean(session.hostPort);
          const removing = removingSessionIdSet.has(session.id);

          return (
            <div
              key={session.id}
              role="listitem"
              aria-busy={removing || session.status === "starting"}
              className={`relative w-[280px] flex-none snap-start rounded-[1.25rem] border p-4 transition-all motion-reduce:transition-none lg:w-[calc(20%-0.6rem)] ${
                active
                  ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_10px_28px_rgba(0,224,160,0.1)] ring-1 ring-signal-500/25 dark:bg-signal-500/[0.1]"
                  : "border-black/[0.08] bg-white/68 backdrop-blur-xl hover:border-black/[0.14] hover:bg-white/80 dark:border-white/[0.08] dark:bg-void-900/35 dark:hover:border-white/[0.14] dark:hover:bg-void-900/50"
              }`}
              style={{ transition: cardTransition }}
            >
              {active && (
                <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-signal-500 shadow-sm dark:border-void-900">
                  <CheckCircle2 className="w-2.5 h-2.5 text-void-900" strokeWidth={3} />
                </div>
              )}
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                aria-label={`Select preview session ${session.sprintName}`}
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
                    {session.status === 'starting' && <Loader2 className="w-2.5 h-2.5 animate-spin motion-reduce:animate-none" />}
                    {statusLabel[session.status]}
                  </span>
                </div>

                <div id={`preview-session-${session.id}-status`} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <Globe
                    className={`h-3.5 w-3.5 ${healthTone[session.healthStatus]}`}
                    strokeWidth={2}
                  />
                  <span className="break-words">{formatPortMapping(session)}</span>
                </div>

                <div className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-500">
                  {removing
                    ? "removing session"
                    : session.hostPort
                      ? `127.0.0.1:${session.hostPort}`
                      : session.status === "starting"
                        ? "starting and waiting for routed port"
                        : "waiting for routed port"}
                </div>
                {active && (
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                    Selected
                  </div>
                )}
              </button>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
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
                  title="Remove preview container"

                  aria-label={`Remove preview session ${session.sprintName}`}
                  disabled={removing}
                  aria-disabled={removing}
                  aria-busy={removing}
                >
                  {removing ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} /> : <Trash2 className="h-3 w-3" strokeWidth={2.5} />}
                  {removing ? "Removing..." : "Remove"}
                </button>
                <a
                  href={canOpen ? getSafeUrl(origin) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white ${!canOpen ? "pointer-events-none opacity-50" : ""}`}
                  style={{ transition: controlTransition }}
                  title={canOpen ? "Open isolated preview in a new tab" : "Preview link is unavailable until a host port is routed"}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Open preview session ${session.sprintName} in a new tab`}
                  aria-disabled={!canOpen}
                  aria-describedby={!canOpen ? `preview-session-${session.id}-status` : undefined}
                  tabIndex={canOpen ? undefined : -1}
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                  Open Link
                </a>
              </div>
            </div>
          );
        })}

      </div>
    </section>
  );
};
