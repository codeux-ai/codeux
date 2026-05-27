import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(projectRoot, ".cache", "electron-runtime");

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });

writeFileSync(
  path.join(runtimeDir, "package.json"),
  JSON.stringify({
    name: "code-ux-electron-runtime",
    version: packageJson.version,
    private: true,
    packageManager: packageJson.packageManager,
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  }, null, 2),
);

writeFileSync(path.join(runtimeDir, ".npmrc"), "shamefully-hoist=true\n");
copyFileSync(path.join(projectRoot, "pnpm-lock.yaml"), path.join(runtimeDir, "pnpm-lock.yaml"));
copyFileSync(path.join(projectRoot, "pnpm-workspace.yaml"), path.join(runtimeDir, "pnpm-workspace.yaml"));

execFileSync(
  "pnpm",
  ["install", "--prod", "--frozen-lockfile"],
  {
    cwd: runtimeDir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);
