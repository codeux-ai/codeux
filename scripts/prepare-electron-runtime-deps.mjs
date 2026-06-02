import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(projectRoot, ".cache", "electron-runtime");
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const fingerprintPath = path.join(runtimeDir, ".runtime-fingerprint");

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const lockfile = readFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "utf8");
const workspace = readFileSync(path.join(projectRoot, "pnpm-workspace.yaml"), "utf8");
const pruneVersion = 1;

const fingerprint = crypto
  .createHash("sha256")
  .update(JSON.stringify({
    packageManager: packageJson.packageManager,
    dependencies: packageJson.dependencies,
    pruneVersion,
  }))
  .update(lockfile)
  .update(workspace)
  .digest("hex");

if (existsSync(nodeModulesDir) && existsSync(fingerprintPath)) {
  const currentFingerprint = readFileSync(fingerprintPath, "utf8").trim();
  if (currentFingerprint === fingerprint) {
    console.log("Electron runtime dependencies are up to date.");
    process.exit(0);
  }
}

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

const removableFile = /^(?:readme|changelog|history)(?:\.[^.]+)?$/i;
const removableDirectory = /^(?:docs?|examples?|test|tests|__tests__|coverage|benchmarks?)$/i;
const removableExtension = /\.(?:map|md|markdown|d\.ts|tsbuildinfo)$/i;

function pruneTree(dir) {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === "@types" || removableDirectory.test(entry.name)) {
        rmSync(entryPath, { recursive: true, force: true });
        continue;
      }
      pruneTree(entryPath);
      try {
        if (readdirSync(entryPath).length === 0) {
          rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore directories removed by nested pruning.
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (/[\\/]?(?:licen[cs]e|copying|notice)(?:\.[^\\/]*)?$/i.test(entry.name)) {
      continue;
    }
    if (removableFile.test(entry.name) || removableExtension.test(entry.name)) {
      rmSync(entryPath, { force: true });
    }
  }
}

function countFiles(dir) {
  if (!existsSync(dir)) {
    return 0;
  }
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      count += countFiles(entryPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function directorySize(dir) {
  if (!existsSync(dir)) {
    return 0;
  }
  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      size += directorySize(entryPath);
    } else if (entry.isFile()) {
      size += statSync(entryPath).size;
    }
  }
  return size;
}

pruneTree(nodeModulesDir);
writeFileSync(fingerprintPath, `${fingerprint}\n`);

const fileCount = countFiles(nodeModulesDir);
const sizeMiB = (directorySize(nodeModulesDir) / 1024 / 1024).toFixed(1);
console.log(`Prepared Electron runtime dependencies: ${fileCount} files, ${sizeMiB} MiB.`);
