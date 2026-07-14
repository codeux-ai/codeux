import { createContext, type ComponentChildren, type FunctionComponent } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { createDashboardFormatters, type DashboardFormatters } from "./formatters.js";
import {
  DEFAULT_DASHBOARD_LOCALE,
  resolveDashboardLocale,
  translateDashboardMessage,
  translateDashboardPlural,
  type DashboardLocale,
  type DashboardMessageBundle,
  type DashboardMessageVariables,
  type DashboardPluralMessageKey,
  type DashboardTextMessageKey,
} from "./locales.js";
import {
  DASHBOARD_LOCALE_STORAGE_KEY,
  readDashboardLocale,
  writeDashboardLocale,
  type DashboardLocaleStorage,
} from "./storage.js";

export interface DashboardTranslate {
  <Bundle extends DashboardMessageBundle, Key extends DashboardTextMessageKey<Bundle>>(
    bundle: Bundle,
    key: Key,
    variables?: DashboardMessageVariables,
  ): string;
}

export interface DashboardTranslatePlural {
  <Bundle extends DashboardMessageBundle, Key extends DashboardPluralMessageKey<Bundle>>(
    bundle: Bundle,
    key: Key,
    count: number,
    variables?: DashboardMessageVariables,
    options?: Intl.PluralRulesOptions,
  ): string;
}

export interface DashboardI18nContextValue extends DashboardFormatters {
  locale: DashboardLocale;
  setLocale: (locale: DashboardLocale) => void;
  translate: DashboardTranslate;
  translatePlural: DashboardTranslatePlural;
}

export interface DashboardI18nProviderProps {
  children: ComponentChildren;
  initialLocale?: DashboardLocale;
  storage?: DashboardLocaleStorage | null;
}

const fallbackFormatters = createDashboardFormatters("en");
const FALLBACK_DASHBOARD_I18N: DashboardI18nContextValue = {
  locale: "en",
  setLocale: () => undefined,
  translate: (bundle, key, variables) => translateDashboardMessage(bundle, "en", key, variables),
  translatePlural: (bundle, key, count, variables, options) => (
    translateDashboardPlural(bundle, "en", key, count, variables, options)
  ),
  ...fallbackFormatters,
};

const DashboardI18nContext = createContext<DashboardI18nContextValue>(FALLBACK_DASHBOARD_I18N);

const defaultDashboardFormatters = createDashboardFormatters(DEFAULT_DASHBOARD_LOCALE);
const defaultDashboardI18n: DashboardI18nContextValue = {
  locale: DEFAULT_DASHBOARD_LOCALE,
  setLocale: () => {},
  translate: (bundle, key, variables) => translateDashboardMessage(
    bundle,
    DEFAULT_DASHBOARD_LOCALE,
    key,
    variables,
  ),
  translatePlural: (bundle, key, count, variables, options) => translateDashboardPlural(
    bundle,
    DEFAULT_DASHBOARD_LOCALE,
    key,
    count,
    variables,
    options,
  ),
  ...defaultDashboardFormatters,
};

export const syncDashboardDocumentLocale = (locale: DashboardLocale): void => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
};

export const initializeDashboardLocale = (
  storage?: DashboardLocaleStorage | null,
): DashboardLocale => {
  const locale = readDashboardLocale(storage);
  syncDashboardDocumentLocale(locale);
  return locale;
};

export const DashboardI18nProvider: FunctionComponent<DashboardI18nProviderProps> = ({
  children,
  initialLocale,
  storage,
}) => {
  const [locale, setLocaleState] = useState<DashboardLocale>(() => {
    const restoredLocale = initialLocale ?? readDashboardLocale(storage);
    syncDashboardDocumentLocale(restoredLocale);
    return restoredLocale;
  });

  const setLocale = useCallback((nextLocale: DashboardLocale): void => {
    const resolvedLocale = resolveDashboardLocale(nextLocale);
    syncDashboardDocumentLocale(resolvedLocale);
    setLocaleState(resolvedLocale);
    writeDashboardLocale(resolvedLocale, storage);
  }, [storage]);

  useLayoutEffect(() => {
    syncDashboardDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== DASHBOARD_LOCALE_STORAGE_KEY && event.key !== null) {
        return;
      }
      const nextLocale = resolveDashboardLocale(event.newValue);
      syncDashboardDocumentLocale(nextLocale);
      setLocaleState(nextLocale);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const formatters = useMemo(() => createDashboardFormatters(locale), [locale]);
  const translate = useCallback<DashboardTranslate>((bundle, key, variables) => (
    translateDashboardMessage(bundle, locale, key, variables)
  ), [locale]);
  const translatePlural = useCallback<DashboardTranslatePlural>((bundle, key, count, variables, options) => (
    translateDashboardPlural(bundle, locale, key, count, variables, options)
  ), [locale]);
  const value = useMemo<DashboardI18nContextValue>(() => ({
    locale,
    setLocale,
    translate,
    translatePlural,
    ...formatters,
  }), [formatters, locale, setLocale, translate, translatePlural]);

  return (
    <DashboardI18nContext.Provider value={value}>
      {children}
    </DashboardI18nContext.Provider>
  );
};

export const useDashboardI18n = (): DashboardI18nContextValue => {
  return useContext(DashboardI18nContext);
};

/**
 * Returns the active dashboard locale when mounted in the application and an
 * English compatibility value for independently rendered feature surfaces.
 */
export const useOptionalDashboardI18n = (): DashboardI18nContextValue => (
  useContext(DashboardI18nContext) ?? defaultDashboardI18n
);
