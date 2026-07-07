import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { registerFileBrowserRoutes } from "../../../src/server/file-browser-routes.js";

const createApp = (deps: Partial<DashboardDependencies>) => {
  const app = express();
  registerFileBrowserRoutes(app, deps as DashboardDependencies);
  return app;
};

describe("file browser routes", () => {
  it("passes normalized legitimate file paths to the runtime dependency", async () => {
    const readFileBrowserFile = vi.fn(async () => ({
      path: "src/index.ts",
      content: "export {};",
      encoding: "utf8",
      size: 10,
      truncated: false,
      binary: false,
      language: "typescript",
    }));

    const response = await request(createApp({ readFileBrowserFile }))
      .get("/api/file-browser/sessions/session-1/file")
      .query({ path: "./src/index.ts" });

    expect(response.status).toBe(200);
    expect(readFileBrowserFile).toHaveBeenCalledWith("session-1", "src/index.ts");
  });

  it.each([
    ["encoded traversal", "src/%2e%2e/package.json"],
    ["Windows-style traversal", "src\\..\\package.json"],
    ["Unix traversal", "../package.json"],
    ["encoded slash traversal", "src%2f..%2fpackage.json"],
    ["malformed percent encoding", "src/%E0%A4%A"],
    ["Unix absolute path", "/etc/passwd"],
    ["Windows absolute path", "C:\\Windows\\System32\\drivers\\etc\\hosts"],
  ])("rejects %s before reading a file", async (_label, hostilePath) => {
    const readFileBrowserFile = vi.fn();

    const response = await request(createApp({ readFileBrowserFile }))
      .get("/api/file-browser/sessions/session-1/file")
      .query({ path: hostilePath });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/^Invalid file path:/);
    expect(readFileBrowserFile).not.toHaveBeenCalled();
  });

  it.each([
    ["encoded traversal", "src/%2e%2e/package.json"],
    ["Windows-style traversal", "src\\..\\package.json"],
    ["Unix traversal", "../package.json"],
    ["encoded slash traversal", "src%2f..%2fpackage.json"],
    ["malformed percent encoding", "src/%E0%A4%A"],
    ["Unix absolute path", "/etc/passwd"],
    ["Windows absolute path", "C:\\Windows\\System32\\drivers\\etc\\hosts"],
  ])("rejects %s before reading a diff", async (_label, hostilePath) => {
    const getFileBrowserDiff = vi.fn();

    const response = await request(createApp({ getFileBrowserDiff }))
      .get("/api/file-browser/sessions/session-1/diff")
      .query({ path: hostilePath });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/^Invalid file path:/);
    expect(getFileBrowserDiff).not.toHaveBeenCalled();
  });
});
