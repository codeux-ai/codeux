import type { FunctionComponent } from "preact";

interface SectionDividerProps {
  label: string;
  className?: string;
}

/**
 * Reusable visual section divider with a centered label, gradient lines,
 * and responsive scaling matching the Jules Design System / Styleguide.
 */
export const SectionDivider: FunctionComponent<SectionDividerProps> = ({
  label,
  className = "py-2 md:py-4",
}) => (
  <div className={`w-full flex items-center justify-center relative z-10 overflow-hidden ${className}`}>
    <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
    <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06] dark:border-white/[0.06] rounded-full shadow-sm relative z-10 text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-600">
      {label}
    </div>
  </div>
);
