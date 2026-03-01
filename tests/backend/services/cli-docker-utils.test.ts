import os from "os";
import { describe, expect, it } from "vitest";
import { mapPathPrefix, pickContainerEnv, resolveConfiguredPath } from "../../../src/services/cli-docker-utils.js";

describe("cli-docker-utils", () => {
  it("resolves configured paths", () => {
    expect(resolveConfiguredPath("/repo", "sub/dir")).toBe("/repo/sub/dir");
    expect(resolveConfiguredPath("/repo", "~/token")).toBe(`${os.homedir()}/token`);
    expect(resolveConfiguredPath("/repo", "/abs/path")).toBe("/abs/path");
  });

  it("maps path prefix safely", () => {
    expect(mapPathPrefix("/a/b/c", "/a", "/x")).toBe("/x/b/c");
    expect(mapPathPrefix("/other/path", "/a", "/x")).toBe("/other/path");
  });

  it("filters environment for container passthrough", () => {
    const vars = pickContainerEnv({ GEMINI_API_KEY: "k", FOO: "bar", GH_TOKEN: "t" });
    expect(vars).toEqual(
      expect.arrayContaining([
        { key: "GEMINI_API_KEY", value: "k" },
        { key: "GH_TOKEN", value: "t" },
      ])
    );
    expect(vars.find((entry) => entry.key === "FOO")).toBeUndefined();
  });
});
