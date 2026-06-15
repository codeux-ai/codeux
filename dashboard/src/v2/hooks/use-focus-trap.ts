import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  onClose?: () => void;
  initialFocusRef?: { current: HTMLElement | null };
  restoreFocus?: boolean;
}

function isFocusable(element: HTMLElement): boolean {
  if (element.hidden) return false;

  if (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.closest('[aria-hidden="true"]') ||
    element.hasAttribute('inert') ||
    element.closest('[inert]') ||
    element.tabIndex < 0
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  return true;
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
        initialFocusRef.current.focus();
        return;
      }

      const autoFocusTarget = containerRef.current.querySelector("[autofocus]") as HTMLElement | null;
      if (autoFocusTarget && isFocusable(autoFocusTarget)) {
          autoFocusTarget.focus();
          return;
      }

      const focusableElements = Array.from(
        containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      ) as HTMLElement[];

      const visibleFocusableElements = focusableElements.filter(isFocusable);
      const initialTarget = visibleFocusableElements[0];
      initialTarget?.focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (onCloseRef.current) {
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current();
        }
        return;
      }

      if (event.key === "Tab") {
        if (!containerRef.current) return;

        const focusableElements = Array.from(
          containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ) as HTMLElement[];

        const visibleFocusableElements = focusableElements.filter(isFocusable);

        if (visibleFocusableElements.length === 0) {
            event.preventDefault();
            return;
        }

        const first = visibleFocusableElements[0];
        const last = visibleFocusableElements[visibleFocusableElements.length - 1];

        // If focus escapes the modal, force it back
        if (!containerRef.current.contains(document.activeElement)) {
          event.preventDefault();
          if (event.shiftKey) {
            last.focus();
          } else {
            first.focus();
          }
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocus && triggerRef.current && document.body.contains(triggerRef.current)) {
        // Defer focus restoration to ensure element is re-enabled or DOM is updated
        const trigger = triggerRef.current;
        window.setTimeout(() => trigger.focus(), 0);
      }
    };
  }, [active, restoreFocus, initialFocusRef]);

  return containerRef;
}
