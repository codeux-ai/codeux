import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadAppConfig } from "../config/app-config.js";
import { JulesAgentServer } from "../server/jules-agent-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const preloadPath = path.join(__dirname, "preload.js");

let mainWindow: BrowserWindow | null = null;
let server: JulesAgentServer | null = null;
let dashboardOrigin: string | null = null;
let isQuitting = false;

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

function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "Code UX",
    backgroundColor: "#0d0f12",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
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
  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

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
