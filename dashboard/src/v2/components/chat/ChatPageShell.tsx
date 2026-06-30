import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { MessageCircle, RefreshCw, Plus } from "lucide-preact";
import type { Source } from "../../types.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { PageContainer } from "../layout/PageContainer.js";
import { PageHeader } from "../layout/PageHeader.js";

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
      <PageHeader
        containerRef={headerRef}
        className="shrink-0"
        icon={MessageCircle}
        eyebrow="Dashboard Chat"
        title="Project Conversations"
        actions={
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto xl:justify-end">

          <div role="tablist" aria-label="Chat Mode" className="relative flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const newMode = chatMode === "threads" ? "invocations" : "threads";
                onSetChatMode(newMode);
                // Also focus the corresponding tab
                const targetId = newMode === "threads" ? "tab-threads" : "tab-invocations";
                document.getElementById(targetId)?.focus();
              }
            }}
          >
            <div aria-hidden="true" className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform bg-slate-900 dark:bg-white" style={{ transform: chatMode === 'invocations' ? 'translateX(100%)' : 'translateX(0)', transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }} />

            <button
              id="tab-threads"
              role="tab"
              aria-selected={chatMode === "threads"}
              aria-controls="chat-panel"
              tabIndex={chatMode === "threads" ? 0 : -1}
              type="button"
              onClick={() => onSetChatMode("threads")}
              style={{
                transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`relative z-10 rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                chatMode === "threads"
                  ? "text-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Threads
            </button>
            <button
              id="tab-invocations"
              role="tab"
              aria-selected={chatMode === "invocations"}
              aria-controls="chat-panel"
              tabIndex={chatMode === "invocations" ? 0 : -1}
              type="button"
              onClick={() => onSetChatMode("invocations")}
              style={{
                transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
                transitionDuration: interactionTokens.controlFeedback.duration,
                transitionTimingFunction: interactionTokens.controlFeedback.ease,
              }}
              className={`relative z-10 rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                chatMode === "invocations"
                  ? "text-white dark:text-void-900"
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
            aria-busy={manualRefreshing}
            style={{
              transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
              transitionDuration: interactionTokens.controlFeedback.duration,
              transitionTimingFunction: interactionTokens.controlFeedback.ease,
            }}
            className="inline-flex min-w-[120px] justify-center items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} strokeWidth={2.1} />
            {manualRefreshing ? "Refreshing..." : "Refresh"}
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
        }
      />

      {(error || manualRefreshing) && (
        <div className="shrink-0">
          <ActionFeedbackRegion
            status={error ? "error" : "pending"}
            autoDismiss={error ? false : undefined}
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
