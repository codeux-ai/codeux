import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ElectronStartupSmokeRecord {
  schemaVersion: 1;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  dashboardOrigin: string;
  rendererUrl: string;
  pid: number;
  readyAt: string;
}

export interface ElectronStartupSmokeInput {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  dashboardOrigin: string;
  rendererUrl: string;
  pid?: number;
  now?: () => Date;
}

export async function writeElectronStartupSmoke(
  markerPath: string,
  input: ElectronStartupSmokeInput,
): Promise<ElectronStartupSmokeRecord> {
  if (!path.isAbsolute(markerPath)) {
    throw new Error("Electron startup smoke marker path must be absolute.");
  }

  const record: ElectronStartupSmokeRecord = {
    schemaVersion: 1,
    version: input.version,
    platform: input.platform,
    arch: input.arch,
    packaged: input.packaged,
    dashboardOrigin: input.dashboardOrigin,
    rendererUrl: input.rendererUrl,
    pid: input.pid ?? process.pid,
    readyAt: (input.now ?? (() => new Date()))().toISOString(),
  };
  const temporaryPath = `${markerPath}.${record.pid}.${Date.now()}.tmp`;

  await mkdir(path.dirname(markerPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, markerPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return record;
}
