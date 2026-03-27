import type { FunctionComponent, ComponentChildren } from "preact";

interface Props {
  isUser: boolean;
  children: ComponentChildren;
  className?: string;
}

export const ChatSurfaceCard: FunctionComponent<Props> = ({ isUser, children, className = "" }) => {
  return (
    <div
      className={`rounded-[1.5rem] px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
        isUser
          ? "rounded-tr-sm border border-signal-500/20 bg-signal-500/10 text-slate-900 dark:text-white"
          : "rounded-tl-sm border border-black/[0.06] bg-white/75 text-slate-700 dark:border-white/[0.06] dark:bg-void-800/70 dark:text-slate-200"
      } ${className}`}
    >
      {children}
    </div>
  );
};
