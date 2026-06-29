import type { ComponentChildren, ComponentType, FunctionComponent, JSX, Ref } from "preact";
import type { LucideProps } from "lucide-preact";

interface PageHeaderProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "title" | "icon" | "ref"> {
  /** Small uppercase label shown above the title. Pass a node for custom styling/content. */
  eyebrow?: ComponentChildren;
  /** Optional icon rendered before a string eyebrow. */
  icon?: ComponentType<LucideProps>;
  /** Page title. Keep it short — a single clean line reads best. */
  title: ComponentChildren;
  /** Supporting one-to-two line description under the title. */
  subtitle?: ComponentChildren;
  /** Right-aligned actions (buttons, pills, filters). */
  actions?: ComponentChildren;
  /** Heading element to render. Use "h2" on pages that already own an <h1>. */
  as?: "h1" | "h2";
  /** Extra classes on the wrapping <header>. */
  className?: string;
  /** Forwarded ref to the wrapping <header> (used for entrance animations). */
  containerRef?: Ref<HTMLElement>;
}

/**
 * Unified page intro header. Every page renders the same clean, professional
 * structure: a compact eyebrow, a restrained title, an optional subtitle, and
 * optional right-aligned actions. Heading sizing and spacing live here so the
 * whole app stays consistent.
 */
export const PageHeader: FunctionComponent<PageHeaderProps> = ({
  eyebrow,
  icon: Icon,
  title,
  subtitle,
  actions,
  as: TitleTag = "h1",
  className = "",
  containerRef,
  ...rest
}) => {
  return (
    <header
      {...rest}
      ref={containerRef as any}
      className={`flex w-full flex-col gap-5 sm:flex-row sm:items-end sm:justify-between ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-col gap-2.5">
        {eyebrow && (
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
            {eyebrow}
          </div>
        )}
        <TitleTag className="font-display text-2xl font-bold leading-tight tracking-tight text-slate-900 dark:text-white md:text-3xl">
          {title}
        </TitleTag>
        {subtitle && (
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
};
