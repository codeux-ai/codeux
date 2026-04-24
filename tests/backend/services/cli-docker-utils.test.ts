import { describe, expect, it, vi } from "vitest";
import {
  resolveConfiguredPath,
  getDockerUserSpec,
  toDockerMountArg,
  pickContainerEnv,
  mapPathPrefix,
  isDockerWorkspaceMountError,
  getProviderFallbackInstallCommand
} from "../../../src/services/cli-docker-utils.js";
import os from "os";
import path from "path";

describe("cli-docker-utils", () => {
    it("resolveConfiguredPath", () => {
        expect(resolveConfiguredPath("/repo", "")).toBe("");
        expect(resolveConfiguredPath("/repo", "  ")).toBe("");
        expect(resolveConfiguredPath("/repo", "~")).toBe(os.homedir());
        expect(resolveConfiguredPath("/repo", "~/test")).toBe(path.join(os.homedir(), "test"));
        expect(resolveConfiguredPath("/repo", "/absolute")).toBe("/absolute");
        expect(resolveConfiguredPath("/repo", "relative")).toBe(path.resolve("/repo", "relative"));
    });

    it("getDockerUserSpec handles missing uid/gid", () => {
        const originalUid = process.getuid;
        const originalGid = process.getgid;

        (process as any).getuid = undefined;
        expect(getDockerUserSpec()).toBeUndefined();

        process.getuid = originalUid;
        (process as any).getgid = undefined;
        expect(getDockerUserSpec()).toBeUndefined();

        process.getuid = originalUid;
        process.getgid = originalGid;
    });

    it("toDockerMountArg", () => {
        expect(toDockerMountArg({ source: "s", destination: "d", readonly: true })).toBe("type=bind,source=s,target=d,readonly");
        expect(toDockerMountArg({ source: "s", destination: "d", readonly: false })).toBe("type=bind,source=s,target=d");
    });

    it("pickContainerEnv", () => {
        const env = { GEMINI_API_KEY: "key", GEMINI_CLI_TRUST_WORKSPACE: "true", UNKNOWN: "u", HTTP_PROXY: "proxy" };
        const res = pickContainerEnv(env);
        expect(res).toEqual([
            { key: "GEMINI_API_KEY", value: "key" },
            { key: "GEMINI_CLI_TRUST_WORKSPACE", value: "true" },
            { key: "HTTP_PROXY", value: "proxy" },
        ]);
    });

    it("mapPathPrefix", () => {
        const p1 = mapPathPrefix("/a/b/c", "/a", "/x");
        expect(p1).toBe(path.resolve("/x/b/c"));

        const p2 = mapPathPrefix("/d", "/a", "/x");
        expect(p2).toBe(path.resolve("/d"));
    });

    it("isDockerWorkspaceMountError", () => {
        expect(isDockerWorkspaceMountError({ stdout: "invalid mount config for type \"bind\"", stderr: "bind source path does not exist", exitCode: 1 } as any)).toBe(true);
        expect(isDockerWorkspaceMountError({ stdout: "mounts denied", stderr: "", exitCode: 1 } as any)).toBe(true);
        expect(isDockerWorkspaceMountError({ stdout: "permission denied mount", stderr: "", exitCode: 1 } as any)).toBe(true);
        expect(isDockerWorkspaceMountError({ stdout: "ok", stderr: "", exitCode: 0 } as any)).toBe(false);
    });

    it("getProviderFallbackInstallCommand", () => {
        expect(getProviderFallbackInstallCommand("gemini")).toBe("npm install -g @google/gemini-cli");
        expect(getProviderFallbackInstallCommand("codex")).toBe("npm install -g @openai/codex");
        expect(getProviderFallbackInstallCommand("claude")).toContain("curl -fsSL");
        expect(getProviderFallbackInstallCommand("unknown")).toBeUndefined();
    });
});
