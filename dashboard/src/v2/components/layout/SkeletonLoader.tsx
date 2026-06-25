import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

const SkeletonBlock: FunctionComponent<{ className?: string }> = ({ className = "" }) => {
  const isReducedMotion = useReducedMotion();

  if (isReducedMotion) {
    return <div className={`bg-slate-200 dark:bg-void-700 ${className}`} />;
  }

  return (
    <div
      className={`bg-slate-200 dark:bg-void-700 bg-[linear-gradient(90deg,_transparent_0%,_rgba(255,255,255,0.4)_50%,_transparent_100%)] dark:bg-[linear-gradient(90deg,_transparent_0%,_rgba(255,255,255,0.06)_50%,_transparent_100%)] bg-[length:200%_100%] animate-skeleton-shimmer ${className}`}
    />
  );
};

export const SkeletonLoader: FunctionComponent<{
  show: boolean;
  children?: ComponentChildren;
  skeleton?: ComponentChildren;
  className?: string;
}> = ({ show, children, skeleton, className }) => {
  const [renderSkeleton, setRenderSkeleton] = useState(show);
  const [renderChildren, setRenderChildren] = useState(!show);
  const isReducedMotion = useReducedMotion();

  useEffect(() => {
    if (show) {
      setRenderSkeleton(true);
      if (isReducedMotion) {
        setRenderChildren(false);
      } else {
        const timeout = setTimeout(() => setRenderChildren(false), 200);
        return () => clearTimeout(timeout);
      }
    } else {
      setRenderChildren(true);
      if (isReducedMotion) {
        setRenderSkeleton(false);
      } else {
        const timeout = setTimeout(() => setRenderSkeleton(false), 200);
        return () => clearTimeout(timeout);
      }
    }
  }, [show, isReducedMotion]);

  const durationClass = isReducedMotion ? "duration-0" : "duration-200";

  return (
    <div
      className={`grid grid-cols-1 grid-rows-1 ${className || ""}`}
      aria-busy={show}
    >
      {renderSkeleton && (
        <div
          className={`col-start-1 row-start-1 transition-opacity ${durationClass} ease-in-out ${
            show ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        >
          {skeleton || children}
        </div>
      )}
      {renderChildren && children && (
        <div
          className={`col-start-1 row-start-1 transition-opacity ${durationClass} ease-in-out ${
            !show ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export const SkeletonRow: FunctionComponent = () => (
  <div
    className="relative overflow-hidden flex h-16 w-full items-center gap-4 rounded-2xl border border-black/[0.04] bg-black/[0.02] px-5 dark:border-white/[0.04] dark:bg-white/[0.02]"
  >
    <span className="sr-only">Loading row...</span>
    <SkeletonBlock className="h-4 w-4 rounded" />
    <SkeletonBlock className="h-4 w-1/4 rounded" />
    <SkeletonBlock className="ml-auto h-6 w-20 rounded-full" />
    <SkeletonBlock className="h-8 w-8 rounded-full" />
  </div>
);

export const SkeletonCard: FunctionComponent = () => (
  <div
    className="skeleton-card-entry relative overflow-hidden flex h-40 w-full flex-col gap-4 rounded-2xl border border-black/[0.04] bg-black/[0.02] p-5 dark:border-white/[0.04] dark:bg-white/[0.02]"
  >
    <span className="sr-only">Loading card...</span>
    <div className="flex items-center justify-between">
      <SkeletonBlock className="h-5 w-1/3 rounded" />
      <SkeletonBlock className="h-6 w-16 rounded-full" />
    </div>
    <div className="mt-2 h-4 w-2/3 rounded" />
    <div className="mt-auto flex items-center justify-between">
      <div className="flex gap-2">
        <SkeletonBlock className="h-6 w-6 rounded-full" />
        <SkeletonBlock className="h-6 w-6 rounded-full" />
      </div>
      <SkeletonBlock className="h-4 w-12 rounded" />
    </div>
  </div>
);

export const SkeletonPanel: FunctionComponent = () => (
  <div
    className="skeleton-panel-entry relative overflow-hidden flex h-64 w-full flex-col gap-6 rounded-2xl border border-black/[0.04] bg-black/[0.02] p-7 dark:border-white/[0.04] dark:bg-white/[0.02]"
  >
    <span className="sr-only">Loading panel...</span>
    <SkeletonBlock className="h-6 w-1/4 rounded" />
    <div className="flex flex-col gap-3">
      <SkeletonBlock className="h-4 w-full rounded" />
      <SkeletonBlock className="h-4 w-5/6 rounded" />
      <SkeletonBlock className="h-4 w-4/6 rounded" />
    </div>
    <div className="mt-auto flex gap-3">
      <SkeletonBlock className="h-10 w-24 rounded-xl" />
      <SkeletonBlock className="h-10 w-24 rounded-xl" />
    </div>
  </div>
);
