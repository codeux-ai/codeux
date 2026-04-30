import { h, ComponentChildren, createContext } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useContext } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface DialogContextValue {
  isClosing: boolean;
  reducedMotion: boolean;
  shouldRender: boolean;
  trapRef: { current: HTMLElement | null };
}

const DialogContext = createContext<DialogContextValue | null>(null);

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  preventOutsideClose?: boolean;
}

export function Dialog({ isOpen, onClose, children, preventOutsideClose = false }: DialogProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(shouldRender && !isClosing, () => {
    if (!preventOutsideClose) handleClose();
  });
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      document.body.style.overflow = "hidden";
    } else if (shouldRender) {
      setIsClosing(true);
      // Removed overflow cleanup here to prevent jump. Moved to GSAP onComplete.
    }
  }, [isOpen, shouldRender]);

  // Handle cleanup if unmounted while open
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    onClose();
  };

  useLayoutEffect(() => {
    if (shouldRender && !isClosing) {
      const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;

      if (backdropRef.current) {
        gsap.fromTo(
          backdropRef.current,
          { opacity: 0 },
          { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease }
        );
      }
    }
  }, [shouldRender, isClosing, reducedMotion]);

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;

      if (backdropRef.current) {
        gsap.to(backdropRef.current, {
          opacity: 0,
          duration: d,
          delay: reducedMotion ? 0 : 0.05,
          onComplete: () => {
            setShouldRender(false);
            setIsClosing(false);
            document.body.style.overflow = "";
          }
        });
      } else {
        setShouldRender(false);
        setIsClosing(false);
        document.body.style.overflow = "";
      }
    }
  }, [isClosing, reducedMotion]);

  const handleBackdropClick = (e: h.JSX.TargetedMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !preventOutsideClose) {
      handleClose();
    }
  };

  if (!shouldRender) return null;

  return (
    <DialogContext.Provider value={{ isClosing, reducedMotion, shouldRender, trapRef }}>
      <div
        ref={backdropRef}
        onClick={handleBackdropClick}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      >
        {children}
      </div>
    </DialogContext.Provider>
  );
}

export interface DialogContentProps {
  children: ComponentChildren;
  className?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

export function DialogContent({ children, className = "", ariaLabelledBy, ariaDescribedBy }: DialogContentProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error("DialogContent must be used within Dialog");

  const { isClosing, reducedMotion, shouldRender, trapRef } = context;
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (shouldRender && !isClosing) {
      const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;

      if (cardRef.current) {
        gsap.fromTo(
          cardRef.current,
          {
            y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart,
            opacity: MODAL_MOTION.entry.opacityStart,
            scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart,
            filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart
          },
          {
            y: MODAL_MOTION.entry.yEnd,
            opacity: MODAL_MOTION.entry.opacityEnd,
            scale: MODAL_MOTION.entry.scaleEnd,
            filter: MODAL_MOTION.entry.filterEnd,
            duration: d_card,
            ease: MODAL_MOTION.entry.ease
          }
        );
      }
    }
  }, [shouldRender, isClosing, reducedMotion]);

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;

      if (cardRef.current) {
        gsap.to(cardRef.current, {
          y: MODAL_MOTION.exit.yEnd,
          opacity: MODAL_MOTION.exit.opacityEnd,
          scale: MODAL_MOTION.exit.scaleEnd,
          filter: MODAL_MOTION.exit.filterEnd,
          duration: d,
          ease: MODAL_MOTION.exit.ease
        });
      }
    }
  }, [isClosing, reducedMotion]);

  return (
    <div
      ref={(el) => {
        trapRef.current = el;
        cardRef.current = el;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={`bg-white dark:bg-void-800 w-full max-w-md rounded-[1.75rem] shadow-2xl overflow-hidden border border-black/[0.06] dark:border-white/[0.06] flex flex-col ${className}`}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return <div className={`p-6 pb-4 ${className}`}>{children}</div>;
}

export function DialogTitle({ children, id, className = "" }: { children: ComponentChildren; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`text-xl font-semibold text-void-900 dark:text-white ${className}`}>
      {children}
    </h2>
  );
}

export function DialogFooter({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-3 p-4 bg-void-50 dark:bg-void-900/30 border-t border-black/[0.06] dark:border-white/[0.06] ${className}`}>
      {children}
    </div>
  );
}
