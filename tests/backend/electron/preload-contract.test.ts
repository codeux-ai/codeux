import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("Electron preload contract", () => {
  it("uses a CommonJS-emitted preload for the sandboxed renderer", () => {
    const mainSource = readFileSync(resolve(repoRoot, "src/electron/main.ts"), "utf8");
    const preloadSource = readFileSync(resolve(repoRoot, "src/electron/preload.cts"), "utf8");

    expect(mainSource).toContain('path.join(__dirname, "preload.cjs")');
    expect(preloadSource).toContain('require("electron")');
    expect(preloadSource).not.toMatch(/^\s*import\s+\{[^}]*contextBridge/m);
  });
});
