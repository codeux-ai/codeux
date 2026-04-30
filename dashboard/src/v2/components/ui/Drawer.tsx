import { h, ComponentChildren, createContext } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useContext } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface DrawerContextValue {
  isClosing: boolean;
  reducedMotion: boolean;
  shouldRender: boolean;
  trapRef: { current: HTMLElement | null };
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  preventOutsideClose?: boolean;
}

export function Drawer({ isOpen, onClose, children, preventOutsideClose = false }: DrawerProps) {
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
    <DrawerContext.Provider value={{ isClosing, reducedMotion, shouldRender, trapRef }}>
      <div
        ref={backdropRef}
        onClick={handleBackdropClick}
        className="fixed inset-0 z-[200] flex justify-end bg-black/50 backdrop-blur-sm"
      >
        {children}
      </div>
    </DrawerContext.Provider>
  );
}

export interface DrawerContentProps {
  children: ComponentChildren;
  className?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

export function DrawerContent({ children, className = "", ariaLabelledBy, ariaDescribedBy }: DrawerContentProps) {
  const context = useContext(DrawerContext);
  if (!context) throw new Error("DrawerContent must be used within Drawer");

  const { isClosing, reducedMotion, shouldRender, trapRef } = context;
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (shouldRender && !isClosing) {
      const d_panel = reducedMotion ? 0 : MODAL_MOTION.entry.duration;

      if (panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          {
            x: reducedMotion ? '0%' : '100%'
          },
          {
            x: '0%',
            duration: d_panel,
            ease: MODAL_MOTION.entry.ease
          }
        );
      }
    }
  }, [shouldRender, isClosing, reducedMotion]);

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;

      if (panelRef.current) {
        gsap.to(panelRef.current, {
          x: '100%',
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
        panelRef.current = el;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={`bg-white dark:bg-void-800 w-full max-w-md h-full shadow-2xl flex flex-col border-l border-black/[0.06] dark:border-white/[0.06] ${className}`}
    >
      {children}
    </div>
  );
}

export function DrawerHeader({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return <div className={`p-6 pb-4 border-b border-black/[0.06] dark:border-white/[0.06] ${className}`}>{children}</div>;
}

export function DrawerTitle({ children, id, className = "" }: { children: ComponentChildren; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`text-xl font-semibold text-void-900 dark:text-white ${className}`}>
      {children}
    </h2>
  );
}

export function DrawerFooter({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return (
    <div className={`mt-auto flex items-center justify-end gap-3 p-4 bg-void-50 dark:bg-void-900/30 border-t border-black/[0.06] dark:border-white/[0.06] ${className}`}>
      {children}
    </div>
  );
}
