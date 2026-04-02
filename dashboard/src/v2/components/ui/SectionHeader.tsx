import type { FunctionComponent, ComponentChildren } from "preact";

interface SectionHeaderProps {
    watermark: string;
    title: string;
    icon: ComponentChildren;
    className?: string;
}

/**
 * Section header with large ghost watermark text behind a visible title + icon.
 * Used to visually anchor major dashboard sections.
 */
export const SectionHeader: FunctionComponent<SectionHeaderProps> = ({
    watermark,
    title,
    icon,
    className = "mb-16",
}) => (
    <div className={`flex items-end justify-between px-2 overflow-hidden ${className}`}>
        <div className="relative">
            <h2 className="text-[6rem] font-black tracking-[0.2em] text-black/[0.04] dark:text-white/[0.04] absolute -top-8 -left-3 pointer-events-none select-none font-display leading-none overflow-hidden">
                {watermark}
            </h2>
            <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white relative z-10 flex items-center gap-2.5">
                {icon}
                {title}
            </h3>
        </div>
    </div>
);
