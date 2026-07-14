import type { ComponentChildren, FunctionComponent } from "preact";
import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/preact";
import { DashboardI18nProvider } from "../../dashboard/src/v2/i18n/index.js";
import type { DashboardLocale } from "../../dashboard/src/v2/i18n/locales.js";

type I18nRenderOptions = Omit<RenderOptions, "wrapper"> & {
  wrapper?: FunctionComponent<{ children: ComponentChildren }>;
};

export const renderWithI18n = (
  ui: ComponentChildren,
  options: I18nRenderOptions = {},
  locale: DashboardLocale = "en",
): RenderResult => {
  const ExistingWrapper = options.wrapper;
  const Wrapper: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
    <DashboardI18nProvider initialLocale={locale} storage={null}>
      {ExistingWrapper ? <ExistingWrapper>{children}</ExistingWrapper> : children}
    </DashboardI18nProvider>
  );

  return render(ui, { ...options, wrapper: Wrapper });
};
