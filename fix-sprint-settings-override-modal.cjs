const fs = require('fs');
const file = 'dashboard/src/v2/components/ui/SprintSettingsOverrideModal.tsx';
let content = fs.readFileSync(file, 'utf8');

const focusTrapCode = `
  const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;

    if (cardRef.current) {
      const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        if (!cardRef.current) return;
        const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (!cardRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
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
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    };
  }, [onClose]);
`;

let lines = content.split('\n');
const useEffectIndexStart = lines.findIndex(line => line.includes('const handler = (event: KeyboardEvent) => {'));
if (useEffectIndexStart !== -1) {
    // Replace the existing useEffect
    lines.splice(useEffectIndexStart - 1, 9, focusTrapCode);
} else {
    console.log("Could not find useEffect in SprintSettingsOverrideModal.tsx");
}

content = lines.join('\n');

content = content.replace(
  '<div\n        ref={cardRef}\n        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2.5rem] bg-[#f9f8f4] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:bg-void-900 dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)]"\n      >',
  '<div\n        ref={cardRef}\n        role="dialog"\n        aria-modal="true"\n        aria-label={`Sprint Overrides for ${sprint.name}`}\n        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2.5rem] bg-[#f9f8f4] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:bg-void-900 dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)]"\n      >'
);

fs.writeFileSync(file, content);
