import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import updater from "electron-updater";
import { getConfig } from "../dist/config.js";
import { JevClient } from "../dist/jev.js";
import { ProjectRegistry } from "../dist/app/projects.js";
import { bootstrapDataDir } from "../dist/app/bootstrap.js";
import { ChatService } from "../dist/app/chat.js";
import { createAppServer } from "../dist/server/appServer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
process.env["CLAUDEX_ROOT"] = repoRoot;

app.setName("Claudex");

let mainWindow = null;
let appServer = null;
let autoUpdater = null;

const isDev = !app.isPackaged;

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-status", payload);
}

function setupAutoUpdate() {
  if (isDev) return;
  autoUpdater = updater.autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ status: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ status: "available", version: info?.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ status: "none" }));
  autoUpdater.on("download-progress", (p) => sendUpdateStatus({ status: "downloading", percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ status: "downloaded", version: info?.version }));
  autoUpdater.on("error", (err) => sendUpdateStatus({ status: "error", message: err?.message ?? String(err) }));
  autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
}

ipcMain.handle("check-updates", async () => {
  if (isDev || !autoUpdater) return { status: "dev" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: "checking", version: result?.updateInfo?.version ?? null };
  } catch (err) {
    return { status: "error", message: err?.message ?? String(err) };
  }
});

async function start() {
  process.env["CLAUDEX_DATA_DIR"] = app.getPath("userData");
  const config = getConfig();
  await bootstrapDataDir(config.projectRoot, config.dataDir, config.logsDir);

  const registry = new ProjectRegistry(config.dataDir);
  await registry.load();
  const chat = new ChatService(registry, new JevClient(config), config, config.worktreesDir);
  appServer = createAppServer({ chat, registry, config });
  const port = await appServer.listen(0);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Claudex",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  setupAutoUpdate();
}

ipcMain.handle("pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ["openDirectory"],
    title: "Escolha a pasta do projeto (repositório git)",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(start).catch((err) => {
  console.error("failed to start Claudex app:", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void start();
});
