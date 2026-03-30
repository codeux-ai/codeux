import type { FunctionComponent } from "preact";
import { MessageCircle } from "lucide-preact";

export const EmptyChat: FunctionComponent<{ message: string }> = ({ message }) => (
  <div className="flex h-full min-h-0 items-center justify-center rounded-[1.9rem] border border-dashed border-signal-500/20 bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-signal-500/20 dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="space-y-3">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-signal-500/10 text-signal-500">
        <MessageCircle className="h-6 w-6" strokeWidth={1.6} />
      </div>
      <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">No Chat Thread Yet</h3>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  </div>
);

export const LoadingChat: FunctionComponent<{ label: string }> = ({ label }) => (
  <div className="flex h-full min-h-0 items-center justify-center rounded-[1.9rem] border border-dashed border-black/[0.06] bg-white/70 p-8 text-center shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="space-y-4">
      <div className="mx-auto flex items-center justify-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:140ms]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-signal-500 [animation-delay:280ms]" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-signal-500">{label}</div>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Sprint OS is loading the latest stored conversation state.
      </p>
    </div>
  </div>
);
