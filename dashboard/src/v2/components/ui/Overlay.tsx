import { h, ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface OverlayProps {
  isOpen: boolean;
  onClose?: () => void;
  children?: ComponentChildren;
  className?: string;
  blur?: boolean;
  exitDuration?: number;
}

export const Overlay: FunctionComponent<OverlayProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  blur = true,
  exitDuration = 150,
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
      }, reducedMotion ? 0 : exitDuration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, reducedMotion, exitDuration]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: reducedMotion ? 'none' : 'opacity 150ms linear',
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
