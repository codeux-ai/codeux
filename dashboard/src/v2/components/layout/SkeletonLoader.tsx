import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

const Shimmer = () => (
  <div
    className="absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite_linear] pointer-events-none bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:from-transparent dark:via-white/[0.04] dark:to-transparent"
  />
);

export const SkeletonLoader: FunctionComponent<{ show: boolean; children?: ComponentChildren; skeleton?: ComponentChildren; className?: string }> = ({ show, children, skeleton, className }) => {
  const [renderSkeleton, setRenderSkeleton] = useState(show);
  const [renderChildren, setRenderChildren] = useState(!show);

  useEffect(() => {
    if (show) {
      setRenderSkeleton(true);
      const timeout = setTimeout(() => setRenderChildren(false), 200);
      return () => clearTimeout(timeout);
    } else {
      setRenderChildren(true);
      const timeout = setTimeout(() => setRenderSkeleton(false), 200);
      return () => clearTimeout(timeout);
    }
  }, [show]);

  return (
    <div className={`grid grid-cols-1 grid-rows-1 ${className || ''}`}>
      {renderSkeleton && (
        <div className={`col-start-1 row-start-1 transition-opacity duration-200 ease-in-out ${show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {skeleton || children}
        </div>
      )}
      {renderChildren && children && skeleton && (
        <div className={`col-start-1 row-start-1 transition-opacity duration-200 ease-in-out ${!show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {children}
        </div>
      )}
      {!skeleton && children && (
        <div className={`col-start-1 row-start-1 transition-opacity duration-200 ease-in-out ${!show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {children}
        </div>
      )}
    </div>
  );
};

export const SkeletonRow: FunctionComponent = () => (
  <div
    className="relative overflow-hidden flex h-16 w-full items-center gap-4 rounded-2xl border border-black/[0.04] bg-black/[0.02] px-5 dark:border-white/[0.04] dark:bg-white/[0.02]"
    aria-busy="true"
  >
    <Shimmer />
    <span className="sr-only">Loading row...</span>
    <div className="h-4 w-4 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    <div className="h-4 w-1/4 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    <div className="ml-auto h-6 w-20 rounded-full bg-slate-200/50 dark:bg-slate-700/30" />
    <div className="h-8 w-8 rounded-full bg-slate-200/50 dark:bg-slate-700/30" />
  </div>
);

export const SkeletonCard: FunctionComponent = () => (
  <div
    className="skeleton-card-entry relative overflow-hidden flex h-40 w-full flex-col gap-4 rounded-[1.25rem] border border-black/[0.04] bg-black/[0.02] p-5 dark:border-white/[0.04] dark:bg-white/[0.02]"
    aria-busy="true"
  >
    <Shimmer />
    <span className="sr-only">Loading card...</span>
    <div className="flex items-center justify-between">
      <div className="h-5 w-1/3 rounded bg-slate-200/50 dark:bg-slate-700/30" />
      <div className="h-6 w-16 rounded-full bg-slate-200/50 dark:bg-slate-700/30" />
    </div>
    <div className="mt-2 h-4 w-2/3 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    <div className="mt-auto flex items-center justify-between">
      <div className="flex gap-2">
        <div className="h-6 w-6 rounded-full bg-slate-200/50 dark:bg-slate-700/30" />
        <div className="h-6 w-6 rounded-full bg-slate-200/50 dark:bg-slate-700/30" />
      </div>
      <div className="h-4 w-12 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    </div>
  </div>
);

export const SkeletonPanel: FunctionComponent = () => (
  <div
    className="skeleton-panel-entry relative overflow-hidden flex h-64 w-full flex-col gap-6 rounded-[1.75rem] border border-black/[0.04] bg-black/[0.02] p-7 dark:border-white/[0.04] dark:bg-white/[0.02]"
    aria-busy="true"
  >
    <Shimmer />
    <span className="sr-only">Loading panel...</span>
    <div className="h-6 w-1/4 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    <div className="flex flex-col gap-3">
      <div className="h-4 w-full rounded bg-slate-200/50 dark:bg-slate-700/30" />
      <div className="h-4 w-5/6 rounded bg-slate-200/50 dark:bg-slate-700/30" />
      <div className="h-4 w-4/6 rounded bg-slate-200/50 dark:bg-slate-700/30" />
    </div>
    <div className="mt-auto flex gap-3">
      <div className="h-10 w-24 rounded-xl bg-slate-200/50 dark:bg-slate-700/30" />
      <div className="h-10 w-24 rounded-xl bg-slate-200/50 dark:bg-slate-700/30" />
    </div>
  </div>
);
