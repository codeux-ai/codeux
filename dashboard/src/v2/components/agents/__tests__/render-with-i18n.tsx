import { h, type ComponentChildren, type VNode } from "preact";
import { render, type RenderResult } from "@testing-library/preact";
import { DashboardI18nProvider } from "../../../i18n/index.js";
import type { DashboardLocale } from "../../../i18n/index.js";

export const renderWithI18n = (ui: VNode, locale: DashboardLocale = "en"): RenderResult => render(ui, {
  wrapper: ({ children }: { children: ComponentChildren }) => (
    <DashboardI18nProvider initialLocale={locale} storage={null}>{children}</DashboardI18nProvider>
  ),
});
