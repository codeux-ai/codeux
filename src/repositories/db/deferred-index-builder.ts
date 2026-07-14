import { Worker } from "node:worker_threads";
import type { DeferredIndexDefinition } from "./app-db-migrations.js";

export type DeferredIndexBuildStatus = "created" | "active" | "busy";

interface WorkerMessage {
  status: DeferredIndexBuildStatus;
  error?: string;
}

const WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { DatabaseSync } = require("node:sqlite");
  let db;
  try {
    db = new DatabaseSync(workerData.dbPath, { timeout: 250, enableForeignKeyConstraints: true });
    db.exec("PRAGMA busy_timeout = 250;");
    const active = db.prepare("SELECT 1 AS active FROM provider_invocations WHERE status = 'running' LIMIT 1").get();
    if (active && active.active === 1) {
      parentPort.postMessage({ status: "active" });
    } else {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (workerData.definition.replaceExisting) {
          db.exec("DROP INDEX IF EXISTS " + workerData.definition.name);
        }
        db.exec(workerData.definition.sql);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      parentPort.postMessage({ status: "created" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort.postMessage({ status: "busy", error: message });
  } finally {
    if (db) db.close();
  }
`;

/** Builds one non-unique index off the main Node.js thread. */
export function buildDeferredIndex(
  dbPath: string,
  definition: DeferredIndexDefinition,
  signal?: AbortSignal,
): Promise<DeferredIndexBuildStatus> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      execArgv: ["--no-warnings"],
      workerData: { dbPath, definition },
    });
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => {
      void worker.terminate();
      finish(() => resolve("busy"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: WorkerMessage) => {
      finish(() => {
        if (message.status === "busy" && message.error && !/busy|locked/iu.test(message.error)) {
          reject(new Error(message.error));
          return;
        }
        resolve(message.status);
      });
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`Deferred index worker exited with code ${code}`)));
      }
    });
    if (signal?.aborted) abort();
  });
}
