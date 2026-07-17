#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

const inspectorUrl = process.argv[2];
const outputPath = process.argv[3] ?? "/tmp/codeux-sampling.heapprofile";
const durationMs = Number(process.argv[4] ?? 120_000);

if (!inspectorUrl?.startsWith("ws://")) {
  throw new Error("Usage: capture-node-heap-profile.mjs <ws-url> [output] [duration-ms]");
}

const socket = new WebSocket(inspectorUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(`${message.error.code}: ${message.error.message}`));
  } else {
    request.resolve(message.result);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

await send("Runtime.enable");
await send("HeapProfiler.enable");
await send("HeapProfiler.startSampling", {
  samplingInterval: 32_768,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});

const startedAt = Date.now();
let peakUsedSize = 0;
let peakTotalSize = 0;

while (Date.now() - startedAt < durationMs && socket.readyState === WebSocket.OPEN) {
  const usage = await send("Runtime.getHeapUsage");
  peakUsedSize = Math.max(peakUsedSize, usage.usedSize);
  peakTotalSize = Math.max(peakTotalSize, usage.totalSize);
  const profile = await send("HeapProfiler.getSamplingProfile");
  await writeFile(outputPath, JSON.stringify(profile.profile));
  process.stdout.write(`${new Date().toISOString()} heapUsed=${usage.usedSize} heapTotal=${usage.totalSize}\n`);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

if (socket.readyState === WebSocket.OPEN) {
  const profile = await send("HeapProfiler.stopSampling");
  await writeFile(outputPath, JSON.stringify(profile.profile));
  socket.close();
}

process.stdout.write(`profile=${outputPath} peakHeapUsed=${peakUsedSize} peakHeapTotal=${peakTotalSize}\n`);
