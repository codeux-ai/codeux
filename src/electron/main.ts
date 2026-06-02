import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import * as fs from "fs";
import Module from "module";
import * as path from "path";
import { fileURLToPath } from "url";
import { createDebouncedSaver, loadWindowState, saveWindowState } from "./window-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const preloadPath = path.join(__dirname, "preload.js");

let mainWindow: BrowserWindow | null = null;
let server: { run(): Promise<void>; close(): Promise<void>; getDashboardRuntimePort(): number } | null = null;
let dashboardOrigin: string | null = null;
let isQuitting = false;

const isWindowsPackagedApp = process.platform === "win32" && app.isPackaged;

if (isWindowsPackagedApp) {
  app.commandLine.appendSwitch("max-active-webgl-contexts", "4");
  app.commandLine.appendSwitch("force-gpu-mem-available-mb", "512");
}

if (process.env.WSL_DISTRO_NAME && process.env.CODE_UX_WSL_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

function isSafeInternalUrl(rawUrl: string): boolean {
  if (!dashboardOrigin) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    if (url.origin === dashboardOrigin) {
      return true;
    }
    return url.protocol === "http:"
      && url.port === new URL(dashboardOrigin).port
      && /^preview-[a-z0-9-]+\.localhost$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function openExternalUrl(rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed navigation targets.
  }
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
    transparent: !isWindowsPackagedApp,
    backgroundColor: isWindowsPackagedApp ? "#0D0F12" : "#00000000",
    backgroundMaterial: "none",
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
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
    if (isSafeInternalUrl(targetUrl)) {
      return { action: "allow" };
    }
    openExternalUrl(targetUrl);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isSafeInternalUrl(targetUrl)) {
      return;
    }
    event.preventDefault();
    openExternalUrl(targetUrl);
  });

  void window.loadURL(url);
  return window;
}

async function startServer(): Promise<string> {
  process.env.CODE_UX_DISABLE_MCP_STDIO = "1";
  registerPackagedNodeModules();
  const dotenv = await import("dotenv");
  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

  const [{ loadAppConfig }, { JulesAgentServer }] = await Promise.all([
    import("../config/app-config.js"),
    import("../server/jules-agent-server.js"),
  ]);
  const appConfig = loadAppConfig(["electron", "code-ux-desktop"], projectRoot);
  server = new JulesAgentServer({ projectRoot, appConfig });
  await server.run();

  const port = server.getDashboardRuntimePort();
  dashboardOrigin = `http://127.0.0.1:${port}`;
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
  if (target.isMaximized()) {
    target.unmaximize();
    return false;
  }
  target.maximize();
  return true;
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

ipcMain.handle("codeux:set-zoom", (event, factor: number) => {
  const numeric = typeof factor === "number" && Number.isFinite(factor) ? factor : 1;
  const clamped = Math.min(2.5, Math.max(0.5, numeric));
  event.sender.setZoomFactor(clamped);
  return clamped;
});

ipcMain.handle("codeux:pick-directory", async (event, defaultPath?: string) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory"],
  };

  if (typeof defaultPath === "string" && defaultPath.trim().length > 0) {
    options.defaultPath = defaultPath.trim();
  }

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
  void stopServer().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  app.quit();
});
