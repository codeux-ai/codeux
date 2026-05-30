import { describe, expect, it } from "vitest";
import { resolveLanguageForPath } from "../../../src/services/file-browser-language.js";

describe("resolveLanguageForPath", () => {
  it("maps common source extensions to Monaco language ids", () => {
    expect(resolveLanguageForPath("src/index.ts")).toBe("typescript");
    expect(resolveLanguageForPath("src/app.tsx")).toBe("typescript");
    expect(resolveLanguageForPath("lib/util.js")).toBe("javascript");
    expect(resolveLanguageForPath("styles/main.css")).toBe("css");
    expect(resolveLanguageForPath("README.md")).toBe("markdown");
    expect(resolveLanguageForPath("config/values.yaml")).toBe("yaml");
    expect(resolveLanguageForPath("server/main.py")).toBe("python");
  });

  it("resolves well-known filenames without extensions", () => {
    expect(resolveLanguageForPath("Dockerfile")).toBe("dockerfile");
    expect(resolveLanguageForPath("services/Makefile")).toBe("makefile");
    expect(resolveLanguageForPath(".gitignore")).toBe("ignore");
  });

  it("returns null for unknown or extensionless files", () => {
    expect(resolveLanguageForPath("LICENSE")).toBeNull();
    expect(resolveLanguageForPath("data.unknownext")).toBeNull();
  });
});
