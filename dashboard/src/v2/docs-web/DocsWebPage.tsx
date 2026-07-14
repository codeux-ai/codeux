import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Menu, X } from "lucide-preact";
import type {
  DocsWebCollectionResponse,
  DocsWebDocument,
} from "../../../../src/contracts/docs-web-types.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { PageContainer } from "../components/layout/PageContainer.js";
import { PageHeader } from "../components/layout/PageHeader.js";
import { SkeletonPanel } from "../components/layout/SkeletonLoader.js";
import { fetchDocsWebCollection, fetchDocsWebDocument } from "./docs-web-api.js";
import { resolveDocsWebHref } from "./docs-web-links.js";
import { DocsWebSidebar } from "./DocsWebSidebar.js";
import { useOptionalDashboardI18n } from "../i18n/context.js";
import { shellMessages } from "../i18n/messages/shell.js";
import "./docs-web.css";

interface DocsWebState {
  collection: DocsWebCollectionResponse | null;
  doc: DocsWebDocument | null;
  loading: boolean;
  error: string | null;
}

function docIdFromPath(pathname: string): string | null {
  if (pathname === "/docs" || pathname === "/docs/") {
    return null;
  }
  if (!pathname.startsWith("/docs/")) {
    return null;
  }
  const value = decodeURIComponent(pathname.slice("/docs/".length)).replace(/^\/+|\/+$/g, "");
  return value || null;
}

function Pagination({ collection, currentDocId }: { collection: DocsWebCollectionResponse; currentDocId: string }) {
  const { translate } = useOptionalDashboardI18n();
  const currentIndex = collection.docs.findIndex((item) => item.id === currentDocId);
  const prev = currentIndex > 0 ? collection.docs[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < collection.docs.length - 1 ? collection.docs[currentIndex + 1] : null;

  if (!prev && !next) {
    return null;
  }

  return (
    <nav className="mt-10 grid gap-3 border-t border-black/[0.08] pt-6 sm:grid-cols-2 dark:border-white/[0.08]" aria-label={translate(shellMessages, "docsPagination")}>
      {prev ? (
        <Link
          to={prev.path}
          className="group flex min-h-28 flex-col gap-2 rounded-lg border border-black/[0.08] bg-white/70 p-4 text-left no-underline decoration-transparent transition-colors hover:border-signal-500/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:bg-white/[0.055]"
        >
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 group-hover:text-signal-500">
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            {translate(shellMessages, "docsPrevious")}
          </span>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white">
            {prev.title}
          </span>
        </Link>
      ) : <div className="hidden sm:block" />}

      {next ? (
        <Link
          to={next.path}
          className="group flex min-h-28 flex-col items-end gap-2 rounded-lg border border-black/[0.08] bg-white/70 p-4 text-right no-underline decoration-transparent transition-colors hover:border-signal-500/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:bg-white/[0.055]"
        >
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 group-hover:text-signal-500">
            {translate(shellMessages, "docsNext")}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white">
            {next.title}
          </span>
        </Link>
      ) : <div className="hidden sm:block" />}
    </nav>
  );
}

export const DocsWebPage: FunctionComponent = () => {
  const { translate } = useOptionalDashboardI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [state, setState] = useState<DocsWebState>({
    collection: null,
    doc: null,
    loading: true,
    error: null,
  });

  const requestedDocId = docIdFromPath(pathname);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    void (async () => {
      try {
        const collection = await fetchDocsWebCollection();
        const docId = requestedDocId ?? collection.defaultDocId;
        const { doc } = await fetchDocsWebDocument(docId);
        if (!cancelled) {
          setState({ collection, doc, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : translate(shellMessages, "docsLoadError"),
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedDocId, translate]);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  const renderedHtml = useMemo(() => {
    if (!state.collection || !state.doc) {
      return "";
    }
    return renderMarkdown(state.doc.contentMarkdown, {
      transformHref: (href, kind) => kind === "link"
        ? resolveDocsWebHref(href, state.doc!.sourcePath, state.collection!.docs)
        : href,
    });
  }, [state.collection, state.doc]);

  return (
    <PageContainer aria-label={translate(shellMessages, "documentation")} padding="standard" className="gap-8" data-testid="docs-web-page-root">
      <PageHeader
        icon={BookOpen}
        eyebrow={translate(shellMessages, "documentation")}
        title={translate(shellMessages, "docsTitle")}
        subtitle={translate(shellMessages, "docsSubtitle")}
        actions={
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/[0.08] bg-white/75 px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.09] lg:hidden"
            onClick={() => setIsSidebarOpen((value) => !value)}
            aria-expanded={isSidebarOpen}
            aria-controls="docs-web-mobile-navigation"
          >
            {isSidebarOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            {translate(shellMessages, "docsMenu")}
          </button>
        }
      />

      {state.loading ? (
        <SkeletonPanel />
      ) : state.error ? (
        <div className="rounded-lg border border-ember-500/20 bg-ember-500/10 p-5 text-sm text-ember-700 dark:text-ember-300" role="alert">
          {state.error}
        </div>
      ) : state.collection && state.doc ? (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div
            id="docs-web-mobile-navigation"
            className={`${isSidebarOpen ? "block" : "hidden"} lg:block`}
          >
            <div className="lg:sticky lg:top-6 lg:h-[calc(100dvh-9rem)]">
              <DocsWebSidebar
                collection={state.collection}
                currentDocId={state.doc.id}
                onNavigate={() => setIsSidebarOpen(false)}
              />
            </div>
          </div>

          <main className="min-w-0" aria-label={translate(shellMessages, "documentationDocument", { title: state.doc.title })}>
            <article className="docs-web-prose rounded-lg border border-black/[0.08] bg-white/78 px-5 py-7 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-900/62 dark:shadow-[0_30px_100px_rgba(0,0,0,0.24)] sm:px-8 sm:py-9 lg:px-10 lg:py-10">
              <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-black/[0.08] pb-4 dark:border-white/[0.08]">
                <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  {state.doc.section}
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-500">{state.doc.sourcePath}</span>
              </div>
              <div
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </article>
            <Pagination collection={state.collection} currentDocId={state.doc.id} />
          </main>
        </div>
      ) : null}
    </PageContainer>
  );
};
