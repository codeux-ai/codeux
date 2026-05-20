import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { Overlay } from "./Overlay.js";

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
      }, reducedMotion ? 0 : 250); // Exit duration
      return () => clearTimeout(timer);
    }
  }, [isOpen, reducedMotion]);

  if (!shouldRender) return null;

  const isRight = position === "right";
  const alignmentClass = isRight ? "right-0" : "left-0";
  const offScreenTransform = isRight ? 'translateX(100%)' : 'translateX(-100%)';
  const transformValue = visible ? 'translateX(0%)' : offScreenTransform;

  // Spring-like cubic-bezier for drawer entrance, simpler ease-in for exit
  const transitionValue = reducedMotion
    ? 'none'
    : visible
      ? 'transform 350ms cubic-bezier(0.175, 0.885, 0.32, 1.1)'
      : 'transform 250ms ease-in';

  return (
    <Overlay isOpen={isOpen} onClose={disableBackdropClick ? undefined : onClose} blur exitDuration={250}>
      <div
        role="dialog"
        aria-modal="true"
        className={`fixed top-0 bottom-0 ${alignmentClass} z-50 w-full max-w-md bg-white dark:bg-void-800 shadow-2xl border-x border-black/[0.06] dark:border-white/[0.06] ${className}`}
        style={{
          transform: transformValue,
          transition: transitionValue,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Overlay>
  );
};
