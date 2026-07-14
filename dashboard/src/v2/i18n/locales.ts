export const DASHBOARD_LOCALES = ["en", "de"] as const;

export type DashboardLocale = (typeof DASHBOARD_LOCALES)[number];

export const DEFAULT_DASHBOARD_LOCALE: DashboardLocale = "en";

export type DashboardMessageVariable = string | number | bigint | boolean;
export type DashboardMessageVariables = Readonly<Record<string, DashboardMessageVariable | undefined>>;

export type DashboardPluralMessages = Readonly<
  { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>
>;

export type DashboardMessage = string | DashboardPluralMessages;
export type DashboardMessageCatalog = Readonly<Record<string, DashboardMessage>>;

type LocalizedMessageCatalog<English extends DashboardMessageCatalog> = {
  readonly [Key in keyof English]: English[Key] extends string
    ? string
    : DashboardPluralMessages;
};

export type DashboardMessageBundle<
  English extends DashboardMessageCatalog = DashboardMessageCatalog,
> = Readonly<{
  en: English;
  de: LocalizedMessageCatalog<English>;
}>;

export type DashboardTextMessageKey<Bundle extends DashboardMessageBundle> = {
  [Key in keyof Bundle["en"]]: Bundle["en"][Key] extends string ? Key : never;
}[keyof Bundle["en"]] & string;

export type DashboardPluralMessageKey<Bundle extends DashboardMessageBundle> = {
  [Key in keyof Bundle["en"]]: Bundle["en"][Key] extends DashboardPluralMessages ? Key : never;
}[keyof Bundle["en"]] & string;

export const isDashboardLocale = (value: unknown): value is DashboardLocale => (
  typeof value === "string" && DASHBOARD_LOCALES.some((locale) => locale === value)
);

export const resolveDashboardLocale = (value: unknown): DashboardLocale => (
  isDashboardLocale(value) ? value : DEFAULT_DASHBOARD_LOCALE
);

export const defineDashboardMessages = <
  const English extends DashboardMessageCatalog,
  const German extends LocalizedMessageCatalog<English>,
>(messages: Readonly<{
  en: English;
  de: German & Record<Exclude<keyof German, keyof English>, never>;
}>): DashboardMessageBundle<English> => messages;

export const interpolateDashboardMessage = (
  template: string,
  variables: DashboardMessageVariables = {},
): string => template.replace(
  /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
  (placeholder, variableName: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
      return placeholder;
    }
    const value = variables[variableName];
    return value === undefined ? placeholder : String(value);
  },
);

const getLocalizedMessage = <Bundle extends DashboardMessageBundle>(
  bundle: Bundle,
  locale: DashboardLocale,
  key: keyof Bundle["en"],
): DashboardMessage => {
  const localizedCatalog = bundle[locale] as Partial<Record<keyof Bundle["en"], DashboardMessage>>;
  return localizedCatalog[key] ?? bundle.en[key];
};

export const translateDashboardMessage = <
  Bundle extends DashboardMessageBundle,
  Key extends DashboardTextMessageKey<Bundle>,
>(
  bundle: Bundle,
  locale: DashboardLocale,
  key: Key,
  variables: DashboardMessageVariables = {},
): string => {
  const localizedMessage = getLocalizedMessage(bundle, locale, key);
  const template = typeof localizedMessage === "string"
    ? localizedMessage
    : bundle.en[key] as string;
  return interpolateDashboardMessage(template, variables);
};

export const translateDashboardPlural = <
  Bundle extends DashboardMessageBundle,
  Key extends DashboardPluralMessageKey<Bundle>,
>(
  bundle: Bundle,
  locale: DashboardLocale,
  key: Key,
  count: number,
  variables: DashboardMessageVariables = {},
  options?: Intl.PluralRulesOptions,
): string => {
  const localizedMessage = getLocalizedMessage(bundle, locale, key);
  const englishMessage = bundle.en[key];
  const messages = typeof localizedMessage === "string"
    ? englishMessage as DashboardPluralMessages
    : localizedMessage;
  const pluralCategory = new Intl.PluralRules(locale, options).select(count);
  const template = messages[pluralCategory] ?? messages.other;
  const formattedCount = new Intl.NumberFormat(locale).format(count);
  return interpolateDashboardMessage(template, { ...variables, count: formattedCount });
};
