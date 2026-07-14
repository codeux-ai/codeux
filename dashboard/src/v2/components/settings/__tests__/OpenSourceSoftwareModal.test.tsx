// @vitest-environment jsdom
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_SOURCE_SOFTWARE } from "../../../lib/open-source-software.js";
import { OpenSourceSoftwareModal } from "../OpenSourceSoftwareModal.js";
import { DashboardI18nProvider } from "../../../i18n/index.js";

vi.mock("gsap", () => {
  const gsap = {
    fromTo: vi.fn((_target, _from, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    to: vi.fn((_target, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ add: (callback: () => void) => callback(), revert: vi.fn() })),
  };
  return { default: gsap, gsap };
});

function Harness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setIsOpen(true)}>Inspect open-source software</button>
      <OpenSourceSoftwareModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </main>
  );
}

function GermanHarness() {
  return (
    <DashboardI18nProvider initialLocale="de">
      <Harness />
    </DashboardI18nProvider>
  );
}

async function openModal(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Inspect open-source software" }));
  return screen.findByRole("dialog", { name: "Open Source Software" });
}

describe("OpenSourceSoftwareModal", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("labels the dialog and renders representative entries from the complete catalog", async () => {
    render(<Harness />);
    const dialog = await openModal();

    expect(dialog).toHaveAccessibleDescription(/informational and does not change your settings/i);
    expect(within(dialog).getByLabelText("Search software catalog")).toBeInTheDocument();
    expect(within(dialog).getByText(`${OPEN_SOURCE_SOFTWARE.length} of ${OPEN_SOURCE_SOFTWARE.length} projects shown`)).toBeInTheDocument();
    expect(within(dialog).getByText("Model Context Protocol TypeScript SDK")).toBeInTheDocument();
    expect(within(dialog).getByText("Preact")).toBeInTheDocument();
    expect(within(dialog).getByText("Electron")).toBeInTheDocument();
    expect(within(dialog).getByTestId("open-source-software-catalog-scroll-region")).toHaveClass("overflow-y-auto", "min-h-0");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(OPEN_SOURCE_SOFTWARE.length);
  });

  it("filters locally across catalog fields and reports the filtered count", async () => {
    render(<Harness />);
    const dialog = await openModal();
    const search = within(dialog).getByRole("searchbox", { name: "Search software catalog" });

    fireEvent.input(search, { target: { value: "packaged app" } });

    expect(within(dialog).getByText(`1 of ${OPEN_SOURCE_SOFTWARE.length} projects shown`)).toBeInTheDocument();
    expect(within(dialog).getByText("Electron")).toBeInTheDocument();
    expect(within(dialog).queryByText("Preact")).not.toBeInTheDocument();
  });

  it("shows an intentional empty state when no entries match", async () => {
    render(<Harness />);
    const dialog = await openModal();

    fireEvent.input(within(dialog).getByLabelText("Search software catalog"), {
      target: { value: "definitely-not-in-the-catalog" },
    });

    expect(within(dialog).getByText(`0 of ${OPEN_SOURCE_SOFTWARE.length} projects shown`)).toBeInTheDocument();
    expect(within(dialog).getByText("No matching open-source projects")).toBeInTheDocument();
    expect(within(dialog).getByText(/No projects match “definitely-not-in-the-catalog”/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
  });

  it("sanitizes every project link and opens it in an isolated tab", async () => {
    render(<Harness />);
    const dialog = await openModal();
    const links = within(dialog).getAllByRole("link");

    expect(links).toHaveLength(OPEN_SOURCE_SOFTWARE.length);
    for (const link of links) {
      expect(new URL(link.getAttribute("href") ?? "").protocol).toBe("https:");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("dismisses on Escape and restores focus to the trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Inspect open-source software" });
    trigger.focus();
    await openModal();

    await waitFor(() => {
      expect(screen.getByLabelText("Search software catalog")).toHaveFocus();
    });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Open Source Software" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("localizes German catalog controls and usage areas while preserving metadata and focus restoration", async () => {
    render(<GermanHarness />);
    const trigger = screen.getByRole("button", { name: "Inspect open-source software" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Open-Source-Software" });
    const search = within(dialog).getByRole("searchbox", { name: "Softwarekatalog durchsuchen" });
    await waitFor(() => expect(search).toHaveFocus());

    fireEvent.input(search, { target: { value: "Paketierte App" } });
    expect(within(dialog).getByText(`1 von ${OPEN_SOURCE_SOFTWARE.length} Projekten angezeigt`)).toBeInTheDocument();
    expect(within(dialog).getByText("Electron")).toBeInTheDocument();
    expect(within(dialog).getByText("Paketierte App")).toBeInTheDocument();
    expect(within(dialog).getByText("MIT")).toBeInTheDocument();

    fireEvent.input(search, { target: { value: "keine-übereinstimmung" } });
    expect(within(dialog).getByText("Keine passenden Open-Source-Projekte")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Open-Source-Software" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
