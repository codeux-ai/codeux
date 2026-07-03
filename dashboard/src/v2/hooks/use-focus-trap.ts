import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getVisibleFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll(FOCUSABLE_SELECTOR)
  ) as HTMLElement[];

  return elements.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("inert")) return false;

    if (typeof window === "undefined") return false;
    // jsdom doesn't fully support computed styles in the same way, but it's good practice
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return true;
  });
}

function focusWithoutScroll(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

function isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  if (!element.isConnected) return false;
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.hasAttribute("inert")) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export interface FocusTrapOptions {
  onClose?: () => void;
  initialFocusRef?: { current: HTMLElement | null };
  restoreFocus?: boolean;
}

export function useFocusTrap(
  active: boolean,
  optionsOrOnClose?: (() => void) | FocusTrapOptions
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const options: FocusTrapOptions = typeof optionsOrOnClose === 'function'
    ? { onClose: optionsOrOnClose }
    : (optionsOrOnClose || {});

  const { onClose, initialFocusRef, restoreFocus = true } = options;
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    triggerRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      if (!containerRef.current) return;

      const requestedInitialFocus = initialFocusRef?.current ?? null;
      if (isUsableFocusTarget(requestedInitialFocus)) {
        focusWithoutScroll(requestedInitialFocus);
        return;
      }

      const autoFocusTarget = containerRef.current.querySelector("[autofocus]") as HTMLElement | null;
      const focusableElements = getVisibleFocusableElements(containerRef.current);
      const initialTarget = isUsableFocusTarget(autoFocusTarget) ? autoFocusTarget : focusableElements[0];

      if (initialTarget) {
        focusWithoutScroll(initialTarget);
      } else {
        containerRef.current.tabIndex = -1;
        focusWithoutScroll(containerRef.current);
      }
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key === "Tab") {
        if (!containerRef.current) return;

        const focusableElements = getVisibleFocusableElements(containerRef.current);

        if (focusableElements.length === 0) {
          event.preventDefault();
          containerRef.current.tabIndex = -1;
          focusWithoutScroll(containerRef.current);
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        // If focus escapes the modal, force it back
        if (!containerRef.current.contains(document.activeElement)) {
          event.preventDefault();
          focusWithoutScroll(first);
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          focusWithoutScroll(last);
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          focusWithoutScroll(first);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocus && triggerRef.current) {
        // Defer focus restoration to ensure element is re-enabled or DOM is updated
        const trigger = triggerRef.current;
        window.setTimeout(() => {
          if (isUsableFocusTarget(trigger)) {
            focusWithoutScroll(trigger);
          } else if (document.activeElement && !document.body.contains(document.activeElement)) {
            focusWithoutScroll(document.body);
          }
        }, 0);
      }
    };
  }, [active]);

  return containerRef;
}
