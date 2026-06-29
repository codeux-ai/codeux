#!/usr/bin/env node
// Parallel production build.
//
// The three build steps are fully independent:
//   - server tsc  -> emits dist/ (the node CLI)
//   - dashboard tsc -> typecheck only (--noEmit); vite does NOT typecheck
//   - vite build  -> bundles dashboard/dist
// Nothing here consumes another step's output, so we run them concurrently
// instead of chaining with `&&`. Bins are invoked through `node` directly so
// this stays cross-platform (no shell / .cmd resolution needed on Windows).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Resolve each CLI's entry via its package.json `bin` field — some packages
// (e.g. vite) don't expose their bin script through the `exports` map.
function resolveBin(pkg, binName = pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin } = require(pkgJsonPath);
  const rel = typeof bin === "string" ? bin : bin[binName];
  return path.resolve(path.dirname(pkgJsonPath), rel);
}

const tscBin = resolveBin("typescript", "tsc");
const viteBin = resolveBin("vite");

/** @type {{ name: string, args: string[] }[]} */
const tasks = [
  {
    name: "server",
    args: [tscBin, "--incremental", "--tsBuildInfoFile", ".cache/tsc/server-build.tsbuildinfo"],
  },
  {
    name: "dashboard",
    args: [
      tscBin,
      "-p",
      "dashboard/tsconfig.json",
      "--noEmit",
      "--incremental",
      "--tsBuildInfoFile",
      ".cache/tsc/dashboard.tsbuildinfo",
    ],
  },
  {
    name: "vite",
    args: [viteBin, "build"],
  },
];

function run({ name, args }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: process.env });
    const prefix = (chunk, stream) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) stream.write(`[${name}] ${line}\n`);
      }
    };
    child.stdout.on("data", (c) => prefix(c, process.stdout));
    child.stderr.on("data", (c) => prefix(c, process.stderr));
    child.on("close", (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${name}] ${code === 0 ? "done" : `FAILED (exit ${code})`} in ${secs}s`);
      resolve({ name, code: code ?? 1 });
    });
  });
}

const results = await Promise.all(tasks.map(run));
const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  console.error(`\nBuild failed: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
