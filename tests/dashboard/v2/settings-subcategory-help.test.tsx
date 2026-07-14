/**
 * @vitest-environment jsdom
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { SectionCard } from "../../../dashboard/src/v2/components/settings/panels/SharedPanelComponents.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import { SETTINGS_SUBCATEGORY_DOCS } from "../../../dashboard/src/v2/lib/settings-subcategory-docs.js";

beforeEach(() => {
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = "en";
});

describe("settings subcategory help", () => {
  it("renders card-level info and docs controls with subcategory-specific accessible names", () => {
    render(
      <SectionCard title="Default Routing Anchors" icon={<span aria-hidden>R</span>}>
        <p>Routing settings</p>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: "Show help for Default Routing Anchors" })).toBeInTheDocument();
    const docsLink = screen.getByRole("link", { name: "Open documentation for Default Routing Anchors" });

    expect(docsLink).toHaveAttribute("href", "/docs/settings-default-routing-anchors");
  });

  it("supports explicit help metadata for dynamic subcategory titles", () => {
    render(
      <SectionCard title="Playwright" helpId="custom-mcp-server" icon={<span aria-hidden>M</span>}>
        <p>MCP server settings</p>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: "Show help for Playwright" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open documentation for Playwright" })).toHaveAttribute(
      "href",
      "/docs/settings-custom-mcp-server",
    );
  });

  it.each([
    {
      area: "General",
      helpId: "project-context" as const,
      title: "Project Context",
      localizedTitle: "Projektkontext",
      docsHref: "/docs/settings-project-context",
      copy: [
        "Benennt und kennzeichnet das aktive Projekt, ohne die gespeicherte Projekt-ID oder den Ausführungsverlauf zu ändern.",
        "Der Projektname ist bearbeitbar; Projekt-ID, Quelltyp und Basisverzeichnis zeigen, wie Code UX den Arbeitsbereich adressiert und öffnet.",
        "Verwende einen eindeutigen Projektnamen und richte das Basisverzeichnis am Repository-Stamm aus, den Worker verwenden sollen.",
        "Eine Umbenennung ist rein optisch; ein unerwartetes Basisverzeichnis deutet meist darauf hin, dass das Projekt aus dem falschen Pfad erstellt wurde.",
      ],
    },
    {
      area: "Integrations",
      helpId: "integrations" as const,
      title: "Integrations",
      localizedTitle: "Integrationen",
      docsHref: "/docs/settings-integrations",
      copy: [
        "Listet Anbieter-, Git-Host-, Ticket-, Speichereinbindungs- und schreibgeschützte Importer-Integrationen mit Verwaltungsaktionen auf.",
        "Karten zeigen Verbindung, Authentifizierungshinweise und Aktiv-/Konfiguriert-Status. Google Drive verknüpft ein Host-Verzeichnis, aktiviert die reine Docker-Einbindung und wählt Lese- oder Schreibzugriff.",
        "Lasse Google Drive schreibgeschützt, sofern Container-Agenten keine synchronisierten Dateien ändern müssen. Konfiguriere gemeinsame Anbieter- und Speichervorgaben im Systembereich und überschreibe sie nur bei Bedarf pro Projekt.",
        "Schreibzugriff erlaubt Container-Agenten, synchronisierte Drive-Dateien zu ändern oder zu löschen. Importhinweise können lokale Authentifizierungspfade offenlegen; weitreichende Tokens können externe Arbeitsbereiche für Suchen freigeben.",
      ],
    },
    {
      area: "Danger",
      helpId: "danger-zone" as const,
      title: "Danger Zone",
      localizedTitle: "Gefahrenbereich",
      docsHref: "/docs/settings-danger-zone",
      copy: [
        "Gruppiert die unumkehrbare Projektlöschung und das Zurücksetzen von Projektüberschreibungen.",
        "Projekt zurücksetzen entfernt gespeicherte Überschreibungen; Projekt löschen entfernt das Projekt und zugehörige lokale Laufzeitdaten.",
        "Setze Überschreibungen zurück, bevor du ein Projekt löschst, wenn nur wieder Systemvorgaben geerbt werden sollen.",
        "Löschaktionen können nach der Bestätigung nicht rückgängig gemacht werden.",
      ],
    },
  ])("renders German summary and guidance for $area help", ({ helpId, title, localizedTitle, docsHref, copy }) => {
    render(
      <DashboardI18nProvider initialLocale="de">
        <SectionCard title={title} helpId={helpId} icon={<span aria-hidden>H</span>}>
          <p>Settings</p>
        </SectionCard>
      </DashboardI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Hilfe für ${localizedTitle} anzeigen` }));

    expect(screen.getByRole("heading", { name: localizedTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `Dokumentation für ${localizedTitle} öffnen` })).toHaveAttribute("href", docsHref);
    const help = screen.getByRole("tooltip", { name: `Einstellungen für ${localizedTitle}` });
    expect(help).toBeInTheDocument();
    expect(within(help).getByText("Gesteuerte Funktionen")).toBeInTheDocument();
    expect(within(help).getByText("Empfohlene Konfiguration")).toBeInTheDocument();
    expect(within(help).getByText("Risiken und Hinweise")).toBeInTheDocument();
    for (const text of copy) {
      expect(within(help).getByText(text)).toBeInTheDocument();
    }
  });

  it("has canonical docs files for every subcategory metadata entry", () => {
    const docsRoot = path.resolve(process.cwd(), "docs/settings");
    const docsWebRoot = path.resolve(process.cwd(), "docs-web/settings");

    for (const doc of Object.values(SETTINGS_SUBCATEGORY_DOCS)) {
      expect(existsSync(path.join(docsRoot, `${doc.id}.md`)), `${doc.id} should have canonical docs`).toBe(true);
      expect(existsSync(path.join(docsWebRoot, `${doc.id}.md`)), `${doc.id} should have docs-web docs`).toBe(true);
      expect(doc.docsHref).toMatch(/^\/docs\/settings-[a-z0-9-]+$/u);
    }
  });
});
