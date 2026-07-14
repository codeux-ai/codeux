import gsap from "gsap";
import { useRef, useEffect } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { type ComponentChildren } from "preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-preact";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { shellMessages } from "../../i18n/messages/shell.js";

interface TableProps {
  children: ComponentChildren;
  className?: string;
  caption?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  resultCount?: number;
  resultLabel?: string;
  busy?: boolean;
}

export function Table({ children, className = "", caption, ariaLabel, ariaLabelledBy, resultCount, resultLabel, busy }: TableProps) {
  const { formatNumber, translate } = useOptionalDashboardI18n();
  const resolvedResultLabel = resultLabel ?? translate(shellMessages, "rows");
  const hasResultCount = typeof resultCount === "number";
  const resultCountCopy = hasResultCount
    ? `${busy ? translate(shellMessages, "updatingResults") : ""}${translate(shellMessages, "resultsShown", { count: formatNumber(resultCount), label: resolvedResultLabel })}`
    : "";
  return (
    <div className={`overflow-x-hidden lg:overflow-visible ${className}`}>
      {hasResultCount && (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {resultCountCopy}
        </div>
      )}
      <table
        className="block w-full border-separate border-spacing-y-4 text-left lg:table"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-busy={busy ? "true" : undefined}
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
  const previousChildren = useRef<ComponentChildren | null>(null);
  const isReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();

  useEffect(() => {
    if (isReducedMotion || !tbodyRef.current) {
      previousChildren.current = children;
      return;
    }

    // Animate the rows in exactly once, when they first appear. We mark
    // `hasMounted` synchronously here (not in gsap's onComplete): under a live
    // data stream the parent re-renders faster than the ~350ms animation, so a
    // deferred flag would let every re-render restart the tween — resetting all
    // rows to opacity 0 and making the table appear to perpetually reload.
    const rows = tbodyRef.current.querySelectorAll(':scope > [data-table-row]');
    if (rows.length === 0) {
      previousChildren.current = children;
      return;
    }

    if (hasMounted.current) {
      if (previousChildren.current !== children) {
        gsap.fromTo(
          rows,
          { y: 3 },
          {
            y: 0,
            stagger: Math.min(0.015, 0.12 / rows.length),
            duration: gsapTokens.listReorder.duration,
            ease: gsapTokens.listReorder.ease
          }
        );
      }
      previousChildren.current = children;
      return;
    }

    hasMounted.current = true;
    previousChildren.current = children;
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
        stagger: Math.min(0.025, 0.2 / rows.length),
        duration: gsapTokens.listReveal.duration,
        ease: gsapTokens.listReveal.ease
      }
    );
  }, [children, isReducedMotion]);

  return <tbody ref={tbodyRef} className="block lg:table-row-group" role="rowgroup">{children}</tbody>;
}

export function TableRow({ children, className = "", selected, onClick, style, "aria-busy": ariaBusy }: { children: ComponentChildren; className?: string; selected?: boolean; onClick?: (e: MouseEvent) => void; style?: import("preact").JSX.CSSProperties; "aria-busy"?: boolean }) {
  const tokens = useInteractionTokens();
  const selectedClass = selected ? "bg-signal-500/5 ring-2 ring-inset ring-signal-500/30" : "";
  const cursorClass = onClick ? "cursor-pointer" : "";
  return (
    <tr
      data-table-row
      onClick={onClick as any}
      aria-selected={selected}
      aria-busy={ariaBusy || undefined}
      role="row"
      data-reorder-motion="listReorder"
      className={`group mb-3 block overflow-hidden rounded-[1.5rem] border shadow-[var(--elevation-base)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-[var(--elevation-raised)] focus-within:ring-2 focus-within:ring-signal-500/20 motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:table-row lg:overflow-visible lg:rounded-none lg:border-0 lg:shadow-none lg:hover:bg-[var(--fill-muted-hover)] lg:transition-colors ${cursorClass} ${selectedClass} ${className}`}
      style={{ transitionDuration: tokens.listReorder.duration, transitionTimingFunction: tokens.listReorder.ease, ...(typeof style === "object" ? style : {}) }}
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
  sortLabel?: string;
}

function SortIcon({ ariaSort }: { ariaSort?: TableCellProps["ariaSort"] }) {
  if (ariaSort === "ascending") {
    return <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />;
  }
  if (ariaSort === "descending") {
    return <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />;
  }
  return <ArrowUpDown className="h-3 w-3 shrink-0 opacity-55" aria-hidden="true" />;
}

export function TableCell({ children, className = "", isFirst, isLast, isHeader, align = "left", colSpan, mobileLabel, ariaSort, onSort, sortLabel }: TableCellProps) {
  const { translate } = useOptionalDashboardI18n();
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  if (isHeader) {
    const roundedClass = isFirst ? "rounded-l-2xl border-l" : isLast ? "rounded-r-2xl border-r pr-6" : "";
    const plClass = isFirst ? "pl-6" : "";
    const sortCopy = translate(shellMessages, ariaSort === "ascending" ? "sortedAscending" : ariaSort === "descending" ? "sortedDescending" : "notSorted");
    const resolvedAriaSort = onSort ? (ariaSort ?? "none") : ariaSort;
    return (
      <th scope="col" aria-sort={resolvedAriaSort}
        className={`border-y border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-2 ${alignClass} ${roundedClass} ${plClass} ${className}`}
      >
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            aria-label={sortLabel ? `${sortLabel}, ${sortCopy}` : undefined}
            className="inline-flex items-center gap-1.5 w-full text-inherit font-inherit text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-md bg-transparent border-0 p-0 cursor-pointer"
          >
            <span className="min-w-0 truncate">{children}</span>
            <SortIcon ariaSort={ariaSort} />
            <span className="sr-only">, {sortCopy}</span>
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
