import { describe, it, expect } from "vitest";
import { computeEnvDiff } from "../../../../src/shared/subprocess/command-spawner-client.js";
import {
  MAX_SPAWNER_STREAM_LINE_CHARS,
  boundSpawnerStreamLine,
} from "../../../../src/shared/subprocess/command-spawner-protocol.js";

describe("computeEnvDiff", () => {
  it("returns useBaseEnv when the effective env matches the base", () => {
    const base = { PATH: "/usr/bin", HOME: "/home/user" };
    expect(computeEnvDiff(base, { ...base })).toEqual({ useBaseEnv: true });
  });

  it("includes only changed/added keys in the override", () => {
    const base = { PATH: "/usr/bin", HOME: "/home/user" };
    const diff = computeEnvDiff(base, { PATH: "/usr/bin", HOME: "/home/user", GIT_DIR: "/repo/.git" });
    expect(diff).toEqual({ envOverride: { GIT_DIR: "/repo/.git" } });
  });

  it("captures a runtime mutation of an existing key (e.g. DOCKER_HOST)", () => {
    const base = { PATH: "/usr/bin", DOCKER_HOST: "" };
    const diff = computeEnvDiff(base, { PATH: "/usr/bin", DOCKER_HOST: "npipe:////./pipe/docker" });
    expect(diff).toEqual({ envOverride: { DOCKER_HOST: "npipe:////./pipe/docker" } });
  });

  it("unsets base keys that are absent (or non-string) in the effective env", () => {
    const base = { PATH: "/usr/bin", TMPDIR: "/tmp" };
    const diff = computeEnvDiff(base, { PATH: "/usr/bin" });
    expect(diff).toEqual({ envUnset: ["TMPDIR"] });
  });

  it("reports both overrides and unsets together", () => {
    const base = { PATH: "/usr/bin", OLD: "x" };
    const diff = computeEnvDiff(base, { PATH: "/usr/local/bin", NEW: "y" });
    expect(diff.envOverride).toEqual({ PATH: "/usr/local/bin", NEW: "y" });
    expect(diff.envUnset).toEqual(["OLD"]);
    expect(diff.useBaseEnv).toBeUndefined();
  });

  it("ignores non-string values in the effective env", () => {
    const base = { PATH: "/usr/bin" };
    const effective = { PATH: "/usr/bin", UNDEFINED_KEY: undefined } as NodeJS.ProcessEnv;
    expect(computeEnvDiff(base, effective)).toEqual({ useBaseEnv: true });
  });
});

describe("boundSpawnerStreamLine", () => {
  it("bounds oversized live IPC lines while retaining diagnostic head and tail context", () => {
    const line = `${"head".repeat(20_000)}${"tail".repeat(20_000)}`;
    const bounded = boundSpawnerStreamLine(line);

    expect(bounded).toHaveLength(MAX_SPAWNER_STREAM_LINE_CHARS);
    expect(bounded.startsWith("head")).toBe(true);
    expect(bounded.endsWith("tail")).toBe(true);
    expect(bounded).toContain("stream line truncated");
  });
});
