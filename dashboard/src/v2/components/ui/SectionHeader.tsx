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
    <div className={`flex items-end justify-between overflow-hidden border-b border-[color:var(--border-hairline)] px-2 pb-4 ${className}`}>
        <div className="relative">
            <h2 className="pointer-events-none absolute -left-3 -top-8 overflow-hidden font-display text-[6rem] font-black leading-none tracking-[0.2em] text-[color:var(--fill-muted-hover)] select-none motion-reduce:transform-none">
                {watermark}
            </h2>
            <h3 className="relative z-10 flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
                {icon}
                {title}
            </h3>
        </div>
    </div>
);
