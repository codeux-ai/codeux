#!/usr/bin/env node
/**
 * Process supervisor for the Code UX server.
 *
 * The server embeds Node's experimental `node:sqlite` binding. Native bindings can, under
 * rare conditions, abort the whole process with a signal such as SIGSEGV (exit code 139) —
 * something no `try/catch` in JavaScript can intercept. When that happens while the server
 * is run directly (`node dist/index.js`), the process simply dies and the dashboard becomes
 * unreachable until it is manually restarted (a page refresh cannot help because nothing is
 * listening). This supervisor turns a fatal crash into an automatic restart and captures a
 * Node diagnostic report containing the native stack so the underlying fault can be fixed.
 *
 * Usage:
 *   node scripts/supervisor.mjs <node-args-and-entrypoint...>
 *
 * Set CODEUX_NO_SUPERVISOR=1 to run the target once without auto-restart (e.g. in CI).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const childArgs = process.argv.slice(2);
if (childArgs.length === 0) {
  console.error("[supervisor] no command provided");
  process.exit(1);
}

const reportDir = process.env.CODEUX_REPORT_DIR || join(homedir(), ".code-ux", "reports");
try {
  mkdirSync(reportDir, { recursive: true });
} catch {
  // best-effort; Node will fall back to cwd if the directory is unusable
}

// Node flags that make a future native crash diagnosable: write a JSON report (including the
// native stack) on a fatal error and on the signals that typically accompany a hard crash.
const diagnosticNodeArgs = [
  "--report-on-fatalerror",
  "--report-on-signal",
  "--report-uncaught-exception",
  `--report-directory=${reportDir}`,
];

// Crash-loop guard: if the child keeps dying immediately, stop trying rather than spin forever.
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_IN_WINDOW = 10;
const crashTimestamps = [];

let shuttingDown = false;
let child = null;

function startChild() {
  child = spawn(process.execPath, [...diagnosticNodeArgs, ...childArgs], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }

    // Clean, intentional exit — mirror it and stop.
    if (signal === null && (code === 0 || code === null)) {
      process.exit(code ?? 0);
      return;
    }

    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    const now = Date.now();
    crashTimestamps.push(now);
    while (crashTimestamps.length > 0 && now - crashTimestamps[0] > CRASH_WINDOW_MS) {
      crashTimestamps.shift();
    }

    if (crashTimestamps.length >= MAX_CRASHES_IN_WINDOW) {
      console.error(
        `[supervisor] child crashed ${crashTimestamps.length} times within ${CRASH_WINDOW_MS / 1000}s ` +
          `(last: ${reason}). Giving up to avoid a crash loop. See diagnostic reports in ${reportDir}.`,
      );
      process.exit(code ?? 1);
      return;
    }

    const backoffMs = Math.min(5_000, 250 * 2 ** (crashTimestamps.length - 1));
    console.error(
      `[supervisor] child exited unexpectedly (${reason}). Restarting in ${backoffMs}ms ` +
        `(${crashTimestamps.length}/${MAX_CRASHES_IN_WINDOW} crashes in window). ` +
        `Diagnostic reports: ${reportDir}`,
    );
    setTimeout(() => {
      if (!shuttingDown) {
        startChild();
      }
    }, backoffMs);
  });

  child.on("error", (error) => {
    console.error(`[supervisor] failed to spawn child: ${error.message}`);
  });
}

function forwardSignal(signal) {
  shuttingDown = true;
  if (child) {
    child.kill(signal);
  } else {
    process.exit(0);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => forwardSignal(signal));
}

if (process.env.CODEUX_NO_SUPERVISOR === "1") {
  // Bypass supervision but keep the diagnostics so crashes are still captured.
  shuttingDown = true;
}

startChild();
