import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { MessageCircle, Plus } from "lucide-preact";
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
  onCreateThread: () => void;
  pendingDashboardMessages: number;
  error: string | null;
  railSlot: ComponentChildren;
  detailSlot: ComponentChildren;
}> = ({
  selectedProject,
  chatMode,
  onSetChatMode,
  onCreateThread,
  pendingDashboardMessages,
  error,
  railSlot,
  detailSlot,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const interactionTokens = useInteractionTokens();
  const threadsTabRef = useRef<HTMLButtonElement>(null);
  const invocationsTabRef = useRef<HTMLButtonElement>(null);
  const [indicatorRect, setIndicatorRect] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const activeTab = chatMode === "threads" ? threadsTabRef.current : invocationsTabRef.current;
    if (!activeTab) return;
    setIndicatorRect({ left: activeTab.offsetLeft, width: activeTab.offsetWidth });
  }, [chatMode]);

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
    <PageContainer padding="chat" className="min-h-0 flex-1 flex flex-col gap-6 lg:gap-8 h-full overflow-hidden">
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
            <div
              aria-hidden="true"
              className="absolute inset-y-1 rounded-full bg-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_1px_8px_rgba(0,0,0,0.06)] dark:bg-white dark:shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
              style={{
                left: indicatorRect ? `${indicatorRect.left}px` : 0,
                width: indicatorRect ? `${indicatorRect.width}px` : 0,
                opacity: indicatorRect ? 1 : 0,
                transitionProperty: "left, width, opacity",
                transitionDuration: interactionTokens.selectionMovement.duration,
                transitionTimingFunction: interactionTokens.selectionMovement.ease,
              }}
            />

            <button
              ref={threadsTabRef}
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
              ref={invocationsTabRef}
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
          <span
            style={{
              transitionProperty: "color, background-color, border-color, opacity",
              transitionDuration: interactionTokens.controlFeedback.duration,
              transitionTimingFunction: interactionTokens.controlFeedback.ease,
            }}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] ${
              chatMode !== "threads"
                ? "border-black/[0.06] bg-white/70 text-slate-400 opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-500"
                : pendingDashboardMessages > 0
                  ? "border-status-amber/30 bg-status-amber/10 text-status-amber"
                  : "border-signal-500/20 bg-signal-500/10 text-signal-500"
            }`}
          >
            {chatMode === "threads" && pendingDashboardMessages > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-amber opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-status-amber"></span>
              </span>
            )}
            {chatMode === "threads" && pendingDashboardMessages > 0 ? <>{pendingDashboardMessages} pending<span className="sr-only"> messages</span></> : "Inbox clear"}
          </span>
          <button
            type="button"
            onClick={onCreateThread}
            disabled={!selectedProject || chatMode !== "threads"}
            style={{
              transitionProperty: "color, background-color, border-color, opacity, text-decoration-color, fill, stroke",
              transitionDuration: interactionTokens.controlFeedback.duration,
              transitionTimingFunction: interactionTokens.controlFeedback.ease,
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] disabled:cursor-not-allowed ${
              chatMode === "threads"
                ? "bg-signal-500 text-void-900 hover:bg-signal-400 disabled:opacity-50"
                : "bg-black/[0.06] text-slate-400 opacity-50 dark:bg-white/[0.06] dark:text-slate-500"
            }`}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
            New Thread
          </button>
        </div>
        }
      />

      {error && (
        <div className="shrink-0">
          <ActionFeedbackRegion
            status="error"
            autoDismiss={false}
            message={error}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] gap-6 pb-6">
        {railSlot}
        <section className="flex flex-col min-h-0 flex-1 overflow-hidden rounded-3xl border border-black/[0.06] bg-white/80 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          {detailSlot}
        </section>
      </div>
    </PageContainer>
  );
};
