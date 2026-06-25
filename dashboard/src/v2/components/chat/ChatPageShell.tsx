import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { MessageCircle, RefreshCw, Plus } from "lucide-preact";
import type { Source } from "../../types.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { PageContainer } from "../layout/PageContainer.js";

export const ChatPageShell: FunctionComponent<{
  selectedProject: Source | null;
  chatMode: "threads" | "invocations";
  onSetChatMode: (mode: "threads" | "invocations") => void;
  onRefresh: () => void;
  manualRefreshing: boolean;
  onCreateThread: () => void;
  pendingDashboardMessages: number;
  activeConnectionLabel?: string;
  error: string | null;
  railSlot: ComponentChildren;
  detailSlot: ComponentChildren;
}> = ({
  selectedProject,
  chatMode,
  onSetChatMode,
  onRefresh,
  manualRefreshing,
  onCreateThread,
  pendingDashboardMessages,
  activeConnectionLabel,
  error,
  railSlot,
  detailSlot,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const interactionTokens = useInteractionTokens();

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      if (!headerRef.current) return;
      if (prefersReducedMotion) {
        gsap.set(Array.from(headerRef.current.children), { opacity: 1, y: 0 });
      } else {
        gsap.fromTo(
          Array.from(headerRef.current.children),
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" }
        );
      }
    });
    return () => ctx.revert();
  }, [prefersReducedMotion]);

  return (
    <PageContainer padding="chat" className="min-h-0 flex-1 flex flex-col gap-6 lg:gap-8 h-full">
      <div ref={headerRef} className="shrink-0 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
            Dashboard Chat
          </div>
          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute -left-2 -top-8 font-display text-[6rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03]">
              CHAT
            </div>
            <h1 className="relative z-10 font-display text-5xl font-black tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Project <span className="text-signal-500">Conversations.</span>
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto xl:justify-end">
          <div role="tablist" aria-label="Chat Mode" className="flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <button
              role="tab"
              aria-selected={chatMode === "threads"}
              aria-controls="chat-panel"
              type="button"
              onClick={() => onSetChatMode("threads")}
              style={{
                transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                chatMode === "threads"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Threads
            </button>
            <button
              role="tab"
              aria-selected={chatMode === "invocations"}
              aria-controls="chat-panel"
              type="button"
              onClick={() => onSetChatMode("invocations")}
              style={{
                transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                chatMode === "invocations"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Invocations
            </button>
          </div>
          {chatMode === "threads" && (
            <>
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                {activeConnectionLabel || "Unassigned"}
              </span>
              <span className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] ${
                pendingDashboardMessages > 0
                  ? "border-status-amber/30 bg-status-amber/10 text-status-amber"
                  : "border-signal-500/20 bg-signal-500/10 text-signal-500"
              }`}>
                {pendingDashboardMessages > 0 && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-amber opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-status-amber"></span>
                  </span>
                )}
                {pendingDashboardMessages > 0 ? <>{pendingDashboardMessages} pending<span className="sr-only"> messages</span></> : "Inbox clear"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={manualRefreshing}
            style={{
              transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
              transitionDuration: interactionTokens.controlFeedback.duration,
              transitionTimingFunction: interactionTokens.controlFeedback.ease,
            }}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} strokeWidth={2.1} />
            Refresh
          </button>
          {chatMode === "threads" && (
            <button
              type="button"
              onClick={onCreateThread}
              disabled={!selectedProject}
              style={{
                transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-void-900 hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
              New Thread
            </button>
          )}
        </div>
      </div>

      {(error || manualRefreshing) && (
        <div className="shrink-0">
          <ActionFeedbackRegion
            status={error ? "error" : "pending"}
            message={error || "Refreshing chat state..."}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)] gap-6 pb-6">
        {railSlot}
        <section className="flex flex-col min-h-0 flex-1 rounded-3xl border border-black/[0.06] bg-white/80 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          {detailSlot}
        </section>
      </div>
    </PageContainer>
  );
};
