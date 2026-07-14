// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardI18nProvider,
  DASHBOARD_LOCALE_STORAGE_KEY,
  createDashboardFormatters,
  defineDashboardMessages,
  initializeDashboardLocale,
  interpolateDashboardMessage,
  translateDashboardMessage,
  translateDashboardPlural,
  useDashboardI18n,
  type DashboardMessageBundle,
  type DashboardLocaleStorage,
} from "../../../dashboard/src/v2/i18n/index.js";
import { appMessages } from "../../../dashboard/src/v2/i18n/messages/app.js";

const featureMessages = defineDashboardMessages({
  en: {
    greeting: "Hello, {name}!",
    itemCount: {
      one: "{count} item",
      other: "{count} items",
    },
  },
  de: {
    greeting: "Hallo, {name}!",
    itemCount: {
      one: "{count} Eintrag",
      other: "{count} Einträge",
    },
  },
});

const I18nHarness = () => {
  const i18n = useDashboardI18n();
  return (
    <div>
      <output aria-label="locale">{i18n.locale}</output>
      <output aria-label="skip-link">
        {i18n.translate(appMessages, "skipToMainContent")}
      </output>
      <output aria-label="number">
        {i18n.formatNumber(1234.5, { minimumFractionDigits: 1 })}
      </output>
      <button type="button" onClick={() => i18n.setLocale("de")}>Deutsch</button>
      <button type="button" onClick={() => i18n.setLocale("en")}>English</button>
    </div>
  );
};

describe("dashboard i18n foundation", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts in English when no preference exists", () => {
    render(
      <DashboardI18nProvider>
        <I18nHarness />
      </DashboardI18nProvider>,
    );

    expect(screen.getByLabelText("locale").textContent).toBe("en");
    expect(screen.getByLabelText("skip-link").textContent).toBe("Skip to main content");
    expect(document.documentElement.lang).toBe("en");
  });

  it("restores stored German and synchronizes the document before render", () => {
    window.localStorage.setItem(DASHBOARD_LOCALE_STORAGE_KEY, "de");

    expect(initializeDashboardLocale()).toBe("de");
    expect(document.documentElement.lang).toBe("de");

    render(
      <DashboardI18nProvider initialLocale="de">
        <I18nHarness />
      </DashboardI18nProvider>,
    );

    expect(screen.getByLabelText("locale").textContent).toBe("de");
    expect(screen.getByLabelText("skip-link").textContent).toBe("Zum Hauptinhalt springen");
  });

  it("switches locale immediately and persists the selection", () => {
    render(
      <DashboardI18nProvider>
        <I18nHarness />
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));

    expect(screen.getByLabelText("locale").textContent).toBe("de");
    expect(screen.getByLabelText("skip-link").textContent).toBe("Zum Hauptinhalt springen");
    expect(screen.getByLabelText("number").textContent).toBe(
      new Intl.NumberFormat("de", { minimumFractionDigits: 1 }).format(1234.5),
    );
    expect(window.localStorage.getItem(DASHBOARD_LOCALE_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });

  it("falls back to English for invalid persisted values", () => {
    window.localStorage.setItem(DASHBOARD_LOCALE_STORAGE_KEY, "fr");
    document.documentElement.lang = "de";

    render(
      <DashboardI18nProvider>
        <I18nHarness />
      </DashboardI18nProvider>,
    );

    expect(screen.getByLabelText("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps switching when storage is unavailable or throws", () => {
    const throwingStorage: DashboardLocaleStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
    };

    const unavailableView = render(
      <DashboardI18nProvider storage={null}>
        <I18nHarness />
      </DashboardI18nProvider>,
    );
    expect(screen.getByLabelText("locale").textContent).toBe("en");
    unavailableView.unmount();

    render(
      <DashboardI18nProvider storage={throwingStorage}>
        <I18nHarness />
      </DashboardI18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));

    expect(screen.getByLabelText("locale").textContent).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(throwingStorage.setItem).toHaveBeenCalledWith(DASHBOARD_LOCALE_STORAGE_KEY, "de");
  });

  it("synchronizes locale changes and invalid values from other tabs", () => {
    render(
      <DashboardI18nProvider>
        <I18nHarness />
      </DashboardI18nProvider>,
    );

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: DASHBOARD_LOCALE_STORAGE_KEY,
        newValue: "de",
      }));
    });
    expect(screen.getByLabelText("locale").textContent).toBe("de");
    expect(document.documentElement.lang).toBe("de");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: DASHBOARD_LOCALE_STORAGE_KEY,
        newValue: "invalid",
      }));
    });
    expect(screen.getByLabelText("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("interpolates variables literally and applies locale plural rules", () => {
    const runtimeIncompleteMessages = {
      en: { label: "English fallback" },
      de: {},
    } as unknown as DashboardMessageBundle<{ readonly label: string }>;

    expect(interpolateDashboardMessage("{name}: {value}", {
      name: "$& <Ada>",
      value: 7,
    })).toBe("$& <Ada>: 7");
    expect(interpolateDashboardMessage("Hello, {missing}!")).toBe("Hello, {missing}!");
    expect(translateDashboardMessage(featureMessages, "de", "greeting", {
      name: "Sam",
    })).toBe("Hallo, Sam!");
    expect(translateDashboardMessage(runtimeIncompleteMessages, "de", "label")).toBe("English fallback");
    expect(translateDashboardPlural(featureMessages, "en", "itemCount", 1)).toBe("1 item");
    expect(translateDashboardPlural(featureMessages, "en", "itemCount", 2)).toBe("2 items");
    expect(translateDashboardPlural(featureMessages, "de", "itemCount", 2)).toBe("2 Einträge");
    expect(translateDashboardPlural(featureMessages, "de", "itemCount", 1000)).toBe("1.000 Einträge");
    expect(translateDashboardPlural(featureMessages, "de", "itemCount", 1_000, {
      count: "1.000",
    })).toBe("1.000 Einträge");
  });

  it("formats numbers, dates, times, relative times, and lists with the selected locale", () => {
    const formatters = createDashboardFormatters("de");
    const instant = Date.UTC(2026, 6, 13, 14, 5);
    const dateOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    };

    expect(formatters.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de").format(1234.5));
    expect(formatters.formatDate(instant, dateOptions)).toBe(
      new Intl.DateTimeFormat("de", dateOptions).format(instant),
    );
    expect(formatters.formatTime(instant, timeOptions)).toBe(
      new Intl.DateTimeFormat("de", timeOptions).format(instant),
    );
    expect(formatters.formatRelativeTime(-2, "day")).toBe(
      new Intl.RelativeTimeFormat("de").format(-2, "day"),
    );
    expect(formatters.formatList(["Planen", "Bauen", "Prüfen"])).toBe(
      new Intl.ListFormat("de").format(["Planen", "Bauen", "Prüfen"]),
    );
  });
});
