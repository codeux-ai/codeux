#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keepTemp = process.env.CODE_UX_KEEP_RELEASE_INSTALL_TEMP === "1";
const skipBuild = process.env.CODE_UX_SKIP_RELEASE_INSTALL_BUILD === "1";
const tempRoot = await mkdtemp(path.join(tmpdir(), "codeux-release-install-"));
const packDir = path.join(tempRoot, "pack");
const installDir = path.join(tempRoot, "install");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const onnxRuntimeInstallMode = "skip";
const ALLOWED_PACKAGED_CODE_UX_FILES = new Set([
  ".code-ux/agents/planning_agent.md",
  ".code-ux/agents/project_manager.md",
  ".code-ux/agents/project_setup_agent.md",
  ".code-ux/agents/quality_assurance_agent.md",
  ".code-ux/agents/worker.md",
  ".code-ux/container/setup.sh",
  ".code-ux/embeddings/codeux-internaldocs.bge-small-en-v1.5.json",
  ".code-ux/nodes/README.md",
  ".code-ux/quicksprints/templates/qs-code-quality.md",
  ".code-ux/quicksprints/templates/qs-create-desktop-app.md",
  ".code-ux/quicksprints/templates/qs-create-game.md",
  ".code-ux/quicksprints/templates/qs-create-online-shop.md",
  ".code-ux/quicksprints/templates/qs-create-portfolio.md",
  ".code-ux/quicksprints/templates/qs-create-web-app.md",
  ".code-ux/quicksprints/templates/qs-security.md",
  ".code-ux/quicksprints/templates/qs-ui-a11y.md",
  ".code-ux/quicksprints/templates/qs-ui-design.md",
  ".code-ux/quicksprints/templates/qs-ui-interactions.md",
  ".code-ux/quicksprints/templates/qs-ui-responsive.md",
]);

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

function installedPackagePath(...parts) {
  return path.join(installDir, "node_modules", "@codeuxai", "codeux", ...parts);
}

async function assertPackageFileAllowlist() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const packageFileEntries = Array.isArray(packageJson?.files) ? packageJson.files : [];
  const configuredCodeUxFiles = packageFileEntries
    .filter((filePath) => typeof filePath === "string" && filePath.startsWith(".code-ux"));
  const missingBundledFiles = [...ALLOWED_PACKAGED_CODE_UX_FILES]
    .filter((filePath) => !configuredCodeUxFiles.includes(filePath));
  const broadOrUnexpectedEntries = configuredCodeUxFiles
    .filter((filePath) => !ALLOWED_PACKAGED_CODE_UX_FILES.has(filePath));

  if (missingBundledFiles.length > 0 || broadOrUnexpectedEntries.length > 0) {
    throw new Error([
      "package.json must use the explicit bundled .code-ux file allowlist.",
      ...missingBundledFiles.map((filePath) => `Missing package allowlist entry: ${filePath}`),
      ...broadOrUnexpectedEntries.map((filePath) => `Broad or unexpected package entry: ${filePath}`),
    ].join("\n"));
  }
}

function requireExistingBuildArtifacts() {
  const requiredPaths = [
    path.join(projectRoot, "dist", "index.js"),
    path.join(projectRoot, "dist", "worker", "index.js"),
    path.join(projectRoot, "dashboard", "dist"),
  ];
  const missingPaths = requiredPaths.filter((candidate) => !existsSync(candidate));

  if (missingPaths.length > 0) {
    throw new Error([
      "CODE_UX_SKIP_RELEASE_INSTALL_BUILD=1 was set, but required build artifacts are missing.",
      ...missingPaths.map((candidate) => `Missing: ${candidate}`),
      "Run pnpm run build first, or unset CODE_UX_SKIP_RELEASE_INSTALL_BUILD.",
    ].join("\n"));
  }
}

async function resolveInstalledBin(binName) {
  const binShimCandidates = process.platform === "win32"
    ? [
        path.join(installDir, "node_modules", ".bin", `${binName}.cmd`),
        path.join(installDir, "node_modules", ".bin", binName),
      ]
    : [
        path.join(installDir, "node_modules", ".bin", binName),
      ];
  const binShim = binShimCandidates.find((candidate) => existsSync(candidate));
  if (!binShim) {
    throw new Error(`Installed package did not create a local ${binName} bin shim in node_modules/.bin.`);
  }

  const packageJsonPath = installedPackagePath("package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const bin = packageJson?.bin;
  const relativeBinPath = typeof bin === "string" ? bin : bin?.[binName];
  if (typeof relativeBinPath !== "string" || relativeBinPath.length === 0) {
    throw new Error(`Installed package does not declare a ${binName} bin entry.`);
  }

  const binPath = installedPackagePath(relativeBinPath);
  if (!existsSync(binPath)) {
    throw new Error(`Installed ${binName} bin target is missing: ${binPath}`);
  }

  return { command: process.execPath, args: [binPath], displayCommand: binShim };
}

async function runStep(label, command, args, options = {}) {
  const invocation = resolveWindowsPackageManager(command, args);
  const displayCommand = options.displayCommand ?? invocation.command;
  const displayArgs = options.displayArgs ?? invocation.args;

  console.log(`\n==> ${label}`);
  console.log(`$ ${[displayCommand, ...displayArgs].join(" ")}`);

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
      `Command: ${[displayCommand, ...displayArgs].join(" ")}`,
      `Working directory: ${options.cwd ?? projectRoot}`,
      stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : undefined,
      stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : undefined,
    ].filter(Boolean);
    throw new Error(detail.join("\n\n"));
  }

  return { stdout, stderr };
}

async function runInstalledBinStep(label, binName, args, options = {}) {
  const invocation = await resolveInstalledBin(binName);

  return runStep(label, invocation.command, [...invocation.args, ...args], {
    ...options,
    displayCommand: invocation.displayCommand,
    displayArgs: args,
  });
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
    const packEntry = packed?.[0];
    const filename = packEntry?.filename;
    if (typeof filename !== "string" || filename.length === 0) {
      throw new Error("npm pack JSON did not include a tarball filename.");
    }

    const packedFilePaths = new Set(
      Array.isArray(packEntry?.files)
        ? packEntry.files
          .map((file) => file?.path)
          .filter((filePath) => typeof filePath === "string")
        : [],
    );
    const missingBundledFiles = [...ALLOWED_PACKAGED_CODE_UX_FILES]
      .filter((filePath) => !packedFilePaths.has(filePath));
    const unexpectedCodeUxFiles = [...packedFilePaths]
      .filter((filePath) => filePath.startsWith(".code-ux/") && !ALLOWED_PACKAGED_CODE_UX_FILES.has(filePath));
    const runtimeArtifacts = [...packedFilePaths].filter((filePath) => (
      /(^|\/)debug\.log$/.test(filePath)
      || /(^|\/)data\.db(?:-shm|-wal)?$/.test(filePath)
      || /(^|\/)\.env(?:\.|$)/.test(filePath)
    ));

    if (missingBundledFiles.length > 0 || unexpectedCodeUxFiles.length > 0 || runtimeArtifacts.length > 0) {
      throw new Error([
        "npm package contents failed the runtime-artifact allowlist.",
        ...missingBundledFiles.map((filePath) => `Missing bundled file: ${filePath}`),
        ...unexpectedCodeUxFiles.map((filePath) => `Unexpected .code-ux file: ${filePath}`),
        ...runtimeArtifacts.map((filePath) => `Forbidden runtime artifact: ${filePath}`),
      ].join("\n"));
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

  if (skipBuild) {
    console.log("\n==> Reuse existing build artifacts");
    requireExistingBuildArtifacts();
    console.log("Build artifacts are present; skipping pnpm run build.");
  } else {
    await runStep("Build project", pnpmCommand, ["run", "build"]);
  }

  await mkdir(packDir, { recursive: true });
  await prepareInstallDir();
  await assertPackageFileAllowlist();

  const tarballPath = await npmPack();
  console.log(`Packed tarball: ${tarballPath}`);

  await runStep("Install packed package", npmCommand, [
    "install",
    "--no-audit",
    "--no-fund",
    tarballPath,
  ], {
    cwd: installDir,
    env: { ONNXRUNTIME_NODE_INSTALL: onnxRuntimeInstallMode },
  });

  await runStep(
    "Load installed ONNX CPU runtime",
    process.execPath,
    ["--input-type=module", "--eval", "await import('onnxruntime-node')"],
    { cwd: installDir },
  );

  await runInstalledBinStep("Run installed codeux --help", "codeux", ["--help"], { cwd: installDir });

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
