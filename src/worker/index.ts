#!/usr/bin/env node
import { loadWorkerConfig } from "./worker-config.js";
import { SprintOsWorker } from "./sprint-os-worker.js";
import { createLogger } from "../shared/logging/logger.js";

function installSignalHandlers(controller: AbortController): void {
  const handleSignal = (signalName: NodeJS.Signals) => {
    console.error(`[sprint-os-worker] Received ${signalName}, shutting down`);
    controller.abort();
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
}

export async function main(args: string[] = process.argv): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Sprint OS Worker");
    console.log("");
    console.log("Usage: sprint-os-worker [options]");
    console.log("");
    console.log("Options:");
    console.log("  --connection-key VALUE         Stable connection key for this worker");
    console.log("  --display-name VALUE           Human-readable worker name");
    console.log("  --project-id VALUE             Restrict claims to a single project");
    console.log("  --sprint-id VALUE              Restrict claims to a single sprint");
    console.log("  --server-url VALUE             Use a remote Sprint OS MCP HTTP endpoint as the worker control plane");
    console.log("  --auth-token VALUE             Bearer token for remote MCP HTTP authentication");
    console.log("  --dispatch-poll-interval-ms N  Idle poll interval in milliseconds");
    console.log("  --session-poll-interval-ms N   Session heartbeat poll interval in milliseconds");
    console.log("  --server-command VALUE         Override the local worker-host Sprint OS server command");
    console.log("  --server-arg VALUE             Repeatable arg passed to the local worker-host server");
    console.log("  --server-cwd VALUE             Optional working directory for the local worker-host server");
    console.log("  --help, -h                     Show this help message");
    return;
  }

  const config = loadWorkerConfig(args);
  const controller = new AbortController();
  installSignalHandlers(controller);

  const logger = createLogger({
    bindings: { service: "sprint-os-worker", component: "worker" },
  });

  const worker = new SprintOsWorker(config, logger);
  await worker.run(controller.signal);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("[sprint-os-worker] Unhandled error", error);
    process.exit(1);
  });
}
