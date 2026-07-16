import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitElectronStartupSmoke,
  writeElectronStartupSmoke,
} from "../../../src/electron/startup-smoke.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("Electron startup smoke marker", () => {
  it("atomically records packaged renderer readiness", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "code-ux-electron-smoke-"));
    temporaryDirectories.push(directory);
    const markerPath = path.join(directory, "nested", "ready.json");

    const record = await writeElectronStartupSmoke(markerPath, {
      version: "0.9.10",
      platform: process.platform,
      arch: "x64",
      packaged: true,
      dashboardOrigin: "http://127.0.0.1:4567",
      rendererUrl: "http://127.0.0.1:4567/",
      pid: 42,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });

    expect(record).toEqual(expect.objectContaining({
      schemaVersion: 1,
      version: "0.9.10",
      packaged: true,
      pid: 42,
      readyAt: "2026-07-15T12:00:00.000Z",
    }));
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toEqual(record);
  });

  it("rejects relative marker paths", async () => {
    await expect(writeElectronStartupSmoke("ready.json", {
      version: "0.9.10",
      platform: process.platform,
      arch: process.arch,
      packaged: true,
      dashboardOrigin: "http://127.0.0.1:4567",
      rendererUrl: "http://127.0.0.1:4567/",
    })).rejects.toThrow("must be absolute");
  });

  it("terminates the isolated readiness probe with code zero", () => {
    const exitProcess = vi.fn((_code: number): never => {
      throw new Error("process exited");
    });

    expect(() => exitElectronStartupSmoke(exitProcess)).toThrow("process exited");
    expect(exitProcess).toHaveBeenCalledOnce();
    expect(exitProcess).toHaveBeenCalledWith(0);
  });
});
