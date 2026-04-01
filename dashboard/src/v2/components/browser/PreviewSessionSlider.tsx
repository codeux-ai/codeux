import type { FunctionComponent } from "preact";
import { useRef } from "preact/hooks";
import { ChevronLeft, ChevronRight, ExternalLink, Globe } from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";
import { buildPreviewOrigin } from "../../lib/preview-origin.js";

interface PreviewSessionSliderProps {
  sessions: SprintPreviewSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

const statusTone: Record<SprintPreviewSession["status"], string> = {
  running: "border-signal-500/30 bg-signal-500/10 text-signal-500",
  starting: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  stopped: "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  error: "border-status-red/30 bg-status-red/10 text-status-red",
};

const healthTone: Record<SprintPreviewSession["healthStatus"], string> = {
  healthy: "text-signal-500",
  unreachable: "text-status-red",
  unknown: "text-slate-400",
};

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
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  if (sessions.length === 0) {
    return (
      <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-3 text-sm text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
          No preview containers yet. Start the selected sprint to open a browser session.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative group">
      {sessions.length > 5 && (
        <>
          <button
            type="button"
            onClick={scrollLeft}
            className="absolute -left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/90 p-2 text-slate-600 opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/[0.08] dark:bg-[#05080d]/90 dark:text-slate-400 dark:hover:bg-[#05080d] dark:hover:text-white lg:flex hidden focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:opacity-100 focus-visible:outline-none"
            title="Scroll left"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={scrollRight}
            className="absolute -right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-black/[0.08] bg-white/90 p-2 text-slate-600 opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:text-slate-900 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/[0.08] dark:bg-[#05080d]/90 dark:text-slate-400 dark:hover:bg-[#05080d] dark:hover:text-white lg:flex hidden focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:opacity-100 focus-visible:outline-none"
            title="Scroll right"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </>
      )}
      <div
        ref={scrollContainerRef}
        className="flex w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 pt-1 px-1 scrollbar-hide"
      >
        {sessions.map((session) => {
          const active = selectedSessionId === session.id;
          const origin = buildPreviewOrigin(session.id);

          return (
            <div
              key={session.id}
              className={`flex-none w-[280px] lg:w-[calc(20%-0.6rem)] snap-center rounded-[1.5rem] border p-4 transition-all ${
                active
                  ? "border-signal-500/30 bg-white/90 shadow-[0_10px_40px_rgba(15,23,42,0.1)] dark:bg-[#05080d]/90 dark:shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
                  : "border-black/[0.08] bg-white/60 hover:border-black/[0.16] dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-white/[0.16]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {session.sprintName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                      statusTone[session.status]
                    }`}
                  >
                    {session.status}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <Globe
                    className={`h-3.5 w-3.5 ${healthTone[session.healthStatus]}`}
                    strokeWidth={2}
                  />
                  <span>{formatPortMapping(session)}</span>
                </div>

                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                  {session.hostPort ? `127.0.0.1:${session.hostPort}` : "waiting for routed port"}
                </div>
              </button>

              <div className="mt-4 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex justify-end">
                <a
                  href={origin}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] px-3 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
                  title="Open isolated preview in a new tab"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                  Open Link
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
