import express from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLocalDirectoryRoutes } from "../../../src/server/local-directory-routes.js";

const tempDirs: string[] = [];

beforeEach(() => {
  process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS = os.tmpdir();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  delete process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS;
});

const createApp = () => {
  const app = express();
  registerLocalDirectoryRoutes(app);
  return app;
};

describe("local directory routes", () => {
  it("lists child directories and parent navigation metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-directories-"));
    tempDirs.push(dir);
    await fs.mkdir(path.join(dir, "src"));
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "README.md"), "# test");

    const response = await request(createApp()).get("/api/local-directories").query({ path: dir });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currentPath: dir,
      parentPath: path.dirname(dir),
      rootPath: path.parse(dir).root,
      homePath: os.homedir(),
    });
    expect(response.body.directories).toEqual([
      { name: "docs", path: path.join(dir, "docs") },
      { name: "src", path: path.join(dir, "src") },
    ]);
  });

  it("allows access to home directory", async () => {
    const response = await request(createApp()).get("/api/local-directories").query({ path: os.homedir() });
    expect(response.status).toBe(200);
    expect(response.body.currentPath).toBe(os.homedir());
  });

  it("allows access to current working directory", async () => {
    const cwd = process.cwd();
    const response = await request(createApp()).get("/api/local-directories").query({ path: cwd });
    expect(response.status).toBe(200);
    expect(response.body.currentPath).toBe(cwd);
  });

  it("resolves parent traversal (..) into allowed roots", async () => {
    const cwd = process.cwd();
    const childDir = path.join(cwd, "src");
    const traversalPath = path.join(childDir, "..", "src");
    const response = await request(createApp()).get("/api/local-directories").query({ path: traversalPath });
    // Should be allowed and resolved correctly
    expect(response.status).toBe(200);
    expect(response.body.currentPath).toBe(childDir);
  });

  it("rejects path traversal outside allowed roots", async () => {
    const rootDir = path.parse(process.cwd()).root;
    // Assuming rootDir is not an allowed root
    const response = await request(createApp()).get("/api/local-directories").query({ path: rootDir });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Access denied");
  });

  it("rejects file paths with sanitized error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-directories-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "file.txt");
    await fs.writeFile(filePath, "not a directory");

    const response = await request(createApp()).get("/api/local-directories").query({ path: filePath });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Path is not a directory");
    expect(response.body.error).not.toContain(filePath); // Ensures the path is not leaked
  });

  it("rejects non-existent directories with sanitized error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-directories-"));
    tempDirs.push(dir);
    const nonExistentPath = path.join(dir, "does_not_exist");

    const response = await request(createApp()).get("/api/local-directories").query({ path: nonExistentPath });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Path does not exist");
    expect(response.body.error).not.toContain(nonExistentPath);
  });

  it("sorts directory output alphabetically", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-directories-"));
    tempDirs.push(dir);
    await fs.mkdir(path.join(dir, "Z_folder"));
    await fs.mkdir(path.join(dir, "a_folder"));
    await fs.mkdir(path.join(dir, "b_folder"));

    const response = await request(createApp()).get("/api/local-directories").query({ path: dir });

    expect(response.status).toBe(200);
    const directoryNames = response.body.directories.map((d: any) => d.name);
    expect(directoryNames).toEqual(["a_folder", "b_folder", "Z_folder"]);
  });
});