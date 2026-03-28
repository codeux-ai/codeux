import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { MessageCircle, RefreshCw, Plus } from "lucide-preact";
import type { Source } from "../../types.js";
import { DeepOceanBackground } from "./DeepOceanBackground.js";

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

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" }
    );
  }, []);

  return (
    <div className="relative h-[calc(100vh-48px)]">
      <DeepOceanBackground />
    <div className="relative z-10 mx-auto flex h-full max-w-[1900px] flex-col gap-8 px-8 py-12 md:px-20">
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
          <p className="max-w-2xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
            {selectedProject
              ? `Messages sent here are stored in Sprint OS and routed toward listening MCP connections for ${selectedProject.name}.`
              : "Select a project to inspect its conversation threads and route dashboard messages to connected listeners."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => onSetChatMode("threads")}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                chatMode === "threads"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Threads
            </button>
            <button
              type="button"
              onClick={() => onSetChatMode("invocations")}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
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
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                {activeConnectionLabel || "Unassigned"}
              </span>
              <span className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${
                pendingDashboardMessages > 0
                  ? "border-status-amber/30 bg-status-amber/10 text-status-amber"
                  : "border-signal-500/20 bg-signal-500/10 text-signal-500"
              }`}>
                {pendingDashboardMessages > 0 ? `${pendingDashboardMessages} pending` : "Inbox clear"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={manualRefreshing}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} strokeWidth={2.1} />
            Refresh
          </button>
          {chatMode === "threads" && (
            <button
              type="button"
              onClick={onCreateThread}
              disabled={!selectedProject}
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-void-900 transition-colors hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
              New Thread
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded-[1.4rem] border border-status-red/20 bg-status-red/10 px-5 py-4 text-sm text-status-red">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[360px_minmax(0,1fr)] gap-6 pb-6">
        {railSlot}
        <section className="flex flex-col min-h-0 flex-1 rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          {detailSlot}
        </section>
      </div>
    </div>
    </div>
  );
};
