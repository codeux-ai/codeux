import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback, useRef, useLayoutEffect } from "preact/hooks";
import { Check, X, Loader2 } from "lucide-preact";
import gsap from "gsap";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useMagnetic } from "../../hooks/use-magnetic.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export const SHARED_INTERACTION_CLASSES = "cursor-pointer transition-[background-color,border-color,color,box-shadow,opacity,transform,filter] duration-[var(--interaction-control-feedback-duration)] motion-reduce:duration-0 ease-[var(--interaction-control-feedback-ease)] motion-reduce:ease-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed motion-safe:enabled:active:scale-[0.98] enabled:active:brightness-95 dark:enabled:active:brightness-110 touch-target";

export interface ButtonProps extends ComponentProps<"button"> {
  success?: boolean;
  pending?: boolean;
  isLoading?: boolean;
  icon?: any;
  disabledReason?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "signal";
  size?: "sm" | "md" | "lg";
}

const VARIANTS = {
  primary: "bg-slate-900 text-white shadow-[var(--elevation-raised)] hover:bg-black dark:bg-white dark:text-void-900 dark:hover:bg-slate-100",
  secondary: "border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] text-slate-600 hover:text-slate-900 hover:bg-[var(--surface-glass-hover)] dark:text-slate-300 dark:hover:text-white",
  danger: "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]",
  ghost: "bg-transparent text-slate-600 hover:text-slate-900 hover:bg-[var(--fill-muted-hover)] dark:hover:text-slate-300",
  signal: "bg-signal-500 hover:bg-signal-400 text-white dark:text-void-900 shadow-[var(--elevation-raised)] aria-disabled:shadow-none",
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
  disabledReason,
  icon: Icon,
  onClick,
  ...props
}) => {
  const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);

  const isPending = pending || isLoading || feedback.status === "pending";
  const isSuccess = success || feedback.status === "success";
  const isError = feedback.status === "error";
  const isFeedbackActive = isPending || isSuccess || isError;
  const isAriaDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const gsapTokens = useGsapInteractionTokens();
  const reducedMotion = useReducedMotion();
  const tokens = useInteractionTokens();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iconContainerRef = useRef<HTMLDivElement>(null);
  const fixedWidthRef = useRef<number | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const spinnerRef = useRef<HTMLDivElement>(null);
  const lastIdleWidthRef = useRef<number | null>(null);
  const activationPendingRef = useRef(false);
  const disabledReasonIdRef = useRef<string | null>(null);
  if (disabledReasonIdRef.current === null) {
    disabledReasonIdRef.current = `button-disabled-reason-${Math.random().toString(36).slice(2)}`;
  }
  const describedBy = [
    props["aria-describedby"],
    disabledReason ? disabledReasonIdRef.current : null,
  ].filter(Boolean).join(" ") || undefined;

  useMagnetic(buttonRef, contentRef, { enabled: variant === "primary" || variant === "signal" });

  useLayoutEffect(() => {
    if (isFeedbackActive && buttonRef.current && fixedWidthRef.current === null) {
      const measuredWidth = lastIdleWidthRef.current || buttonRef.current.offsetWidth;
      if (measuredWidth > 0) {
        fixedWidthRef.current = measuredWidth;
        buttonRef.current.style.width = `${measuredWidth}px`;
      }
    } else if (!isFeedbackActive && buttonRef.current) {
      fixedWidthRef.current = null;
      buttonRef.current.style.width = "";
      const measuredWidth = buttonRef.current.offsetWidth;
      if (measuredWidth > 0) {
        lastIdleWidthRef.current = measuredWidth;
      }
    }
  }, [isFeedbackActive]);

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
          { x: 0, scale: 1, opacity: 1, duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease, clearProps: "all" }
        );
      }
    }

    if (!reducedMotion) {
      if (isPending && !prev.isPending) {
        if (spinnerRef.current) {
          gsap.fromTo(
            spinnerRef.current,
            { opacity: 0, scale: 0.7 },
            { opacity: 1, scale: 1, duration: gsapTokens.inlineValidation.duration, ease: gsapTokens.inlineValidation.ease }
          );
        }
      }

      if (isSuccess && !prev.isSuccess) {
        if (spinnerRef.current) {
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease });
        }
        if (buttonRef.current) {
          if (gsap.timeline) {
            const tl = gsap.timeline();
            tl.to(buttonRef.current, {
              boxShadow: "var(--primitive-signal-glow)",
              duration: gsapTokens.controlFeedback.duration,
              ease: gsapTokens.controlFeedback.ease,
            }).to(buttonRef.current, {
              boxShadow: "var(--primitive-signal-glow-empty)",
              duration: gsapTokens.controlFeedback.duration,
              ease: gsapTokens.controlFeedback.ease,
            });
          } else {
             gsap.to(buttonRef.current, {
              boxShadow: "var(--primitive-signal-glow)",
              duration: gsapTokens.controlFeedback.duration,
              ease: gsapTokens.controlFeedback.ease,
            });
          }
        }
      }

      if (isError && !prev.isError) {
        if (spinnerRef.current) {
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease });
        }
        if (buttonRef.current) {
          gsap.to(buttonRef.current, {
            keyframes: [{ x: -5 }, { x: 4 }, { x: -3 }, { x: 2 }, { x: 0 }],
            duration: gsapTokens.inlineValidation.duration,
            ease: gsapTokens.inlineValidation.ease,
          });
        }
      }

      if (!isPending && !isSuccess && !isError && (prev.isPending || prev.isSuccess || prev.isError)) {
        // Restore label when returning to idle
        if (spinnerRef.current) {
          gsap.to(spinnerRef.current, { opacity: 0, duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease });
        }
      }
    } else {
      // If reduced motion, keep the label visible and snap status slots immediately.
      if (labelRef.current && spinnerRef.current) {
        labelRef.current.style.opacity = "1";
        spinnerRef.current.style.opacity = isPending ? "1" : "0";
        spinnerRef.current.style.transform = isPending ? "scale(1)" : "scale(0.7)";
      }
    }

    previousState.current = { isPending, isSuccess, isError };
  }, [isPending, isSuccess, isError, gsapTokens.controlFeedback.duration, gsapTokens.controlFeedback.ease, gsapTokens.inlineValidation.duration, gsapTokens.inlineValidation.ease, reducedMotion]);

  const handleClick = useCallback(
    (e: any) => {
      if (disabled || isPending || isAriaDisabled || activationPendingRef.current) {
        e?.preventDefault();
        e?.stopPropagation();
        return;
      }
      if (!onClick) return;

      const result = (onClick as any)(e);
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
        activationPendingRef.current = true;
        setPending("");
        result
          .then(() => {
            activationPendingRef.current = false;
            setSuccess("");
          })
          .catch((err: unknown) => {
            activationPendingRef.current = false;
            setError("");
            throw err;
          });
      }
      return result;
    },
    [disabled, isPending, isAriaDisabled, onClick, setPending, setSuccess, setError]
  );

  const baseClasses = `group/btn inline-flex min-w-0 max-w-full items-center justify-center gap-2 font-bold ${SHARED_INTERACTION_CLASSES}`;
  const variantClasses = VARIANTS[variant];
  const sizeClasses = SIZES[size];

  let overrideClasses = "";
  if (isSuccess) overrideClasses = "!bg-status-green !text-white !border-status-green ring-2 ring-status-green ring-offset-2 ring-offset-white dark:ring-offset-void-900";
  else if (isError) overrideClasses = "!bg-status-red !text-white !border-transparent";
  if (isPending) overrideClasses += " pointer-events-none";
  if (variant === "danger") overrideClasses += " focus-visible:ring-[var(--focus-ring-danger)]";

  return (
    <>
      <button
        {...props}
        style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof props.style === "object" ? props.style : {}) }}
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled}
        aria-disabled={disabled || isPending || isAriaDisabled}
        aria-describedby={describedBy}
        aria-busy={isPending}
        title={props.title || disabledReason}
        className={`${baseClasses} ${variantClasses} ${sizeClasses} ${overrideClasses} relative overflow-hidden ${className}`}
      >

        <div ref={contentRef} className="flex min-w-0 max-w-full items-center justify-center gap-2">
          {(Icon || isFeedbackActive) && (
            <div ref={iconContainerRef} className="relative flex items-center justify-center w-4 h-4 shrink-0">
              <div data-active={!isPending && !isSuccess && !isError} className={`absolute inset-0 flex items-center justify-center transition-all  ${isPending || isSuccess || isError ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"}`}
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}>
                {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
              </div>
              <div ref={spinnerRef} data-active={isPending} className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all ${isPending ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}>
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              </div>
              <div key={`success-${feedback.status}`} data-active={isSuccess} className={`absolute inset-0 flex items-center justify-center transition-all  ${isSuccess ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}>
                <Check className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
              </div>
              <div key={`error-${feedback.status}`} data-active={isError} className={`absolute inset-0 flex items-center justify-center transition-all  ${isError ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}`}
                style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}>
                <X className="w-4 h-4" strokeWidth={3} aria-hidden="true" />
              </div>
            </div>
          )}
          <div className="relative flex min-w-0 max-w-full items-center justify-center">
            <span ref={labelRef} className="flex min-w-0 max-w-full items-center justify-center gap-2 truncate" style={{ opacity: 1 }}>{children}</span>
          </div>
        </div>
      </button>
      {disabledReason && <span id={disabledReasonIdRef.current ?? undefined} className="sr-only">{disabledReason}</span>}
    </>
  );
});
