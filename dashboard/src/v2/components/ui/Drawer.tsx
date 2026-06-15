import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { Overlay } from "./Overlay.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
  position?: "left" | "right";
  disableBackdropClick?: boolean;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
}

export const Drawer: FunctionComponent<DrawerProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  position = "right",
  disableBackdropClick = false,
  ariaLabelledby,
  ariaDescribedby,
}) => {
  const reducedMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(isOpen, { onClose, restoreFocus: true });

  const isRight = position === "right";
  const alignmentClass = isRight ? "right-0" : "left-0";

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const duration = reducedMotion ? 0 : 0.35;
      const xStart = isRight ? "100%" : "-100%";

      requestAnimationFrame(() => {
        if (cardRef.current) {
          gsap.fromTo(cardRef.current,
            { x: xStart },
            { x: "0%", duration, ease: "back.out(1.1)" }
          );
        }
      });
    } else {
      const duration = reducedMotion ? 0 : 0.25;
      const xEnd = isRight ? "100%" : "-100%";

      if (cardRef.current) {
        gsap.to(cardRef.current, {
          x: xEnd,
          duration,
          ease: "power2.in",
          onComplete: () => {
            setShouldRender(false);
          }
        });
      } else {
        setShouldRender(false);
      }
    }
  }, [isOpen, reducedMotion, isRight]);

  if (!shouldRender) return null;

  return (
    <Overlay isOpen={isOpen} onClose={disableBackdropClick ? undefined : onClose} blur exitDuration={250}>
      <div className="absolute inset-0 bg-slate-900/50 pointer-events-none" />
      <div
        ref={(el) => {
          (cardRef as any).current = el;
          (trapRef as any).current = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        className={`fixed top-0 bottom-0 ${alignmentClass} z-50 w-full max-w-md bg-white dark:bg-void-800 rounded-[12px] shadow-lg border-x border-black/[0.06] dark:border-white/[0.06] ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Overlay>
  );
};
