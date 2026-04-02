#!/bin/bash
# Check if findLatestPostCodingStageSignal is correctly named in live-stats.ts
grep "function findLatestPostCodingStageSignal" dashboard/src/v2/lib/live-stats.ts
grep "function findCodingCompletedAt" dashboard/src/v2/lib/live-stats.ts
grep "function resolveDispatchTerminalAt" dashboard/src/v2/lib/live-stats.ts
