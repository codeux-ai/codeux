#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keepTemp = process.env.CODE_UX_KEEP_RELEASE_INSTALL_TEMP === "1";
const tempRoot = await mkdtemp(path.join(tmpdir(), "codeux-release-install-"));
const packDir = path.join(tempRoot, "pack");
const installDir = path.join(tempRoot, "install");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function existingPath(...parts) {
  const candidate = path.resolve(...parts);
  return existsSync(candidate) ? candidate : null;
}

function resolveWindowsPackageManager(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  if (command === "npm.cmd") {
    const npmCliPath = existingPath(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (npmCliPath) {
      return { command: process.execPath, args: [npmCliPath, ...args] };
    }
  }

  if (command === "pnpm.cmd" && process.env.PNPM_HOME) {
    const pnpmCliPath = existingPath(process.env.PNPM_HOME, "..", "pnpm", "bin", "pnpm.cjs");
    if (pnpmCliPath) {
      return { command: process.execPath, args: [pnpmCliPath, ...args] };
    }
  }

  return { command, args };
}

async function runStep(label, command, args, options = {}) {
  const invocation = resolveWindowsPackageManager(command, args);

  console.log(`\n==> ${label}`);
  console.log(`$ ${[invocation.command, ...invocation.args].join(" ")}`);

  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd ?? projectRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: false,
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    const detail = [
      `${label} failed with exit code ${exitCode}.`,
      `Command: ${[invocation.command, ...invocation.args].join(" ")}`,
      `Working directory: ${options.cwd ?? projectRoot}`,
      stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : undefined,
      stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : undefined,
    ].filter(Boolean);
    throw new Error(detail.join("\n\n"));
  }

  return { stdout, stderr };
}

async function npmPack() {
  const { stdout } = await runStep("Create npm package tarball", npmCommand, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    packDir,
  ]);

  try {
    const packed = JSON.parse(stdout);
    const filename = packed?.[0]?.filename;
    if (typeof filename !== "string" || filename.length === 0) {
      throw new Error("npm pack JSON did not include a tarball filename.");
    }
    return path.join(packDir, filename);
  } catch (error) {
    throw new Error(`Unable to parse npm pack output as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function prepareInstallDir() {
  await mkdir(installDir, { recursive: true });
  await writeFile(
    path.join(installDir, "package.json"),
    `${JSON.stringify({ name: "codeux-release-install-check", private: true }, null, 2)}\n`,
  );
}

try {
  console.log(`Using temporary release install workspace: ${tempRoot}`);

  await runStep("Build project", pnpmCommand, ["run", "build"]);

  await mkdir(packDir, { recursive: true });
  await prepareInstallDir();

  const tarballPath = await npmPack();
  console.log(`Packed tarball: ${tarballPath}`);

  await runStep("Install packed package", npmCommand, [
    "install",
    "--no-audit",
    "--no-fund",
    tarballPath,
  ], { cwd: installDir });

  await runStep("Run installed codeux --help", npmCommand, [
    "exec",
    "--",
    "codeux",
    "--help",
  ], { cwd: installDir });

  console.log("\nRelease install verification passed.");
} catch (error) {
  console.error("\nRelease install verification failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (keepTemp) {
    console.log(`Keeping temporary release install workspace: ${tempRoot}`);
  } else {
    await rm(tempRoot, { force: true, recursive: true });
  }
}
