import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const benchmarkRoot = path.join(projectRoot, "release", "electron-benchmark");
const modes = ["normal", "store"];

function run(command, args, env = {}) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env,
    },
  });
  const durationMs = Math.round(performance.now() - startedAt);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return durationMs;
}

function listArtifacts(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const sizeBytes = statSync(filePath).size;
      return {
        name: entry.name,
        sizeBytes,
        sizeMiB: Number((sizeBytes / 1024 / 1024).toFixed(1)),
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

rmSync(benchmarkRoot, { recursive: true, force: true });
mkdirSync(benchmarkRoot, { recursive: true });

const buildMs = run("pnpm", ["run", "build"]);
const prepareDepsMs = run("pnpm", ["run", "electron:prepare-deps"]);
const results = [];

for (const mode of modes) {
  const outputDir = path.join(benchmarkRoot, mode);
  mkdirSync(outputDir, { recursive: true });
  const packageMs = run("electron-builder", ["--config", "electron-builder.config.cjs", "--win"], {
    CODE_UX_ELECTRON_COMPRESSION: mode,
    CODE_UX_ELECTRON_OUTPUT: outputDir,
  });
  results.push({
    compression: mode,
    packageMs,
    packageSeconds: Number((packageMs / 1000).toFixed(1)),
    artifacts: listArtifacts(outputDir),
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  buildMs,
  buildSeconds: Number((buildMs / 1000).toFixed(1)),
  prepareDepsMs,
  prepareDepsSeconds: Number((prepareDepsMs / 1000).toFixed(1)),
  results,
};

writeFileSync(path.join(benchmarkRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
