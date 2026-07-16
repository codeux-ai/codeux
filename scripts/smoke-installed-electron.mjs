import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.resolve(
  process.env.CODE_UX_ELECTRON_ARTIFACT_DIR || path.join(projectRoot, "release", "electron"),
);
const timeoutMs = Number.parseInt(process.env.CODE_UX_ELECTRON_SMOKE_TIMEOUT_MS || "120000", 10);
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const MAC_TERMINATION_GRACE_MS = 5_000;

function runResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function run(command, args, options = {}) {
  const result = runResult(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return result;
}

async function findArtifact(extension) {
  const entries = await readdir(artifactDirectory, { withFileTypes: true });
  const versionMarker = `-${packageJson.version}-`;
  const artifact = entries
    .filter((entry) => (
      entry.isFile()
      && entry.name.includes(versionMarker)
      && entry.name.endsWith(extension)
    ))
    .map((entry) => path.join(artifactDirectory, entry.name))
    .sort()[0];
  if (!artifact) {
    throw new Error(
      `No Electron ${packageJson.version} ${extension} artifact found in ${artifactDirectory}.`,
    );
  }
  return artifact;
}

async function installLinuxCandidate() {
  const deb = await findArtifact(".deb");
  run("sudo", ["apt-get", "install", "--no-install-recommends", "-y", deb]);
  const executable = path.join("/opt", "Code UX", "codeux");
  await access(executable);
  return { command: "xvfb-run", args: ["-a", executable] };
}

async function installWindowsCandidate(temporaryRoot) {
  const installer = await findArtifact(".exe");
  const installDirectory = path.join(temporaryRoot, "installed", "Code UX");
  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(installDirectory, { recursive: true });
  // NSIS requires /D= to be the final, completely unquoted command-line segment even when the
  // destination contains spaces. Node otherwise quotes that argument on Windows and the generated
  // installer can terminate before extracting the application.
  // Force the current-user mode used by the shipped installer and keep the smoke isolated under
  // its temporary root. The custom NSIS beta page explicitly aborts in silent mode, so the
  // release probe never initializes interactive nsDialogs while no desktop is attached.
  const result = runResult(installer, ["/S", "/currentuser", `/D=${installDirectory}`], {
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) {
    const normalizedStatus = typeof result.status === "number"
      ? `0x${(result.status >>> 0).toString(16).toUpperCase().padStart(8, "0")}`
      : null;
    throw new Error(
      `${installer} failed during silent install with status `
      + `${normalizedStatus ?? result.status ?? "unknown"}.`,
    );
  }
  const executable = path.join(installDirectory, "Code UX.exe");
  await access(executable);
  return { command: executable, args: [] };
}

async function installMacCandidate(temporaryRoot) {
  const dmg = await findArtifact(".dmg");
  const mountDirectory = path.join(temporaryRoot, "mounted");
  const installDirectory = path.join(temporaryRoot, "Applications");
  await mkdir(mountDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });
  // Electron Builder embeds the project license in the DMG. hdiutil writes that agreement to the
  // terminal and cancels on EOF, so the non-interactive release runner must accept it explicitly.
  run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountDirectory, dmg], {
    input: "Y\n",
    stdio: ["pipe", "inherit", "inherit"],
  });
  try {
    const mountedEntries = await readdir(mountDirectory, { withFileTypes: true });
    const appEntry = mountedEntries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
    if (!appEntry) {
      throw new Error(`No macOS app bundle found in ${dmg}.`);
    }
    const installedApp = path.join(installDirectory, appEntry.name);
    run("ditto", [path.join(mountDirectory, appEntry.name), installedApp]);
    const executable = path.join(installedApp, "Contents", "MacOS", "Code UX");
    await access(executable);
    return { command: executable, args: [] };
  } finally {
    run("hdiutil", ["detach", mountDirectory]);
  }
}

async function reserveDashboardPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) {
    throw new Error("Unable to reserve a dashboard port for the Electron startup smoke test.");
  }
  return port;
}

function appendBounded(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length <= 65_536 ? combined : combined.slice(-65_536);
}

async function waitForExit(exitPromise, waitMs) {
  return await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
}

async function terminateValidatedMacProbe(child, exitPromise) {
  const naturalExit = await waitForExit(exitPromise, 250);
  if (naturalExit) {
    return { exit: naturalExit, termination: "natural" };
  }

  if (!child.kill("SIGTERM")) {
    const racedExit = await waitForExit(exitPromise, 250);
    if (racedExit) {
      return { exit: racedExit, termination: "natural" };
    }
    throw new Error("Unable to terminate the validated macOS Electron startup probe.");
  }
  const gracefulExit = await waitForExit(exitPromise, MAC_TERMINATION_GRACE_MS);
  if (gracefulExit) {
    return { exit: gracefulExit, termination: "SIGTERM" };
  }

  if (!child.kill("SIGKILL")) {
    throw new Error("Validated macOS Electron startup probe ignored SIGTERM and could not be force-killed.");
  }
  const forcedExit = await waitForExit(exitPromise, MAC_TERMINATION_GRACE_MS);
  if (!forcedExit) {
    throw new Error("Validated macOS Electron startup probe did not report exit after SIGKILL.");
  }
  return { exit: forcedExit, termination: "SIGKILL" };
}

async function waitForInstalledApp(launch, temporaryRoot) {
  const markerPath = path.join(temporaryRoot, "startup-ready.json");
  const isolatedHome = path.join(temporaryRoot, "home");
  const appData = path.join(isolatedHome, "AppData", "Roaming");
  const localAppData = path.join(isolatedHome, "AppData", "Local");
  const dashboardPort = await reserveDashboardPort();
  await Promise.all([
    mkdir(isolatedHome, { recursive: true }),
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
  ]);

  const child = spawn(launch.command, launch.args, {
    cwd: isolatedHome,
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      DASHBOARD_PORT: String(dashboardPort),
      MCP_HTTP_ENABLED: "false",
      CODE_UX_DISABLE_MCP_STDIO: "1",
      CODE_UX_ELECTRON_STARTUP_SMOKE_FILE: markerPath,
      ...(process.platform === "darwin"
        ? {}
        : { CODE_UX_ELECTRON_STARTUP_SMOKE_EXIT: "1" }),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });

  let exitResult = null;
  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      exitResult = { code: null, signal: null, error };
      resolve(exitResult);
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal, error: null };
      resolve(exitResult);
    });
  });

  const deadline = Date.now() + timeoutMs;
  let marker = null;
  while (Date.now() < deadline) {
    try {
      marker = JSON.parse(await readFile(markerPath, "utf8"));
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (exitResult) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!marker) {
    child.kill();
    throw new Error(
      `Installed Electron app did not become renderer-ready within ${timeoutMs}ms. `
      + `Exit: ${JSON.stringify(exitResult)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  if (
    marker.schemaVersion !== 1
    || marker.packaged !== true
    || marker.version !== packageJson.version
    || marker.platform !== process.platform
    || new URL(marker.rendererUrl).origin !== marker.dashboardOrigin
  ) {
    child.kill();
    throw new Error(`Installed Electron app returned an invalid startup marker: ${JSON.stringify(marker)}`);
  }

  if (process.platform === "darwin") {
    const stopped = await terminateValidatedMacProbe(child, exitPromise);
    const cleanNaturalExit = stopped.termination === "natural"
      && !stopped.exit.error
      && stopped.exit.code === 0;
    const harnessTerminated = stopped.termination !== "natural"
      && !stopped.exit.error
      && (
        stopped.exit.code === 0
        || (stopped.exit.code === null && stopped.exit.signal === stopped.termination)
      );
    if (!cleanNaturalExit && !harnessTerminated) {
      throw new Error(
        `Installed macOS Electron app became ready but probe termination was invalid: ${JSON.stringify(stopped)}\n`
        + `stdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    console.log(
      `Installed Electron ${marker.version} became renderer-ready on ${marker.platform}/${marker.arch} `
      + `at ${marker.dashboardOrigin}; the validated macOS probe was stopped by ${stopped.termination}.`,
    );
    return;
  }

  const exit = await waitForExit(exitPromise, 30_000);
  if (!exit || exit.error || exit.code !== 0) {
    child.kill();
    throw new Error(
      `Installed Electron app became ready but did not exit cleanly: ${JSON.stringify(exit)}\n`
      + `stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  console.log(
    `Installed Electron ${marker.version} became renderer-ready on ${marker.platform}/${marker.arch} `
    + `at ${marker.dashboardOrigin} and exited cleanly.`,
  );
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "code-ux-electron-install-smoke-"));
try {
  const launch = process.platform === "linux"
    ? await installLinuxCandidate()
    : process.platform === "win32"
      ? await installWindowsCandidate(temporaryRoot)
      : process.platform === "darwin"
        ? await installMacCandidate(temporaryRoot)
        : null;
  if (!launch) {
    throw new Error(`Unsupported Electron startup smoke platform: ${process.platform}`);
  }
  await waitForInstalledApp(launch, temporaryRoot);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
}
