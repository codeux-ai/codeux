import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Search } from "lucide-preact";
import type { DocsWebCollectionResponse, DocsWebEntry, DocsWebSection } from "../../../../src/contracts/docs-web-types.js";

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ComponentChildren;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sectionId = `docs-web-sidebar-section-${title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        aria-controls={sectionId}
        className="group -ml-1 flex w-full items-center justify-between rounded-md p-1 text-left transition-colors hover:bg-black/[0.03] focus-visible:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.03]"
      >
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 transition-colors group-hover:text-signal-500 dark:text-signal-500">
          {title}
        </h3>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`}
          aria-hidden="true"
        />
      </button>
      <div id={sectionId} className={`docs-web-collapsible ${isOpen ? "open" : ""}`}>
        <div className="docs-web-collapsible-content">
          <ul className="ml-2 space-y-1.5 border-l border-black/[0.07] pt-3 dark:border-white/[0.07]">
            {children}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface DocsWebSidebarProps {
  collection: DocsWebCollectionResponse;
  currentDocId: string;
  onNavigate?: () => void;
}

export const DocsWebSidebar: FunctionComponent<DocsWebSidebarProps> = ({
  collection,
  currentDocId,
  onNavigate,
}) => {
  const [query, setQuery] = useState("");
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredDocs = useMemo(() => {
    if (!normalizedQuery) {
      return null;
    }
    return collection.docs.filter((doc) => {
      return doc.title.toLowerCase().includes(normalizedQuery)
        || doc.description.toLowerCase().includes(normalizedQuery)
        || doc.sourcePath.toLowerCase().includes(normalizedQuery);
    });
  }, [collection.docs, normalizedQuery]);

  const handleScroll = () => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => setIsScrolling(false), 900);
  };

  const renderDocLink = (doc: DocsWebEntry) => {
    const isActive = doc.id === currentDocId;
    return (
      <li key={doc.id}>
        <Link
          to={doc.path}
          onClick={onNavigate}
          preload="intent"
          className={`-ml-px block rounded-r-lg border-l-2 py-2 pl-4 pr-2 text-[13px] font-medium leading-snug no-underline decoration-transparent transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 ${
            isActive
              ? "border-signal-500 bg-signal-500/10 text-slate-950 dark:text-white"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:bg-black/[0.025] hover:text-slate-900 dark:text-slate-400 dark:hover:border-white/20 dark:hover:bg-white/[0.025] dark:hover:text-white"
          }`}
          aria-current={isActive ? "page" : undefined}
        >
          {doc.title}
        </Link>
      </li>
    );
  };

  return (
    <aside
      className={`docs-web-sidebar-scroll ${isScrolling ? "is-scrolling" : ""} h-full overflow-y-auto rounded-lg border border-black/[0.08] bg-white/72 p-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-900/58 dark:shadow-[0_20px_80px_rgba(0,0,0,0.18)]`}
      aria-label="Documentation navigation"
      onScroll={handleScroll}
    >
      <div className="space-y-6 pb-2">
        <div className="border-b border-black/[0.07] pb-4 dark:border-white/[0.07]">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-500">
            Documentation
          </p>
          <label className="mt-3 flex min-h-10 items-center gap-2 rounded-lg border border-black/[0.08] bg-black/[0.025] px-3 text-sm text-slate-500 focus-within:border-signal-500/50 focus-within:ring-2 focus-within:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400">
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">Search documentation</span>
            <input
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search docs"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </label>
        </div>

        {filteredDocs ? (
          <div>
            <p className="mb-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              {filteredDocs.length} result{filteredDocs.length === 1 ? "" : "s"}
            </p>
            <ul className="ml-2 space-y-1.5 border-l border-black/[0.07] dark:border-white/[0.07]">
              {filteredDocs.map(renderDocLink)}
            </ul>
          </div>
        ) : (
          (Object.keys(collection.groupedDocs) as DocsWebSection[]).map((section) => {
            const docs = collection.groupedDocs[section];
            if (!docs.length) {
              return null;
            }
            return (
              <CollapsibleSection key={section} title={section}>
                {docs.map(renderDocLink)}
              </CollapsibleSection>
            );
          })
        )}
      </div>
    </aside>
  );
};
