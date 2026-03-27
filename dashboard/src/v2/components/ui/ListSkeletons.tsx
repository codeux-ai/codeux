import type { FunctionComponent } from "preact";

export const SkeletonRow: FunctionComponent = () => (
  <div className="flex h-16 w-full animate-pulse items-center gap-4 rounded-xl border border-black/[0.04] bg-black/[0.02] px-5 dark:border-white/[0.04] dark:bg-white/[0.02]">
    <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700/50" />
    <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-700/50" />
    <div className="ml-auto h-6 w-20 rounded-full bg-slate-200 dark:bg-slate-700/50" />
    <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700/50" />
  </div>
);

export const SkeletonCard: FunctionComponent = () => (
  <div className="flex h-40 w-full animate-pulse flex-col gap-4 rounded-xl border border-black/[0.04] bg-black/[0.02] p-5 dark:border-white/[0.04] dark:bg-white/[0.02]">
    <div className="flex items-center justify-between">
      <div className="h-5 w-1/3 rounded bg-slate-200 dark:bg-slate-700/50" />
      <div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700/50" />
    </div>
    <div className="mt-2 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700/50" />
    <div className="mt-auto flex items-center justify-between">
      <div className="flex gap-2">
        <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700/50" />
        <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700/50" />
      </div>
      <div className="h-4 w-12 rounded bg-slate-200 dark:bg-slate-700/50" />
    </div>
  </div>
);

export const SkeletonPanel: FunctionComponent = () => (
  <div className="flex h-64 w-full animate-pulse flex-col gap-6 rounded-xl border border-black/[0.04] bg-black/[0.02] p-7 dark:border-white/[0.04] dark:bg-white/[0.02]">
    <div className="h-6 w-1/4 rounded bg-slate-200 dark:bg-slate-700/50" />
    <div className="flex flex-col gap-3">
      <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-700/50" />
      <div className="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-700/50" />
      <div className="h-4 w-4/6 rounded bg-slate-200 dark:bg-slate-700/50" />
    </div>
    <div className="mt-auto flex gap-3">
      <div className="h-10 w-24 rounded-xl bg-slate-200 dark:bg-slate-700/50" />
      <div className="h-10 w-24 rounded-xl bg-slate-200 dark:bg-slate-700/50" />
    </div>
  </div>
);
