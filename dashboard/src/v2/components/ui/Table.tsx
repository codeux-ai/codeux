import { type ComponentChildren } from "preact";

export function Table({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return (
    <div className={`overflow-x-hidden lg:overflow-visible ${className}`}>
      <table className="block w-full border-separate border-spacing-y-4 text-left lg:table">
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: { children: ComponentChildren }) {
  return (
    <thead className="hidden lg:table-header-group">
      <tr className="text-[11px] font-bold text-slate-400">
        {children}
      </tr>
    </thead>
  );
}

export function TableBody({ children }: { children: ComponentChildren }) {
  return <tbody className="block lg:table-row-group">{children}</tbody>;
}

export function TableRow({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return (
    <tr
      className={`group mb-3 block overflow-hidden rounded-[1.5rem] border shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)] focus-within:ring-2 focus-within:ring-signal-500/20 dark:shadow-[0_16px_40px_rgba(0,0,0,0.18)] lg:table-row lg:overflow-visible lg:rounded-none lg:border-0 lg:shadow-none lg:hover:translate-y-0 lg:hover:shadow-none ${className}`}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: ComponentChildren;
  className?: string;
  isFirst?: boolean;
  isLast?: boolean;
  isHeader?: boolean;
  align?: "left" | "center" | "right";
  colSpan?: number;
}

export function TableCell({ children, className = "", isFirst, isLast, isHeader, align = "left", colSpan }: TableCellProps) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  if (isHeader) {
    const roundedClass = isFirst ? "rounded-l-2xl border-l" : isLast ? "rounded-r-2xl border-r pr-6" : "";
    const plClass = isFirst ? "pl-6" : "";
    return (
      <th className={`border-y border-black/[0.06] bg-white/55 px-4 py-2 ${alignClass} dark:border-white/[0.06] dark:bg-white/[0.035] ${roundedClass} ${plClass} ${className}`}>
        {children}
      </th>
    );
  }

  const roundedClass = isFirst ? "lg:rounded-l-[1.5rem] lg:border-l lg:pl-6" : isLast ? "lg:rounded-r-[1.5rem] lg:border-r lg:pr-6" : "";
  return (
    <td colSpan={colSpan} className={`block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-3 ${alignClass} ${roundedClass} ${className}`}>
      {children}
    </td>
  );
}
