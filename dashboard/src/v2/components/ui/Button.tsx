import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback, useRef, useLayoutEffect } from "preact/hooks";
import { Check, X, Loader2 } from "lucide-preact";
import gsap from "gsap";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useMagnetic } from "../../hooks/use-magnetic.js";
import { useGsapDurations, GSAP_DURATIONS, GSAP_EASINGS, GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export const SHARED_INTERACTION_CLASSES = "cursor-pointer transition-all duration-[150ms] motion-reduce:duration-0 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:ease-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent-focus-ring)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed motion-safe:active:scale-[0.98] active:brightness-95 dark:active:brightness-110 touch-target";

export interface ButtonProps extends ComponentProps<"button"> {
  success?: boolean;
  pending?: boolean;
  isLoading?: boolean;
  icon?: any;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "signal";
  size?: "sm" | "md" | "lg";
}

const VARIANTS = {
  primary: "bg-slate-900 text-white shadow-[var(--elevation-raised)] hover:bg-black dark:bg-white dark:text-void-900 dark:hover:bg-slate-100",
  secondary: "border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] text-slate-600 hover:text-slate-900 hover:bg-[var(--surface-glass-hover)] dark:text-slate-300 dark:hover:text-white",
  danger: "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]",
  ghost: "bg-transparent text-slate-600 hover:text-slate-900 hover:bg-[var(--fill-muted-hover)] dark:hover:text-slate-300",
  signal: "bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[var(--elevation-raised)] aria-disabled:shadow-none",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs rounded-[var(--radius-ui)]",
  md: "px-4 py-2 text-sm rounded-[var(--radius-ui)]",
  lg: "px-6 py-3 text-base rounded-[var(--radius-ui)]",
};

export const Button: FunctionComponent<ButtonProps> = memo(({
  children,
  className = "",
  variant = "secondary",
  size = "md",
  pending = false,
  isLoading = false,
  success = false,
  disabled,
  icon: Icon,
  onClick,
  ...props
}) => {
  const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);

  const isPending = pending || isLoading || feedback.status === "pending";
  const isSuccess = success || feedback.status === "success";
  const isError = feedback.status === "error";
  const gsapTokens = useGsapInteractionTokens();
  const durations = useGsapDurations();
  const reducedMotion = useReducedMotion();
  const tokens = useInteractionTokens();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iconContainerRef = useRef<HTMLDivElement>(null);
  const fixedWidthRef = useRef<number | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const spinnerRef = useRef<HTMLDivElement>(null);

  useMagnetic(buttonRef, contentRef, { enabled: variant === "primary" || variant === "signal" });

  useLayoutEffect(() => {
    if (isPending && buttonRef.current && fixedWidthRef.current === null) {
      fixedWidthRef.current = buttonRef.current.offsetWidth;
      buttonRef.current.style.width = `${fixedWidthRef.current}px`;
    } else if (!isPending && buttonRef.current) {
      fixedWidthRef.current = null;
      buttonRef.current.style.width = "";
    }
  }, [isPending]);

  const previousState = useRef({ isPending, isSuccess, isError });
  useLayoutEffect(() => {
    const prev = previousState.current;

    // Animate original icon container (if any)
    if (iconContainerRef.current && (prev.isPending !== isPending || prev.isSuccess !== isSuccess || prev.isError !== isError)) {
      const activeIcon = iconContainerRef.current.querySelector('[data-active="true"]');
      if (activeIcon) {
        gsap.fromTo(
          activeIcon,
          { x: -4, scale: 0.6, opacity: 0 },
          { x: 0, scale: 1, opacity: 1, duration: gsapTokens.controlFeedback.duration, ease: "power2.out", clearProps: "all" }
        );
      }
    }

    if (!reducedMotion) {
      if (isPending && !prev.isPending) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 0, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.fromTo(
            spinnerRef.current,
            { opacity: 0, scale: 0.7 },
            { opacity: 1, scale: 1, duration: durations.fast, ease: GSAP_EASINGS.spring }
          );
        }
      }

      if (isSuccess && !prev.isSuccess) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
        if (buttonRef.current) {
          if (gsap.timeline) {
            const tl = gsap.timeline();
            tl.to(buttonRef.current, {
              boxShadow: "0 0 0 6px rgba(var(--accent-primary-rgb), 0.3)",
              duration: 0.2,
              ease: "power2.out",
            }).to(buttonRef.current, {
              boxShadow: "0 0 0 0px rgba(var(--accent-primary-rgb), 0)",
              duration: 0.2,
              ease: "power2.in",
            });
          } else {
             gsap.to(buttonRef.current, {
              boxShadow: "0 0 0 6px rgba(var(--accent-primary-rgb), 0.3)",
              duration: 0.2,
              ease: "power2.out",
            });
          }
        }
      }

      if (isError && !prev.isError) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
        if (buttonRef.current) {
          gsap.to(buttonRef.current, {
            keyframes: [{ x: -5 }, { x: 4 }, { x: -3 }, { x: 2 }, { x: 0 }],
            duration: 0.3,
            ease: "none",
          });
        }
      }

      if (!isPending && !isSuccess && !isError && (prev.isPending || prev.isSuccess || prev.isError)) {
        // Restore label when returning to idle
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
      }
    } else {
      // If reduced motion, just ensure visibility states immediately without animation
      if (labelRef.current && spinnerRef.current) {
        labelRef.current.style.opacity = isPending ? "0" : "1";
        spinnerRef.current.style.opacity = isPending ? "1" : "0";
        spinnerRef.current.style.transform = isPending ? "scale(1)" : "scale(0.7)";
      }
    }

    previousState.current = { isPending, isSuccess, isError };
  }, [isPending, isSuccess, isError, durations.fast, reducedMotion]);

  const handleClick = useCallback(
    (e: any) => {
      if (disabled || isPending || props["aria-disabled"] === true || props["aria-disabled"] === "true") {
        e?.preventDefault();
        e?.stopPropagation();
        return;
      }
      if (!onClick) return;

      const result = (onClick as any)(e);
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
        setPending("");
        result
          .then(() => setSuccess(""))
          .catch((err: unknown) => {
            setError("");
            throw err;
          });
      }
      return result;
    },
    [onClick, isPending, setPending, setSuccess, setError]
  );

  const baseClasses = `group/btn inline-flex items-center justify-center gap-2 font-bold ${SHARED_INTERACTION_CLASSES}`;
  const variantClasses = VARIANTS[variant];
  const sizeClasses = SIZES[size];

    let overrideClasses = "";
  if (isSuccess) overrideClasses = "!bg-status-green !text-white !border-status-green ring-2 ring-status-green ring-offset-2 ring-offset-white dark:ring-offset-void-900";
  else if (isError) overrideClasses = "!bg-status-red !text-white !border-transparent";
  if (isPending) overrideClasses += " pointer-events-none";

  return (
    <button
      {...props}
      style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
      ref={buttonRef}
      onClick={handleClick}
      disabled={disabled && !isPending}
      aria-disabled={disabled || isPending || props["aria-disabled"] === true || props["aria-disabled"] === "true"}
      aria-busy={isPending}
      className={`${baseClasses} ${variantClasses} ${sizeClasses} ${overrideClasses} relative overflow-hidden ${className}`}
    >

      <div ref={contentRef} className={`flex items-center justify-center gap-2`}>
        {(Icon || isSuccess || isError) && (
          <div ref={iconContainerRef} className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <div data-active={!isPending && !isSuccess && !isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isPending || isSuccess || isError ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}>
              {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
            </div>
            <div key={`success-${feedback.status}`} data-active={isSuccess} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isSuccess ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>
            <div key={`error-${feedback.status}`} data-active={isError} className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${isError ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}>
              <X className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
            </div>
          </div>
        )}
        <div className="relative flex items-center justify-center">
          <span ref={labelRef} className="flex items-center justify-center gap-2" style={{ opacity: isPending ? 0 : 1 }}>{children}</span>
          <div ref={spinnerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: isPending ? 1 : 0, transform: isPending ? "scale(1)" : "scale(0.7)" }}>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          </div>
        </div>
      </div>
    </button>
  );
});
