import { h, type FunctionComponent } from "preact";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useMemo } from "preact/hooks";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const Pagination: FunctionComponent<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className = "",
}) => {
  const pages = useMemo(() => {
    const items: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) items.push(i);
    } else {
      items.push(1);
      if (currentPage > 3) items.push("...");

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!items.includes(i)) items.push(i);
      }

      if (currentPage < totalPages - 2) items.push("...");
      if (!items.includes(totalPages)) items.push(totalPages);
    }
    return items;
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <nav 
      aria-label="Pagination Navigation" 
      className={`flex items-center justify-center gap-2 ${className}`}
    >
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Previous Page"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white/50 text-slate-500 transition-all hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
      </button>

      <div className="flex items-center gap-1.5">
        {pages.map((page, idx) => {
          if (typeof page === "string") {
            return (
              <span 
                key={`ellipsis-${idx}`}
                className="flex h-9 w-6 items-center justify-center text-xs font-bold text-slate-400"
              >
                {page}
              </span>
            );
          }

          const isActive = page === currentPage;
          return (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              aria-current={isActive ? "page" : undefined}
              aria-label={`Go to page ${page}`}
              className={`flex h-9 min-w-[2.25rem] items-center justify-center rounded-xl px-2 text-xs font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                isActive
                  ? "bg-signal-500 text-void-900 shadow-[0_4px_12px_rgba(0,224,160,0.25)]"
                  : "border border-black/[0.06] bg-white/40 text-slate-500 hover:border-black/[0.1] hover:bg-white/80 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] dark:hover:text-white"
              }`}
            >
              {page}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Next Page"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.08] bg-white/50 text-slate-500 transition-all hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </nav>
  );
};
