import { h, ComponentChildren, FunctionComponent, Fragment } from "preact";
import { useEffect, useState, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
  position?: "left" | "right";
  disableBackdropClick?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  initialFocusRef?: { current: HTMLElement | null };
  /** @deprecated use ariaLabelledBy */
  ariaLabelledby?: string;
  /** @deprecated use ariaDescribedBy */
  ariaDescribedby?: string;
}

export const Drawer: FunctionComponent<DrawerProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  position = "right",
  disableBackdropClick = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
  ariaLabelledby,
  ariaDescribedby,
}) => {
  const reducedMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const backdropRef = useRef<HTMLDivElement>(null);

  const containerRef = useFocusTrap(isOpen, { 
    onClose, 
    restoreFocus: true, 
    initialFocusRef 
  });

  const hasAccessibleName = ariaLabel || ariaLabelledBy || ariaLabelledby;
  const fallbackAriaLabel = !hasAccessibleName ? "Drawer" : undefined;

  const isRight = position === "right";
  const alignmentClass = isRight ? "right-0" : "left-0";
  const radiusClass = isRight ? "rounded-l-2xl" : "rounded-r-2xl";

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const xStart = isRight ? "100%" : "-100%";

      requestAnimationFrame(() => {
        if (containerRef.current) {
          gsap.fromTo(containerRef.current,
            { x: xStart },
            { x: "0%", duration: reducedMotion ? 0 : MODAL_MOTION.entry.duration, ease: MODAL_MOTION.entry.ease }
          );
        }
        if (backdropRef.current) {
          gsap.fromTo(backdropRef.current,
            { opacity: 0 },
            { opacity: 1, duration: reducedMotion ? 0 : MODAL_MOTION.backdrop.duration, ease: MODAL_MOTION.backdrop.ease }
          );
        }
      });
    } else if (shouldRender) {
      const xEnd = isRight ? "100%" : "-100%";

      const tl = gsap.timeline({
        onComplete: () => {
          setShouldRender(false);
        }
      });

      if (containerRef.current) {
        tl.to(containerRef.current, {
          x: xEnd,
          duration: reducedMotion ? 0 : MODAL_MOTION.exit.duration,
          ease: MODAL_MOTION.exit.ease,
        }, 0);
      }

      if (backdropRef.current) {
        tl.to(backdropRef.current, {
          opacity: 0,
          duration: reducedMotion ? 0 : MODAL_MOTION.backdrop.duration,
          ease: MODAL_MOTION.backdrop.ease,
        }, 0);
      }

      if (!containerRef.current && !backdropRef.current) {
        setShouldRender(false);
      }
    }
  }, [isOpen, reducedMotion, isRight]);

  useEffect(() => {
    if (shouldRender) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [shouldRender]);

  if (!shouldRender) return null;

  return (
    <Fragment>
      <div
        ref={backdropRef}
        className="fixed inset-0 z-40 bg-void-900/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget && !disableBackdropClick) {
            onClose();
          }
        }}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || fallbackAriaLabel}
        aria-labelledby={ariaLabelledBy || ariaLabelledby}
        aria-describedby={ariaDescribedBy || ariaDescribedby || undefined}
        tabIndex={-1}
        inert={!isOpen ? true : undefined}
        className={`fixed top-0 bottom-0 ${alignmentClass} z-50 w-full max-w-sm sm:max-w-md bg-white dark:bg-void-800 ${radiusClass} shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)] border-x border-black/[0.08] dark:border-white/[0.08] outline-none h-dvh max-h-dvh pb-4 overflow-y-auto overscroll-contain ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Fragment>
  );
};
