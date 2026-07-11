import { describe, expect, it } from "vitest";
import {
  OPEN_SOURCE_SOFTWARE,
  type OpenSourceSoftwareEntry,
} from "../../../dashboard/src/v2/lib/open-source-software.js";

const PLACEHOLDER_LICENSES = new Set(["", "n/a", "none", "unknown", "tbd"]);

describe("OPEN_SOURCE_SOFTWARE", () => {
  it("provides complete metadata without placeholder licenses", () => {
    expect(OPEN_SOURCE_SOFTWARE.length).toBeGreaterThan(0);

    for (const entry of OPEN_SOURCE_SOFTWARE) {
      expect(entry.id.trim()).not.toBe("");
      expect(entry.name.trim()).not.toBe("");
      expect(entry.usageArea.trim()).not.toBe("");
      expect(PLACEHOLDER_LICENSES.has(entry.license.trim().toLowerCase())).toBe(false);
      expect(entry.projectUrl.trim()).not.toBe("");
    }
  });

  it("keeps project ids and canonical projects unique", () => {
    const ids = OPEN_SOURCE_SOFTWARE.map((entry) => entry.id);
    const projectNames = OPEN_SOURCE_SOFTWARE.map((entry) => entry.name.toLowerCase());
    const projectUrls = OPEN_SOURCE_SOFTWARE.map((entry) => entry.projectUrl.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(projectNames).size).toBe(projectNames.length);
    expect(new Set(projectUrls).size).toBe(projectUrls.length);
  });

  it("is ordered deterministically by stable id", () => {
    const ids = OPEN_SOURCE_SOFTWARE.map((entry) => entry.id);

    expect(ids).toEqual([...ids].sort());
  });

  it("uses safe HTTP(S) project URLs", () => {
    for (const entry of OPEN_SOURCE_SOFTWARE) {
      const url = new URL(entry.projectUrl);
      expect(["http:", "https:"]).toContain(url.protocol);
      expect(url.hostname).not.toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
  });

  it("includes representative runtime, dashboard, and packaged-app projects", () => {
    expect(findEntry("mcp-typescript-sdk")).toMatchObject({
      name: "Model Context Protocol TypeScript SDK",
      usageArea: "Runtime",
      license: "MIT",
    });
    expect(findEntry("preact")).toMatchObject({
      name: "Preact",
      usageArea: "Dashboard",
      license: "MIT",
    });
    expect(findEntry("electron")).toMatchObject({
      name: "Electron",
      usageArea: "Packaged app",
      license: "MIT",
    });
  });
});

function findEntry(id: string): OpenSourceSoftwareEntry | undefined {
  return OPEN_SOURCE_SOFTWARE.find((entry) => entry.id === id);
}
