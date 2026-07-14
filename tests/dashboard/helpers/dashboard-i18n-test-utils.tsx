import { h, type ComponentChild, type ComponentChildren, type FunctionComponent } from "preact";
import { render as testingRender } from "@testing-library/preact";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import type { DashboardLocale } from "../../../dashboard/src/v2/i18n/locales.js";

export const DashboardI18nTestWrapper: FunctionComponent<{
  children: ComponentChildren;
  locale?: DashboardLocale;
}> = ({ children, locale = "en" }) => (
  <DashboardI18nProvider initialLocale={locale} storage={null}>
    {children}
  </DashboardI18nProvider>
);

// @testing-library/preact types hook-wrapper children as a DOM Element even though
// it renders that value as a Preact child.
export const DashboardI18nHookTestWrapper: FunctionComponent<{ children: Element }> = ({ children }) => (
  <DashboardI18nTestWrapper>{children as unknown as ComponentChild}</DashboardI18nTestWrapper>
);

export const renderWithDashboardI18n = (
  ui: Parameters<typeof testingRender>[0],
  locale: DashboardLocale = "en",
): ReturnType<typeof testingRender> => {
  const wrap = (children: Parameters<typeof testingRender>[0]) => (
    <DashboardI18nTestWrapper locale={locale}>{children}</DashboardI18nTestWrapper>
  );
  const result = testingRender(wrap(ui));
  const baseRerender = result.rerender;
  result.rerender = (nextUi: Parameters<typeof baseRerender>[0]) => baseRerender(wrap(nextUi));
  return result;
};
