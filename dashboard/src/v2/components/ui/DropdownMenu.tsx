import { h, ComponentChildren, RefObject, isValidElement, cloneElement, toChildArray, VNode } from "preact";
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { JSX } from "preact";
import gsap from "gsap";
import { calculatePosition, Position, Alignment } from "../../lib/positioning/index.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { restoreFocusSafely } from "../../hooks/use-focus-trap.js";

interface DropdownMenuProps {
  children: ComponentChildren;
  /**
   * The content of the dropdown menu.
   * Note: All interactive items within content must have `role="menuitem"` for keyboard navigation to work.
   */
  content: ComponentChildren;
  position?: Position;
  align?: Alignment;
  gap?: number;
  className?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement>;
  computePosition?: (args: {
    triggerRect: DOMRect;
    menuRect: DOMRect;
    viewport: { width: number; height: number };
    defaultPosition: Position;
    defaultAlign: Alignment;
    gap: number;
  }) => {
    top: number;
    left: number;
    transformOrigin?: string;
  };
  menuAriaLabel?: string;
}

type DropdownMenuItemProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  children?: ComponentChildren;
  disabled?: boolean;
};

export const DropdownMenuItem = ({ children, className = "", onClick, onKeyDown, ...props }: DropdownMenuItemProps) => {
  const isAriaDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const isDisabled = !!props.disabled || isAriaDisabled;

  return (
    <button
      role="menuitem"
      data-dropdown-item="true"
      className={className}
      {...props}
      disabled={props.disabled}
      aria-disabled={isDisabled}
      onKeyDown={(event) => {
        if (isDisabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onKeyDown?.(event);
      }}
      onClick={(event) => {
        if (isDisabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
};

function assignRef<T>(ref: unknown, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

function focusMenuItem(item: HTMLElement | undefined): void {
  item?.focus({ preventScroll: true });
}

function getEnabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"]):not([hidden]):not([aria-hidden="true"])'));
}

export const DropdownMenu = ({
  children,
  content,
  position = "bottom",
  align = "start",
  gap = 8,
  className = "",
  isOpen,
  onOpenChange,
  triggerRef: externalTriggerRef,
  computePosition,
  menuAriaLabel,
}: DropdownMenuProps) => {
  const isReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const [isRendered, setIsRendered] = useState(false);
  const lastInteractionType = useRef<string | null>(null);
  const localTriggerRef = useRef<HTMLElement>(null);
  const triggerRef = externalTriggerRef || localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [transformOrigin, setTransformOrigin] = useState<string>("top center");

  // Generate a unique ID for ARIA wiring if none exists
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);
  const [triggerId] = useState(() => `trigger-${Math.random().toString(36).substr(2, 9)}`);

  const enhanceContent = (node: ComponentChildren): ComponentChildren => {
    return toChildArray(node).map((child) => {
      if (!isValidElement(child)) return child;

      const vnode = child as VNode<any>;

      if (vnode.props && vnode.props.role === "menuitem") {
        return cloneElement(vnode, {
          "data-dropdown-item": "true"
        });
      }

      if (vnode.props && vnode.props.children) {
        return cloneElement(vnode, {
          ...vnode.props,
          children: enhanceContent(vnode.props.children)
        });
      }

      return child;
    });
  };

  const enhancedContent = enhanceContent(content);

  const restoreFocus = useCallback(() => {
    restoreFocusSafely(previousFocusRef.current, triggerRef.current);
    previousFocusRef.current = null;
  }, [triggerRef]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    if (computePosition) {
      const custom = computePosition({
        triggerRect,
        menuRect,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        defaultPosition: position,
        defaultAlign: align,
        gap,
      });
      setCoords({ top: custom.top, left: custom.left });
      setTransformOrigin(custom.transformOrigin ?? "top center");
      return;
    }
    const { top, left } = calculatePosition({
      triggerRect,
      contentRect: menuRect,
      position,
      align,
      gap,
      padding: 8,
    });
    setCoords({ top, left });
    setTransformOrigin("top center");
  }, [align, computePosition, gap, position, triggerRef]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (isRendered) {
      restoreFocus();
    }
  }, [isOpen, isRendered, restoreFocus]);

  useLayoutEffect(() => {
    if (isOpen && isRendered) updatePosition();
  }, [isOpen, isRendered, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (!menuRef.current) return;

    gsap.killTweensOf(menuRef.current);



    if (isOpen) {
      const itemCount = getEnabledMenuItems(menuRef.current).length;

      gsap.fromTo(
        menuRef.current,
        {
          opacity: 0,
          scale: 0.95,
          y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: gsapTokens.enterExit.duration,
          ease: gsapTokens.enterExit.ease,
        }
      );

      if (!isReducedMotion && itemCount > 0) {
        gsap.fromTo(
          getEnabledMenuItems(menuRef.current),
          { opacity: 0, y: 4 },
          {
            opacity: 1,
            y: 0,
            stagger: gsapTokens.listReveal.duration / itemCount,
            duration: gsapTokens.listReveal.duration,
            ease: gsapTokens.listReveal.ease,
            delay: gsapTokens.enterExit.duration,
          }
        );
      }

      requestAnimationFrame(() => {
        const items = getEnabledMenuItems(menuRef.current);
        if (items.length > 0) {
          if (lastInteractionType.current === 'ArrowUp') {
            items[items.length - 1]?.focus({ preventScroll: true });
          } else {
            items[0]?.focus({ preventScroll: true });
          }
        }
        lastInteractionType.current = null;
      });
    } else if (isRendered) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        y: position === "bottom" ? -5 : position === "top" ? 5 : 0,
        duration: gsapTokens.enterExit.duration,
        ease: gsapTokens.enterExit.ease,
        onComplete: () => setIsRendered(false),
      });
    }
  }, [isOpen, isRendered, position, isReducedMotion, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease, gsapTokens.listReveal.duration, gsapTokens.listReveal.ease]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        isOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        (!triggerRef.current || !triggerRef.current.contains(e.target as Node))
      ) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
        return;
      }

      if (!menuRef.current) return;

      const items = getEnabledMenuItems(menuRef.current);
      if (items.length === 0) return;

      const currentIndex = items.findIndex((item) => item === document.activeElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusMenuItem(items[(currentIndex + 1) % items.length]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const nextIndex = currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        focusMenuItem(items[nextIndex]);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusMenuItem(items[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        focusMenuItem(items[items.length - 1]);
      } else if (e.key === "Enter" || e.key === " ") {
        const activeElement = document.activeElement as HTMLElement | null;
        const activeDisabled = activeElement?.hasAttribute("disabled") || activeElement?.getAttribute("aria-disabled") === "true";
        if (activeDisabled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (activeElement && items.includes(activeElement)) {
          // Check if the element handles Enter/Space itself, otherwise we click it.
          // Native buttons and links handle Enter/Space natively on focus, but we'll manually dispatch a click if it's a generic menuitem
          if (activeElement.getAttribute('role') === 'menuitem') {
            e.preventDefault();
            activeElement.click();
          }
        }
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <>
      {isValidElement(children) ? cloneElement(children as preact.VNode<any>, {
        id: (children.props as any).id || triggerId,
        ref: (node: any) => {
          if (externalTriggerRef) {
            assignRef(externalTriggerRef, node);
          } else {
            (localTriggerRef as any).current = node;
          }
          assignRef((children as any).ref, node);
        },
        onClick: (e: MouseEvent) => {
          lastInteractionType.current = 'click';
          e.stopPropagation();
          const isTriggerDisabled = !!(children.props as any).disabled || (children.props as any)["aria-disabled"] === true || (children.props as any)["aria-disabled"] === "true";
          if (isTriggerDisabled) {
            e.preventDefault();
            return;
          }
          onOpenChange(!isOpen);
          if ((children.props as any).onClick) (children.props as any).onClick(e);
        },
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            lastInteractionType.current = e.key;
            e.preventDefault();
            const isTriggerDisabled = !!(children.props as any).disabled || (children.props as any)["aria-disabled"] === true || (children.props as any)["aria-disabled"] === "true";
            if (isTriggerDisabled) {
              return;
            }
            onOpenChange(e.key === 'Enter' || e.key === ' ' ? !isOpen : true);
          }
          if ((children.props as any).onKeyDown) (children.props as any).onKeyDown(e);
        },
        disabled: (children.props as any).disabled,
        "aria-label": (children.props as any)["aria-label"],
        "aria-haspopup": "menu",
        "aria-expanded": isOpen,
        "aria-controls": menuId,
      }) : (
        <button
          type="button"
          id={triggerId}
          ref={(node) => {
            if (externalTriggerRef) {
              assignRef(externalTriggerRef, node);
            } else {
              assignRef(localTriggerRef, node);
            }
          }}
          className="inline-flex cursor-pointer text-left"
          onClick={(e) => {
            lastInteractionType.current = 'click';
            e.stopPropagation();
            onOpenChange(!isOpen);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              lastInteractionType.current = e.key;
              e.preventDefault();
              onOpenChange(e.key === 'Enter' || e.key === ' ' ? !isOpen : true);
            }
          }}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={menuId}
        >
          {children}
        </button>
      )}

      {isRendered && typeof document !== "undefined" &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={menuAriaLabel}
            aria-labelledby={menuAriaLabel ? undefined : (isValidElement(children) && (children.props as any).id ? (children.props as any).id : triggerId)}
            className={`fixed z-[100] bg-white dark:bg-void-800 border border-black/[0.08] dark:border-white/[0.08] shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] rounded-2xl p-2 ${!isOpen ? "pointer-events-none" : ""} ${className}`}
            style={{ top: coords.top, left: coords.left, transformOrigin }}
            onClick={(e) => e.stopPropagation()}
          >
            {enhancedContent}
          </div>,
          document.body
        )}
    </>
  );
};
