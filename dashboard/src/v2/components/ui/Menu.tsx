import type { FunctionComponent, ComponentChildren } from "preact";
import * as preact from "preact";
import { useEffect, useLayoutEffect, useRef, useState, useMemo, useContext } from "preact/hooks";
import { createContext } from "preact";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: preact.RefObject<HTMLButtonElement>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error("Menu components must be used within a <Menu> provider.");
  }
  return context;
}

export const Menu: FunctionComponent<{
  children: ComponentChildren;
}> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const value = useMemo(() => ({ open, setOpen, triggerRef }), [open]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
};

export const MenuTrigger: FunctionComponent<{
  children: ComponentChildren;
  className?: string;
}> = ({ children, className }) => {
  const { open, setOpen, triggerRef } = useMenuContext();

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => {
        if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ")) {
          e.preventDefault();
          setOpen(true);
        }
      }}
      className={className}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {children}
    </button>
  );
};

export const MenuContent: FunctionComponent<{
  children: ComponentChildren;
  className?: string;
}> = ({ children, className }) => {
  const { open, setOpen, triggerRef } = useMenuContext();
  const [isRendered, setIsRendered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const [position, setPosition] = useState<{
    top: number;
    left: number;
    direction: "up" | "down";
  } | null>(null);

  const updatePosition = () => {
    if (!triggerRef.current || !panelRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();

    const gap = 8;
    const viewportHeight = window.innerHeight;

    let direction: "up" | "down" = "down";
    let top = triggerRect.bottom + gap;

    if (top + panelRect.height > viewportHeight - 16 && triggerRect.top - panelRect.height - gap >= 16) {
      direction = "up";
      top = triggerRect.top - panelRect.height - gap;
    }

    let left = triggerRect.left;
    if (left + panelRect.width > window.innerWidth - 16) {
      left = window.innerWidth - panelRect.width - 16;
    }

    setPosition({ top, left, direction });
  };

  useEffect(() => {
    if (open) {
      setIsRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (!isRendered) {
      setPosition(null);
    }
  }, [isRendered]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!isRendered || !panelRef.current || !position) return;

    const panel = panelRef.current;
    let ctx = gsap.context(() => {
      const isUp = position.direction === "up";
      const initialY = isUp ? 10 : -10;
      const targetY = 0;

      if (typeof gsap.fromTo !== "function" || typeof gsap.to !== "function") {
        if (!open) setIsRendered(false);
        return;
      }

      if (open) {
        gsap.fromTo(
          panel,
          { opacity: 0, y: initialY, scale: 0.98, filter: "blur(4px)" },
          {
            opacity: 1,
            y: targetY,
            scale: 1,
            filter: "blur(0px)",
            duration: reducedMotion ? 0 : 0.3,
            ease: "power3.out",
            clearProps: "filter",
          }
        );
      } else {
        gsap.to(panel, {
          opacity: 0,
          y: initialY,
          scale: 0.98,
          filter: "blur(4px)",
          duration: reducedMotion ? 0 : 0.2,
          ease: "power2.in",
          onComplete: () => {
            setIsRendered(false);
          },
        });
      }
    }, panel);

    return () => ctx.revert();
  }, [open, isRendered, position?.direction, reducedMotion]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);


  const panel = isRendered
    ? createPortal(
        <div
          ref={panelRef}
          style={
            position
              ? {
                  position: "absolute",
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  zIndex: 9999,
                }
              : { position: "absolute", left: "-9999px", top: "-9999px", visibility: "hidden" }
          }
          className={`overflow-hidden rounded-2xl border border-black/[0.06] bg-white/[0.97] shadow-[0_20px_40px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/[0.97] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.04)] ${
            position?.direction === "up" ? "origin-bottom" : "origin-top"
          } ${className || ""}`}
          role="menu"
        >
          {children}
        </div>,
        document.body
      )
    : null;

  return <>{panel}</>;
};

export const MenuItem: FunctionComponent<{
  children: ComponentChildren;
  onClick?: () => void;
  className?: string;
}> = ({ children, onClick, className }) => {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors text-slate-700 hover:bg-signal-500/5 dark:text-slate-300 dark:hover:bg-signal-500/5 ${className || ""}`}
    >
      {children}
    </button>
  );
};
