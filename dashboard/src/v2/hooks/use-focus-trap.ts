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

    // jsdom doesn't fully support computed styles in the same way, but it's good practice
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return true;
  });
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

      if (initialFocusRef?.current) {
        initialFocusRef.current.focus({ preventScroll: true });
        return;
      }

      const autoFocusTarget = containerRef.current.querySelector("[autofocus]") as HTMLElement | null;
      const focusableElements = getVisibleFocusableElements(containerRef.current);
      const initialTarget = autoFocusTarget ?? focusableElements[0];

      if (initialTarget) {
        initialTarget.focus({ preventScroll: true });
      } else {
        containerRef.current.tabIndex = -1;
        containerRef.current.focus({ preventScroll: true });
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
          containerRef.current.focus({ preventScroll: true });
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        // If focus escapes the modal, force it back
        if (!containerRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus({ preventScroll: true });
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
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
          if (trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        }, 0);
      }
    };
  }, [active]);

  return containerRef;
}
