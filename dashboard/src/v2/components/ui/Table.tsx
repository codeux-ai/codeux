import gsap from "gsap";
import { useRef, useEffect } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { type ComponentChildren } from "preact";

interface TableProps {
  children: ComponentChildren;
  className?: string;
  caption?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export function Table({ children, className = "", caption, ariaLabel, ariaLabelledBy }: TableProps) {
  return (
    <div className={`overflow-x-hidden lg:overflow-visible ${className}`}>
      <table
        className="block w-full border-separate border-spacing-y-4 text-left lg:table"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        role="table"
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: { children: ComponentChildren }) {
  return (
    <thead className="sr-only lg:not-sr-only lg:table-header-group" role="rowgroup">
      <tr className="text-[color:var(--text-metadata)] text-xs font-medium">
        {children}
      </tr>
    </thead>
  );
}

export function TableBody({ children }: { children: ComponentChildren }) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const hasMounted = useRef(false);
  const isReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isReducedMotion || !tbodyRef.current || hasMounted.current) return;

    // Animate the rows in exactly once, when they first appear. We mark
    // `hasMounted` synchronously here (not in gsap's onComplete): under a live
    // data stream the parent re-renders faster than the ~350ms animation, so a
    // deferred flag would let every re-render restart the tween — resetting all
    // rows to opacity 0 and making the table appear to perpetually reload.
    const rows = tbodyRef.current.querySelectorAll(':scope > [data-table-row]');
    if (rows.length === 0) return;

    hasMounted.current = true;

    // Animate only the vertical offset — never opacity. gsap writes its tweened
    // value to the element's inline style, and if the parent re-renders fast
    // enough to interrupt the tween (live data streams do), an opacity tween can
    // leave rows stranded at `opacity: 0`, making the table look like it only
    // ever shows one row. A transform offset can never make a row invisible.
    gsap.fromTo(
      rows,
      { y: 6 },
      {
        y: 0,
        stagger: Math.min(25, 200 / rows.length),
        duration: 0.15,
        ease: 'power2.out'
      }
    );
  }, [children, isReducedMotion]);

  return <tbody ref={tbodyRef} className="block lg:table-row-group" role="rowgroup">{children}</tbody>;
}

export function TableRow({ children, className = "", selected, onClick, style }: { children: ComponentChildren; className?: string; selected?: boolean; onClick?: (e: MouseEvent) => void; style?: import("preact").JSX.CSSProperties }) {
  const selectedClass = selected ? "bg-signal-500/5 ring-2 ring-inset ring-signal-500/30" : "";
  const cursorClass = onClick ? "cursor-pointer" : "";
  return (
    <tr
      data-table-row
      onClick={onClick as any}
      aria-selected={selected}
      role="row"
      className={`group mb-3 block overflow-hidden rounded-[1.5rem] border shadow-[var(--elevation-base)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--elevation-raised)] focus-within:ring-2 focus-within:ring-signal-500/20 lg:table-row lg:overflow-visible lg:rounded-none lg:border-0 lg:shadow-none lg:hover:bg-[var(--fill-muted-hover)] lg:transition-colors lg:duration-150 ${cursorClass} ${selectedClass} ${className}`}
      style={style}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  ariaSort?: "none" | "ascending" | "descending" | "other";
  children: ComponentChildren;
  className?: string;
  isFirst?: boolean;
  isLast?: boolean;
  isHeader?: boolean;
  align?: "left" | "center" | "right";
  colSpan?: number;
  mobileLabel?: string;
  onSort?: () => void;
}

export function TableCell({ children, className = "", isFirst, isLast, isHeader, align = "left", colSpan, mobileLabel, ariaSort, onSort }: TableCellProps) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  if (isHeader) {
    const roundedClass = isFirst ? "rounded-l-2xl border-l" : isLast ? "rounded-r-2xl border-r pr-6" : "";
    const plClass = isFirst ? "pl-6" : "";
    return (
      <th scope="col" aria-sort={ariaSort}
        className={`border-y border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-2 ${alignClass} ${roundedClass} ${plClass} ${className}`}
      >
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className="inline-flex items-center gap-1 w-full text-inherit font-inherit text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-md bg-transparent border-0 p-0 cursor-pointer"
          >
            {children}
          </button>
        ) : (
          children
        )}
      </th>
    );
  }

  const roundedClass = isFirst ? "lg:rounded-l-[1.5rem] lg:border-l lg:pl-6" : isLast ? "lg:rounded-r-[1.5rem] lg:border-r lg:pr-6" : "";
  return (
    <td
      colSpan={colSpan}
      className={`flex flex-wrap items-start gap-x-2 border-b border-white/[0.04] px-4 py-2 last:border-b-0 align-middle min-w-0 break-words lg:table-cell lg:border-y lg:px-4 lg:py-3 ${alignClass} ${roundedClass} ${className}`}
      role="cell"
    >
      {mobileLabel && (
        <span className="inline-flex text-xs font-medium text-muted-foreground mr-2 lg:hidden" aria-hidden>
          {mobileLabel}
        </span>
      )}
      <div className="min-w-0 flex-1 break-words lg:contents">
        {children}
      </div>
    </td>
  );
}
