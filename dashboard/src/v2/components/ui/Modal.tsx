import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { Overlay } from "./Overlay.js";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
  disableBackdropClick?: boolean;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
}

export const Modal: FunctionComponent<ModalProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  disableBackdropClick = false,
  ariaLabelledby,
  ariaDescribedby,
}) => {
  const reducedMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(isOpen, { onClose, restoreFocus: true });

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const duration = reducedMotion ? 0 : 0.2;

      // Delay slightly to ensure ref is populated before animating
      requestAnimationFrame(() => {
        if (cardRef.current) {
          gsap.fromTo(cardRef.current,
            { opacity: 0, scale: 0.95 },
            { opacity: 1, scale: 1, duration, ease: "power2.out" }
          );
        }
      });
    } else {
      const duration = reducedMotion ? 0 : 0.15;
      if (cardRef.current) {
        gsap.to(cardRef.current, {
          opacity: 0,
          scale: 0.95,
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
  }, [isOpen, reducedMotion]);

  if (!shouldRender) return null;

  return (
    <Overlay isOpen={isOpen} onClose={disableBackdropClick ? undefined : onClose} blur exitDuration={150}>
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
        className={`relative z-50 bg-white dark:bg-void-800 rounded-[12px] shadow-lg border border-black/[0.06] dark:border-white/[0.06] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Overlay>
  );
};
