import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { Overlay } from "./Overlay.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
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

export const Dialog: FunctionComponent<DialogProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  disableBackdropClick = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
  ariaLabelledby,
  ariaDescribedby,
}) => {
  const reducedMotion = useReducedMotion();
  const cssTokens = useInteractionTokens();
  const gsapTokens = useGsapInteractionTokens();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);

  const trapRef = useFocusTrap(isOpen, { onClose, restoreFocus: true, initialFocusRef });

  const hasAccessibleName = ariaLabel || ariaLabelledBy || ariaLabelledby;
  const fallbackAriaLabel = !hasAccessibleName ? "Dialog" : undefined;

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, reducedMotion ? 0 : gsapTokens.enterExit.duration * 1000); // Exit transition time
      return () => clearTimeout(timer);
    }
  }, [isOpen, reducedMotion, gsapTokens.enterExit.duration]);

  if (!shouldRender) return null;

  return (
    <Overlay isOpen={isOpen} onClose={disableBackdropClick ? undefined : onClose} blur>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || fallbackAriaLabel}
        aria-labelledby={ariaLabelledBy || ariaLabelledby}
        aria-describedby={ariaDescribedBy || ariaDescribedby}
        tabIndex={-1}
        inert={!isOpen ? true : undefined}
        className={`relative z-50 bg-white dark:bg-void-800 rounded-[1.75rem] shadow-2xl border border-black/[0.06] dark:border-white/[0.06] outline-none max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto ${className}`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.95)',
          transition: reducedMotion ? 'none' : `opacity ${cssTokens.enterExit.duration} ${cssTokens.enterExit.ease}, transform ${cssTokens.enterExit.duration} ${cssTokens.enterExit.ease}`,
        }}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside dialog
      >
        {children}
      </div>
    </Overlay>
  );
};
