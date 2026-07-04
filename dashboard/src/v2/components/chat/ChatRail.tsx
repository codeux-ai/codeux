import type { FunctionComponent, ComponentChildren } from "preact";

export const ChatRail: FunctionComponent<{
  title: string;
  count: number;
  secondaryTitle?: string;
  secondaryCount?: number;
  children: ComponentChildren;
}> = ({ title, count, secondaryTitle, secondaryCount, children }) => {
  return (
    <aside aria-label={title} className="flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-black/[0.07] bg-white/82 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/78 dark:shadow-[0_22px_70px_rgba(0,0,0,0.28)] min-h-[16rem] max-h-[40vh] md:min-h-0 md:max-h-none md:h-full lg:max-h-full">
      <div className="shrink-0 border-b border-black/[0.05] px-5 py-4 dark:border-white/[0.06]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</h2>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white">
              {count}
            </div>
          </div>
          {secondaryTitle && secondaryCount !== undefined && (
            <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 text-right dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{secondaryTitle}</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">{secondaryCount}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {children}
      </div>
    </aside>
  );
};
