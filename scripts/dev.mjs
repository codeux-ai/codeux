#!/usr/bin/env node
// Dev runtime: server (from source, via tsnode-register) + dashboard bundler
// in watch mode, run side by side.
//
// The dashboard is served from the built dashboard/dist bundle (see
// src/server/dashboard-middleware.ts), not transpiled on the fly, so editing
// dashboard/src alone does nothing in the browser until dist is rebuilt.
// Running `vite build --watch` alongside the server keeps dist current on
// every save — refresh the browser tab to pick up a finished rebuild.
//
// Ctrl+C (or any child exiting) tears both processes down together.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBin(pkg, binName = pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin } = require(pkgJsonPath);
  const rel = typeof bin === "string" ? bin : bin[binName];
  return path.resolve(path.dirname(pkgJsonPath), rel);
}

const viteBin = resolveBin("vite");
const tsnodeRegister = path.join(root, "scripts", "tsnode-register.mjs");
const serverEntry = path.join(root, "src", "index.ts");

/** @type {{ name: string, args: string[] }[]} */
const tasks = [
  { name: "server", args: [`--import`, tsnodeRegister, serverEntry] },
  { name: "vite", args: [viteBin, "build", "--watch"] },
];

const children = [];
let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

function run({ name, args }) {
  const isServer = name === "server";
  const child = spawn(isServer ? process.execPath : process.execPath, args, {
    cwd: root,
    // `vite build` defaults NODE_ENV to production even in watch mode. Mark the
    // watched dashboard bundle as development so import.meta.env.DEV accurately
    // reflects that it was launched through `pnpm run dev`.
    env: isServer ? process.env : { ...process.env, NODE_ENV: "development" },
  });
  children.push(child);

  const prefix = (chunk, stream) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) stream.write(`[${name}] ${line}\n`);
    }
  };
  child.stdout.on("data", (c) => prefix(c, process.stdout));
  child.stderr.on("data", (c) => prefix(c, process.stderr));
  child.on("close", (code) => {
    console.log(`[${name}] exited (code ${code ?? "unknown"})`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

for (const task of tasks) run(task);
