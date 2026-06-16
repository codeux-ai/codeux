import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useGsapDurations } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export interface EmptyStateProps {
  icon?: ComponentChildren;
  title: string;
  description?: string;
  /**
   * The primary action to take from this empty state.
   * If provided alongside `children`, `children` will be treated as secondary actions
   * and visually de-emphasized to ensure the primary action stands out.
   */
  primaryAction?: ComponentChildren;
  children?: ComponentChildren;
}

export const EmptyState: FunctionComponent<EmptyStateProps> = ({
  icon,
  title,
  description,
  primaryAction,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const durations = useGsapDurations();

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    gsap.fromTo(
      containerRef.current,
      { opacity: 0, y: reducedMotion ? 0 : 12 },
      { opacity: 1, y: 0, duration: durations.slow, ease: 'power2.out' }
    );
  }, [reducedMotion, durations.slow]);

  return (
    <div ref={containerRef} className="flex w-full flex-col items-center justify-center p-12 text-center">
      {icon && (
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-500 shadow-sm ring-1 ring-slate-900/5 dark:bg-white/[0.04] dark:text-slate-400 dark:ring-white/[0.06]">
          {icon}
        </div>
      )}
      <h3 className="mb-2 font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {title}
      </h3>
      {description && (
        <p className="mb-8 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {(primaryAction || children) && (
        <div className="mt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
          {primaryAction && (
            <div className="flex-shrink-0">
              {primaryAction}
            </div>
          )}
          {children && (
            <div className={primaryAction ? "flex items-center gap-3 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100" : "flex items-center gap-3"}>
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
