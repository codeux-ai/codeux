import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface OverlayProps {
  isOpen: boolean;
  onClose?: () => void;
  children?: ComponentChildren;
  className?: string;
  blur?: boolean;
  exitDuration?: number;
  intent?: "default" | "destructive";
}

export const Overlay: FunctionComponent<OverlayProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  blur = true,
  exitDuration, // deprecated
  intent = "default",
}) => {
  const reducedMotion = useReducedMotion();
  const cssTokens = useInteractionTokens();
  const gsapTokens = useGsapInteractionTokens();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);

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
      }, reducedMotion ? 0 : (intent === "destructive" ? MODAL_MOTION.overlay.exit * 1000 : gsapTokens.enterExit.duration * 1000));
      return () => clearTimeout(timer);
    }
  }, [isOpen, reducedMotion, gsapTokens.enterExit.duration, intent]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: reducedMotion ? 'none' : `opacity ${intent === "destructive" ? `${MODAL_MOTION.overlay.exit}s ${MODAL_MOTION.overlay.exitEase}` : `${cssTokens.enterExit.duration} ${cssTokens.enterExit.ease}`}`,
      }}
    >
      <div
        className={`absolute inset-0 bg-void-900/50 ${blur ? 'backdrop-blur-sm' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      />
      {children}
    </div>
  );
};
