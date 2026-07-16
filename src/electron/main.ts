import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, session, shell } from "electron";
import * as fs from "fs";
import Module from "module";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  classifyNavigationTarget,
  isDashboardRuntimeDataUrl,
  normalizeZoomFactor,
  resolveDirectoryPickerDefaultPath,
  shouldAddRuntimeNoCacheRequestHeaders,
  shouldAllowPermissionCheck,
  shouldAllowPermissionRequest,
} from "./dashboard-network-policy.js";
import { openCodeUxUpdatesPage, toggleWindowMaximized } from "./window-controls.js";
import { createDebouncedSaver, loadWindowState, saveWindowState } from "./window-state.js";
import { ElectronCredentialKeyPersistence } from "./credential-key-persistence.js";
import { ElectronSafeStorageKeyProvider } from "../infrastructure/security/electron-safe-storage-key-provider.js";
import { setProcessCredentialKeyProvider } from "../services/credentials/key-provider-registry.js";
import { writeElectronStartupSmoke } from "./startup-smoke.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const preloadPath = path.join(__dirname, "preload.cjs");

let mainWindow: BrowserWindow | null = null;
let server: { run(): Promise<void>; close(): Promise<void>; getDashboardRuntimePort(): number } | null = null;
let dashboardOrigin: string | null = null;
let isQuitting = false;
let dashboardSessionConfigured = false;

const dashboardApiUrlFilter = {
  urls: [
    "http://127.0.0.1:*/*",
    "http://localhost:*/*",
  ],
};

const isolatedRendererWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: preloadPath,
} satisfies Electron.BrowserWindowConstructorOptions["webPreferences"];

const isWindowsPackagedApp = process.platform === "win32" && app.isPackaged;

if (isWindowsPackagedApp) {
  // Keep Windows packaged builds near Chromium's default WebGL headroom. The
  // dashboard can legitimately have a persistent animated background plus
  // route-scoped avatar/chart canvases during navigation, and a cap of 4 makes
  // still-GC-pending contexts compete with active surfaces in long sessions.
  app.commandLine.appendSwitch("max-active-webgl-contexts", "16");
  app.commandLine.appendSwitch("force-gpu-mem-available-mb", "512");
}

const isWsl = Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP);

if (isWsl) {
  // Under WSLg the default X11 (Xwayland) path has no reliable vsync, so Chromium produces frames
  // unbounded and the renderer/compositor busy-spin and peg the CPU. Preferring the native Wayland
  // compositor (when present) restores proper frame pacing; "auto" falls back to X11 if Wayland is
  // unavailable, so this is safe.
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

if (process.env.WSL_DISTRO_NAME && process.env.CODE_UX_WSL_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

async function configureDashboardNetworkSession(): Promise<void> {
  if (dashboardSessionConfigured) {
    return;
  }
  dashboardSessionConfigured = true;

  const desktopSession = session.defaultSession;
  await desktopSession.clearCache().catch(() => undefined);

  desktopSession.webRequest.onBeforeSendHeaders(dashboardApiUrlFilter, (details, callback) => {
    if (
      !isDashboardRuntimeDataUrl(details.url, dashboardOrigin)
      || !shouldAddRuntimeNoCacheRequestHeaders(details.method)
    ) {
      callback({});
      return;
    }

    callback({
      requestHeaders: {
        ...details.requestHeaders,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
  });

  desktopSession.webRequest.onHeadersReceived(dashboardApiUrlFilter, (details, callback) => {
    if (!isDashboardRuntimeDataUrl(details.url, dashboardOrigin)) {
      callback({});
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cache-Control": ["no-store, no-cache, must-revalidate, proxy-revalidate"],
        Pragma: ["no-cache"],
        Expires: ["0"],
        "Surrogate-Control": ["no-store"],
      },
    });
  });

  desktopSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const permissionDetails = details as { mediaTypes?: readonly string[]; securityOrigin?: string };
    const requestingUrl = permissionDetails.securityOrigin || details.requestingUrl || webContents.getURL();
    const mediaTypes = permissionDetails.mediaTypes;
    callback(shouldAllowPermissionRequest(requestingUrl, dashboardOrigin, permission, { mediaTypes }));
  });

  desktopSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    return shouldAllowPermissionCheck(requestingOrigin, dashboardOrigin, permission, {
      mediaType: details.mediaType,
      requestingUrl: details.requestingUrl,
      securityOrigin: details.securityOrigin,
    });
  });
}

function openExternalUrl(rawUrl: string): boolean {
  if (classifyNavigationTarget(rawUrl, dashboardOrigin) !== "open-external") {
    return false;
  }

  void shell.openExternal(new URL(rawUrl).toString());
  return true;
}

function registerPackagedNodeModules(): void {
  if (!app.isPackaged) {
    return;
  }

  const nodeModulesPath = path.join(process.resourcesPath, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    return;
  }

  const nodePathEntries = (process.env.NODE_PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  if (!nodePathEntries.includes(nodeModulesPath)) {
    process.env.NODE_PATH = [nodeModulesPath, ...nodePathEntries].join(path.delimiter);
  }

  const mutableModule = Module as unknown as { globalPaths: string[]; _initPaths?: () => void };
  mutableModule._initPaths?.();
  if (!mutableModule.globalPaths.includes(nodeModulesPath)) {
    mutableModule.globalPaths.push(nodeModulesPath);
  }
}

function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, "build", "icon-512.png"),
      path.join(process.resourcesPath, "build", "icon.png"),
    );
  }
  candidates.push(
    path.join(projectRoot, "build", "icon-512.png"),
    path.join(projectRoot, "build", "icon.png"),
  );
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return undefined;
}

function createMainWindow(url: string): BrowserWindow {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const appIcon = resolveAppIcon();

  const savedState = loadWindowState();

  const window = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1100,
    minHeight: 720,
    title: "Code UX",
    icon: appIcon,
    frame: false,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: false,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: true,
    backgroundColor: "#00000000",
    backgroundMaterial: "none",
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    show: false,
    webPreferences: {
      ...isolatedRendererWebPreferences,
      // Leave backgroundThrottling at its default (true): when the window is blurred/occluded,
      // Chromium throttles rAF and timers, which is essential under software rendering (e.g. WSL,
      // where there is no vsync) — without it, the animation loops busy-spin and peg the CPU even
      // while the window is in the background. Realtime freshness while backgrounded is handled by
      // the timer fallback in use-realtime-resource's coalescer, so updates are never stranded.
    },
  });

  if (appIcon) {
    window.setIcon(appIcon);
    if (isMac && app.dock) {
      app.dock.setIcon(appIcon);
    }
  }

  if (savedState.isFullScreen) {
    window.setFullScreen(true);
  } else if (savedState.isMaximized) {
    window.maximize();
  }

  const persistState = createDebouncedSaver(window);
  window.on("resize", persistState);
  window.on("move", persistState);
  window.on("maximize", persistState);
  window.on("unmaximize", persistState);
  window.on("enter-full-screen", persistState);
  window.on("leave-full-screen", persistState);
  window.on("close", () => saveWindowState(window));

  const emitMaximizeState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send("codeux:window-state", {
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
    });
  };
  window.on("maximize", emitMaximizeState);
  window.on("unmaximize", emitMaximizeState);
  window.on("enter-full-screen", emitMaximizeState);
  window.on("leave-full-screen", emitMaximizeState);

  window.once("ready-to-show", () => {
    if (isWin) {
      const [w, h] = window.getSize();
      window.setSize(w + 1, h + 1);
      window.setSize(w, h);
    }
    window.show();
    emitMaximizeState();
  });

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const decision = classifyNavigationTarget(targetUrl, dashboardOrigin);
    if (decision === "allow-internal") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: isolatedRendererWebPreferences,
        },
      };
    }
    if (decision === "open-external") {
      openExternalUrl(targetUrl);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    const decision = classifyNavigationTarget(targetUrl, dashboardOrigin);
    if (decision === "allow-internal") {
      return;
    }
    event.preventDefault();
    if (decision === "open-external") {
      openExternalUrl(targetUrl);
    }
  });

  const startupSmokePath = process.env.CODE_UX_ELECTRON_STARTUP_SMOKE_FILE?.trim();
  if (startupSmokePath) {
    window.webContents.once("did-finish-load", () => {
      void writeElectronStartupSmoke(startupSmokePath, {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        dashboardOrigin: url,
        rendererUrl: window.webContents.getURL(),
      }).then(() => {
        if (process.env.CODE_UX_ELECTRON_STARTUP_SMOKE_EXIT === "1") {
          // This is an install/start probe, not a user-driven shutdown. On macOS, requesting the
          // normal AppKit quit cycle from the did-finish-load promise can be deferred until another
          // native termination event arrives, leaving an otherwise healthy RC alive on the runner.
          // Electron documents app.exit() as the immediate, deterministic exit path; the regular
          // before-quit handler below remains responsible for draining the embedded server during
          // every production shutdown.
          app.exit(0);
        }
      }).catch((error: unknown) => {
        process.exitCode = 1;
        console.error("Failed to record Electron startup smoke readiness", error);
        app.quit();
      });
    });
  }

  void window.loadURL(url);
  return window;
}

async function startServer(): Promise<string> {
  process.env.CODE_UX_DISABLE_MCP_STDIO = "1";
  registerPackagedNodeModules();
  const dotenv = await import("dotenv");
  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
  setProcessCredentialKeyProvider(new ElectronSafeStorageKeyProvider(
    safeStorage,
    new ElectronCredentialKeyPersistence(path.join(app.getPath("userData"), "credential-root-key.bin")),
  ));

  const [{ loadAppConfig }, { CodeUxServer }] = await Promise.all([
    import("../config/app-config.js"),
    import("../server/code-ux-server.js"),
  ]);
  const appConfig = loadAppConfig(["electron", "code-ux-desktop"], projectRoot);
  server = new CodeUxServer({ projectRoot, appConfig });
  await server.run();

  const port = server.getDashboardRuntimePort();
  dashboardOrigin = `http://127.0.0.1:${port}`;
  await configureDashboardNetworkSession();
  return dashboardOrigin;
}

async function stopServer(): Promise<void> {
  if (!server) {
    return;
  }

  const runningServer = server;
  server = null;
  await runningServer.close();
}

function resolveWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

ipcMain.handle("codeux:window-minimize", (event) => {
  resolveWindow(event)?.minimize();
});

ipcMain.handle("codeux:window-toggle-maximize", (event) => {
  const target = resolveWindow(event);
  if (!target) return false;
  return toggleWindowMaximized(target);
});

ipcMain.handle("codeux:window-close", (event) => {
  resolveWindow(event)?.close();
});

ipcMain.handle("codeux:window-state", (event) => {
  const target = resolveWindow(event);
  if (!target) {
    return { isMaximized: false, isFullScreen: false, platform: process.platform };
  }
  return {
    isMaximized: target.isMaximized(),
    isFullScreen: target.isFullScreen(),
    platform: process.platform,
  };
});

ipcMain.handle("codeux:set-zoom", (event, factor: unknown) => {
  const clamped = normalizeZoomFactor(factor);
  event.sender.setZoomFactor(clamped);
  return clamped;
});

ipcMain.handle("codeux:open-updates", () => {
  return openCodeUxUpdatesPage(shell);
});

ipcMain.handle("codeux:pick-directory", async (event, defaultPath: unknown) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory"],
  };

  options.defaultPath = resolveDirectoryPickerDefaultPath(
    defaultPath,
    os.homedir(),
    path.resolve,
    path.isAbsolute,
  );

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  return {
    canceled: result.canceled,
    filePath: result.filePaths[0] ?? null,
  };
});

app.whenReady().then(async () => {
  try {
    const url = await startServer();
    mainWindow = createMainWindow(url);
  } catch (error) {
    dialog.showErrorBox("Code UX failed to start", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && dashboardOrigin) {
    mainWindow = createMainWindow(dashboardOrigin);
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  void stopServer()
    .catch((error: unknown) => {
      process.exitCode = 1;
      console.error("Failed to stop Code UX runtime during Electron shutdown", error);
    })
    .finally(() => {
      // The first quit request is deliberately cancelled while the embedded server closes.
      // Re-entering app.quit() after that cancellation can leave a packaged macOS process alive,
      // so finish the already-drained shutdown without another before-quit cycle.
      app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
    });
});

app.on("window-all-closed", () => {
  app.quit();
});
