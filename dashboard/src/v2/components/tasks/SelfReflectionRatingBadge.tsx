import type { FunctionComponent } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ListChecks, Star } from "lucide-preact";
import type { TaskSelfReflectionRating } from "../../../../../src/contracts/task-self-reflection-types.js";
import {
  buildSelfReflectionRatingViewModel,
  type SelfReflectionStarState,
} from "../../lib/tasks/self-reflection-rating.js";
import { calculatePosition, type Alignment, type Position } from "../../lib/positioning/index.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

interface SelfReflectionRatingBadgeProps {
  rating: TaskSelfReflectionRating | null | undefined;
  className?: string;
  position?: Position;
  align?: Alignment;
}

export const SelfReflectionRatingBadge: FunctionComponent<SelfReflectionRatingBadgeProps> = ({
  rating,
  className = "",
  position = "bottom",
  align = "center",
}) => {
  const { locale, translate } = useOptionalDashboardI18n();
  const viewModel = buildSelfReflectionRatingViewModel(rating, locale);
  const [overlayId] = useState(() => `self-reflection-rating-${Math.random().toString(36).slice(2, 10)}`);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openOverlay = useCallback(() => {
    clearCloseTimeout();
    setIsOpen(true);
  }, [clearCloseTimeout]);

  const closeOverlay = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimeoutRef.current = null;
    }, 100);
  }, [clearCloseTimeout]);

  const updateOverlayPosition = useCallback(() => {
    if (!triggerRef.current || !overlayRef.current) {
      return;
    }

    const nextCoords = calculatePosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      contentRect: overlayRef.current.getBoundingClientRect(),
      position,
      align,
      gap: 8,
      padding: 12,
    });

    setCoords(nextCoords);
  }, [align, position]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    updateOverlayPosition();
  }, [isOpen, updateOverlayPosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearCloseTimeout();
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateOverlayPosition);
    window.addEventListener("scroll", updateOverlayPosition, { capture: true, passive: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateOverlayPosition);
      window.removeEventListener("scroll", updateOverlayPosition, { capture: true });
    };
  }, [clearCloseTimeout, isOpen, updateOverlayPosition]);

  useEffect(() => () => clearCloseTimeout(), [clearCloseTimeout]);

  if (!viewModel) {
    return null;
  }

  return (
    <span
      className={`relative inline-flex min-w-[6.75rem] max-w-full shrink-0 ${className}`}
      onMouseEnter={openOverlay}
      onMouseLeave={closeOverlay}
      onFocus={openOverlay}
      onBlur={closeOverlay}
    >
      <span
        ref={triggerRef}
        role="meter"
        tabIndex={0}
        onFocus={openOverlay}
        onBlur={closeOverlay}
        onFocusCapture={openOverlay}
        onBlurCapture={closeOverlay}
        aria-label={viewModel.overallAriaLabel}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={viewModel.overallRating}
        aria-valuetext={viewModel.overallAriaLabel}
        aria-describedby={isOpen ? overlayId : undefined}
        className="inline-flex h-6 min-w-[6.75rem] items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-2 text-[10px] font-bold text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.08)] outline-none transition-colors duration-200 hover:border-signal-500/35 focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none dark:border-white/[0.1] dark:bg-void-800/85 dark:text-slate-200 dark:focus-visible:ring-offset-void-900"
      >
        <StarStrip states={viewModel.overallStarStates} sizeClassName="h-3 w-3" />
        <span className="font-mono text-[10px] leading-none text-slate-600 dark:text-slate-300">
          {viewModel.overallRatingLabel}
        </span>
      </span>

      {isOpen && typeof document !== "undefined" && document.body ? createPortal(
        <div
          id={overlayId}
          ref={overlayRef}
          role="tooltip"
          className="fixed z-[99999] max-w-[calc(100vw-1.5rem)] opacity-100 transition-opacity duration-150 motion-reduce:transition-none"
          style={{ top: coords.top, left: coords.left }}
          onMouseEnter={openOverlay}
          onMouseLeave={closeOverlay}
        >
          <div className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1rem] border border-black/[0.08] bg-white shadow-[0_20px_48px_rgba(15,23,42,0.18),0_0_0_1px_rgba(0,0,0,0.03)] dark:border-white/[0.08] dark:bg-void-800">
            <div className="border-b border-black/[0.06] bg-black/[0.02] px-3.5 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                  <ListChecks className="h-3.5 w-3.5 shrink-0 text-signal-600 dark:text-signal-400" aria-hidden="true" strokeWidth={2.5} />
                  <span className="truncate">{translate(taskMessages, "selfReflectionRating")}</span>
                </div>
                <span className="shrink-0 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  {viewModel.overallRatingLabel}
                </span>
              </div>
              <span className="sr-only">{viewModel.overallAriaLabel}</span>
            </div>

            {viewModel.sections.length > 0 ? (
              <ul className="max-h-[18rem] overflow-y-auto p-2.5 dropdown-scrollbar">
                {viewModel.sections.map((section) => (
                  <li
                    key={section.normalizedLabel || section.label}
                    data-self-reflection-section="true"
                    className="grid gap-1.5 rounded-xl px-2.5 py-2.5 text-left odd:bg-black/[0.02] dark:odd:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {section.label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {section.ratingLabel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <StarStrip states={section.starStates} sizeClassName="h-3.5 w-3.5" />
                      <span className="sr-only">{section.ariaLabel}</span>
                    </div>
                    {section.note ? (
                      <p className="text-xs leading-snug text-slate-500 dark:text-slate-400">
                        {section.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-xs text-slate-500 dark:text-slate-400">
                {translate(taskMessages, "noSectionRatings")}
              </p>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </span>
  );
};

interface StarStripProps {
  states: readonly SelfReflectionStarState[];
  sizeClassName: string;
}

const StarStrip: FunctionComponent<StarStripProps> = ({ states, sizeClassName }) => (
  <span className="inline-grid w-[3.75rem] shrink-0 grid-cols-5 gap-0.5 text-signal-600 dark:text-signal-400" aria-hidden="true">
    {states.map((state, index) => (
      <StarGlyph key={`${state}-${index}`} state={state} sizeClassName={sizeClassName} />
    ))}
  </span>
);

interface StarGlyphProps {
  state: SelfReflectionStarState;
  sizeClassName: string;
}

const StarGlyph: FunctionComponent<StarGlyphProps> = ({ state, sizeClassName }) => {
  if (state === "half") {
    return (
      <span className={`relative inline-flex ${sizeClassName}`} data-star-state={state}>
        <Star className={`${sizeClassName} text-slate-300 dark:text-slate-600`} aria-hidden="true" strokeWidth={2.2} />
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
          <Star className={`${sizeClassName} fill-current`} aria-hidden="true" strokeWidth={2.2} />
        </span>
      </span>
    );
  }

  return (
    <Star
      className={`${sizeClassName} ${state === "filled" ? "fill-current" : "text-slate-300 dark:text-slate-600"}`}
      data-star-state={state}
      aria-hidden="true"
      strokeWidth={2.2}
    />
  );
};
