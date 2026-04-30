import { h, type FunctionComponent } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

export interface SectionNavItem {
  id: string;
  label: string;
}

export interface SectionNavProps {
  items: SectionNavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export const SectionNav: FunctionComponent<SectionNavProps> = ({
  items,
  activeId: externalActiveId,
  onSelect,
  className = "",
}) => {
  const [internalActiveId, setInternalActiveId] = useState<string | undefined>(externalActiveId);
  const activeId = externalActiveId ?? internalActiveId;

  const handleSelect = useCallback((id: string) => {
    setInternalActiveId(id);
    onSelect?.(id);

    const target = document.getElementById(id);
    if (target) {
      // Native smooth scroll
      const offset = 100;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = target.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });

      // Accessibility: Move focus to the heading/section
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  }, [onSelect]);

  // Sync internal state with external prop
  useEffect(() => {
    if (externalActiveId) {
      setInternalActiveId(externalActiveId);
    }
  }, [externalActiveId]);

  return (
    <nav className={`flex items-center gap-1 overflow-x-auto no-scrollbar py-1 ${className}`}>
      {items.map((item) => {
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item.id)}
            className={`relative px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] transition-all rounded-full whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
              isActive
                ? "text-signal-500 dark:text-signal-400 bg-signal-500/[0.08]"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            }`}
          >
            {item.label}
            {isActive && (
              <span 
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]" 
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
