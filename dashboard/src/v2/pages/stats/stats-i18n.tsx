import { createContext, type ComponentChildren, type FunctionComponent } from "preact";
import { useContext, useMemo } from "preact/hooks";
import {
  createDashboardFormatters,
  translateDashboardMessage,
  translateDashboardPlural,
  type DashboardLocale,
  type DashboardMessageVariables,
  type DashboardPluralMessageKey,
  type DashboardTextMessageKey,
} from "../../i18n/index.js";
import { statsMessages } from "../../i18n/messages/stats.js";

export type StatsMessageKey = DashboardTextMessageKey<typeof statsMessages>;
export type StatsPluralMessageKey = DashboardPluralMessageKey<typeof statsMessages>;

export interface StatsI18nValue extends ReturnType<typeof createDashboardFormatters> {
  locale: DashboardLocale;
  text: (key: StatsMessageKey, variables?: DashboardMessageVariables) => string;
  plural: (
    key: StatsPluralMessageKey,
    count: number,
    variables?: DashboardMessageVariables,
    options?: Intl.PluralRulesOptions,
  ) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatPercentage: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const createStatsI18nValue = (locale: DashboardLocale): StatsI18nValue => {
  const formatters = createDashboardFormatters(locale);
  return {
    locale,
    ...formatters,
    text: (key, variables) => translateDashboardMessage(statsMessages, locale, key, variables),
    plural: (key, count, variables, options) => (
      translateDashboardPlural(statsMessages, locale, key, count, variables, options)
    ),
    formatCurrency: (value, currency = "USD") => formatters.formatNumber(value, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    formatPercentage: (value, options) => formatters.formatNumber(value, {
      style: "percent",
      ...options,
    }),
  };
};

const DEFAULT_STATS_I18N = createStatsI18nValue("en");
const StatsI18nContext = createContext<StatsI18nValue>(DEFAULT_STATS_I18N);

export const StatsI18nProvider: FunctionComponent<{
  children: ComponentChildren;
  locale: DashboardLocale;
}> = ({ children, locale }) => {
  const value = useMemo(() => createStatsI18nValue(locale), [locale]);
  return <StatsI18nContext.Provider value={value}>{children}</StatsI18nContext.Provider>;
};

export const useStatsI18n = (): StatsI18nValue => useContext(StatsI18nContext);
