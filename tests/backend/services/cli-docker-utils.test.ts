import { describe, expect, it, vi } from "vitest";
import {
  resolveConfiguredPath,
  getDockerUserSpec,
  toDockerMountArg,
  pickContainerEnv,
  writeDockerEnvFile,
  mapPathPrefix,
  isDockerWorkspaceMountError,
} from "../../../src/services/cli-docker-utils.js";
import fs from "fs/promises";
import os from "os";
import path from "path";

describe("cli-docker-utils", () => {
    it("resolveConfiguredPath", () => {
        expect(resolveConfiguredPath("/repo", "")).toBe("");
        expect(resolveConfiguredPath("/repo", "  ")).toBe("");
        expect(resolveConfiguredPath("/repo", "~")).toBe(os.homedir());
        expect(resolveConfiguredPath("/repo", "~/test")).toBe(path.join(os.homedir(), "test"));
        expect(resolveConfiguredPath("/repo", "/absolute")).toBe(path.resolve("/absolute"));
        expect(resolveConfiguredPath("/repo", "relative")).toBe(path.resolve("/repo", "relative"));
    });

    it("getDockerUserSpec falls back to 1000:1000 when uid/gid unavailable or root", () => {
        const originalUid = process.getuid;
        const originalGid = process.getgid;

        (process as any).getuid = undefined;
        expect(getDockerUserSpec()).toBe("1000:1000");

        process.getuid = originalUid;
        (process as any).getgid = undefined;
        expect(getDockerUserSpec()).toBe("1000:1000");

        process.getuid = () => 0;
        process.getgid = () => 0;
        expect(getDockerUserSpec()).toBe("1000:1000");

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

    it("writeDockerEnvFile serializes selected env without exposing values as argv flags", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-env-file-test-"));
        try {
            const filePath = path.join(dir, "provider.env");
            await writeDockerEnvFile(filePath, [
                { key: "GEMINI_API_KEY", value: "secret-value" },
                { key: "1_INVALID", value: "ignored" },
                { key: "HTTP_PROXY", value: "http://proxy" },
            ]);

            expect(await fs.readFile(filePath, "utf8")).toBe("GEMINI_API_KEY=secret-value\nHTTP_PROXY=http://proxy\n");
            if (process.platform !== "win32") {
                const stat = await fs.stat(filePath);
                expect(stat.mode & 0o777).toBe(0o600);
            }
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("writeDockerEnvFile rejects multiline values Docker env-files cannot represent safely", async () => {
        const filePath = path.join(os.tmpdir(), "code-ux-env-file-invalid.env");
        await expect(writeDockerEnvFile(filePath, [
            { key: "GEMINI_API_KEY", value: "line1\nline2" },
        ])).rejects.toThrow("Cannot pass multiline Docker env value");
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

});
