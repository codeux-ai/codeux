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
}

export const Drawer: FunctionComponent<DrawerProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  position = "right",
  disableBackdropClick = false,
}) => {
  const reducedMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const backdropRef = useRef<HTMLDivElement>(null);

  const containerRef = useFocusTrap(isOpen && shouldRender, {
    onClose,
    restoreFocus: true
  });

  const isRight = position === "right";
  const alignmentClass = isRight ? "right-0" : "left-0";

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const xStart = isRight ? "100%" : "-100%";

      requestAnimationFrame(() => {
        if (containerRef.current) {
          gsap.fromTo(containerRef.current,
            { x: xStart },
            { x: "0%", duration: reducedMotion ? 0 : MODAL_MOTION.overlay.cardEntry, ease: MODAL_MOTION.overlay.cardEntryEase }
          );
        }
        if (backdropRef.current) {
          gsap.fromTo(backdropRef.current,
            { opacity: 0 },
            { opacity: 1, duration: reducedMotion ? 0 : MODAL_MOTION.overlay.entry, ease: MODAL_MOTION.overlay.entryEase }
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
          duration: reducedMotion ? 0 : MODAL_MOTION.overlay.exit,
          ease: MODAL_MOTION.overlay.exitEase,
        }, 0);
      }

      if (backdropRef.current) {
        tl.to(backdropRef.current, {
          opacity: 0,
          duration: reducedMotion ? 0 : MODAL_MOTION.overlay.exit,
          ease: MODAL_MOTION.overlay.exitEase,
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
        tabIndex={-1}
        className={`fixed top-0 bottom-0 ${alignmentClass} z-50 w-full max-w-md bg-white dark:bg-void-800 rounded-[12px] shadow-lg border-x border-black/[0.06] dark:border-white/[0.06] outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Fragment>
  );
};
