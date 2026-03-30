import type { FunctionComponent, ComponentChildren } from "preact";

export const ChatRail: FunctionComponent<{
  title: string;
  count: number;
  secondaryTitle?: string;
  secondaryCount?: number;
  children: ComponentChildren;
}> = ({ title, count, secondaryTitle, secondaryCount, children }) => {
  return (
    <aside className="flex flex-col min-h-0 rounded-[1.9rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="shrink-0 p-5 mb-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</div>
            <div className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {count}
            </div>
          </div>
          {secondaryTitle && secondaryCount !== undefined && (
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{secondaryTitle}</div>
              <div className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{secondaryCount}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-5">
        {children}
      </div>
    </aside>
  );
};
