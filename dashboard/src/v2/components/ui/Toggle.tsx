import type { FunctionComponent, ComponentProps } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useGsapDurations } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export interface ToggleProps extends Omit<ComponentProps<"button">, "value" | "onChange"> {
  value: boolean;
  onChange: (value: boolean) => void;
  danger?: boolean;
}

export const Toggle: FunctionComponent<ToggleProps> = ({ value, onChange, danger, disabled, className = "", ...props }) => {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const durations = useGsapDurations();
  const reducedMotion = useReducedMotion();
  const isInitialMount = useRef(true);

  useLayoutEffect(() => {
    gsap.set(thumbRef.current, { x: value ? 20 : 0 });
  }, []);

  useLayoutEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    gsap.to(thumbRef.current, {
      x: value ? 20 : 0,
      duration: reducedMotion ? 0 : durations.base,
      ease: reducedMotion ? 'none' : 'back.out(1.7)',
      overwrite: true
    });
  }, [value, reducedMotion, durations.base]);

  return (
    <button
      {...props}
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`group relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 focus-visible:ring-[var(--color-accent-primary)] disabled:cursor-not-allowed disabled:opacity-50 motion-safe:enabled:active:scale-[0.98] ${
        value
          ? danger
            ? "border-status-red/40 bg-status-red shadow-[0_0_16px_rgba(227,0,15,0.24)] enabled:hover:bg-status-red/90"
            : "border-signal-500/40 bg-signal-500 shadow-[0_0_16px_rgba(0,224,160,0.22)] enabled:hover:bg-signal-500/90"
          : "border-black/[0.12] bg-black/[0.08] enabled:hover:bg-black/[0.12] enabled:hover:border-black/[0.16] dark:border-white/[0.12] dark:bg-white/[0.08] dark:enabled:hover:bg-white/[0.12] dark:enabled:hover:border-white/[0.16]"
      } ${className}`}
      aria-pressed={value}
    >
      <span
        aria-hidden
        className={`absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0))] transition-opacity ${value ? "opacity-100" : "opacity-40"}`}
      />
      <span
        ref={thumbRef}
        className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-[0_2px_7px_rgba(0,0,0,0.18)] group-enabled:group-active:w-6 ${
          value ? "group-enabled:group-active:translate-x-4" : ""
        }`}
      >
        <svg
          className={`h-3 w-3 transition-all duration-300 ${value ? (danger ? "text-status-red" : "text-signal-500") : "text-slate-400 dark:text-slate-500"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {value ? (
            <path d="M5 13l4 4L19 7" />
          ) : (
            <path d="M18 6L6 18M6 6l12 12" />
          )}
        </svg>
      </span>
    </button>
  );
};
