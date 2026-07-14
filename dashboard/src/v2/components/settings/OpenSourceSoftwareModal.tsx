import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ExternalLink, Search } from "lucide-preact";
import { getOpenSourceSoftwareUsageAreaLabel, OPEN_SOURCE_SOFTWARE, type OpenSourceSoftwareEntry } from "../../lib/open-source-software.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";
import { useSettingsOperationsTranslations } from "../../i18n/messages/settings-operations.js";

export interface OpenSourceSoftwareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TITLE_ID = "open-source-software-modal-title";
const DESCRIPTION_ID = "open-source-software-modal-description";
const SEARCH_ID = "open-source-software-search";

function matchesSearch(entry: OpenSourceSoftwareEntry, normalizedQuery: string, localizedUsageArea: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [entry.name, entry.usageArea, localizedUsageArea, entry.license, entry.projectUrl]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export const OpenSourceSoftwareModal: FunctionComponent<OpenSourceSoftwareModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tokens = useInteractionTokens();
  const { locale, t } = useSettingsOperationsTranslations();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingEntries = useMemo(
    () => OPEN_SOURCE_SOFTWARE.filter((entry) => matchesSearch(
      entry,
      normalizedQuery,
      getOpenSourceSoftwareUsageAreaLabel(entry.usageArea, locale),
    )),
    [locale, normalizedQuery],
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={TITLE_ID}
      ariaDescribedBy={DESCRIPTION_ID}
      initialFocusRef={searchInputRef}
      className="flex h-[min(48rem,calc(100dvh-2rem))] w-full max-w-5xl flex-col !overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-black/[0.06] px-4 py-5 dark:border-white/[0.06] sm:px-6">
          <h2 id={TITLE_ID} className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t("Open Source Software")}
          </h2>
          <p id={DESCRIPTION_ID} className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {t("Browse the open-source projects included in the Code UX runtime, dashboard, and packaged application. This catalog is informational and does not change your settings.")}
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 sm:max-w-md">
              <label htmlFor={SEARCH_ID} className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                {t("Search software catalog")}
              </label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-[0.7rem] z-10 h-4 w-4 text-slate-400" />
                <Input
                  ref={searchInputRef}
                  id={SEARCH_ID}
                  type="search"
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder={t("Search by project, area, or license")}
                  className="w-full min-w-0 pl-10"
                  autoComplete="off"
                />
              </div>
            </div>
            <p role="status" aria-live="polite" className="pb-5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("{shown} of {total} projects shown", { shown: matchingEntries.length, total: OPEN_SOURCE_SOFTWARE.length })}
            </p>
          </div>
        </header>

        <div
          data-testid="open-source-software-catalog-scroll-region"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          {matchingEntries.length > 0 ? (
            <div>
              <div aria-hidden="true" className="mb-2 hidden grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_minmax(0,1fr)_auto] gap-4 px-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 sm:grid">
                <span>{t("Project")}</span>
                <span>{t("Usage area")}</span>
                <span>{t("License")}</span>
                <span>{t("Project link")}</span>
              </div>
              <ul role="list" aria-label={t("Open-source software catalog")} className="space-y-2">
                {matchingEntries.map((entry) => {
                  const safeProjectUrl = getSafeUrl(entry.projectUrl);

                  return (
                    <li key={entry.id} className="rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-3">
                      <article className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:hidden">{t("Project")}</span>
                          <h3 className="break-words text-sm font-bold text-slate-900 dark:text-white">{entry.name}</h3>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:hidden">{t("Usage area")}</span>
                          <p className="break-words text-sm text-slate-600 dark:text-slate-300">{getOpenSourceSoftwareUsageAreaLabel(entry.usageArea, locale)}</p>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:hidden">{t("License")}</span>
                          <p className="break-words text-sm text-slate-600 dark:text-slate-300">{entry.license}</p>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:hidden">{t("Project link")}</span>
                          {safeProjectUrl ? (
                            <a
                              href={safeProjectUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t("Visit the {name} project website", { name: entry.name })}
                              style={{
                                transitionDuration: tokens.controlFeedback.duration,
                                transitionTimingFunction: tokens.controlFeedback.ease,
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-signal-700 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:text-signal-300"
                            >
                              {t("Project website")}
                              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-slate-400">{t("Project website unavailable")}</span>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-ui)] border border-dashed border-[color:var(--border-hairline)] px-6 py-10 text-center">
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">{t("No matching open-source projects")}</p>
              <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
                {t("No projects match “{query}”. Try a project name, usage area, or license.", { query: query.trim() })}
              </p>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse items-stretch border-t border-black/[0.06] px-4 py-4 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            style={{
              transitionDuration: tokens.controlFeedback.duration,
              transitionTimingFunction: tokens.controlFeedback.ease,
            }}
            className={`${SHARED_INTERACTION_CLASSES} inline-flex items-center justify-center rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-2 text-sm font-bold text-slate-700 hover:bg-[var(--surface-glass-hover)] dark:text-slate-200`}
          >
            {t("Close")}
          </button>
        </footer>
      </div>
    </Modal>
  );
};
