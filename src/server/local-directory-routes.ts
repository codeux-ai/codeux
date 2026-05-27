import type { Express } from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { LocalDirectoryBrowserResponse } from "../contracts/app-types.js";
import { asyncRoute, parseTrimmedString, toErrorResponse } from "./route-utils.js";
import { expandHomePath } from "../shared/config/home-path.js";

export function registerLocalDirectoryRoutes(router: Express): void {
  router.get("/api/local-directories", asyncRoute(async (req, res) => {
    try {
      const requestedPath = parseTrimmedString(req.query.path) || os.homedir();
      const resolvedPath = path.resolve(expandHomePath(requestedPath));
      const stat = await fs.stat(resolvedPath);

      if (!stat.isDirectory()) {
        res.status(400).json({ error: `Path is not a directory: ${resolvedPath}` });
        return;
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const rootPath = path.parse(resolvedPath).root;
      const response: LocalDirectoryBrowserResponse = {
        currentPath: resolvedPath,
        parentPath: resolvedPath === rootPath ? null : path.dirname(resolvedPath),
        rootPath,
        homePath: os.homedir(),
        directories,
      };

      res.json(response);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list directories"));
    }
  }));
}
