import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import updater from "electron-updater";
import { getConfig } from "../dist/config.js";
import { JevClient } from "../dist/jev.js";
import { bootstrapDataDir } from "../dist/app/bootstrap.js";
import { SessionService } from "../dist/application/sessionService.js";
import { createSessionServer } from "../dist/server/sessionServer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
process.env["CLAUDEX_ROOT"] = repoRoot;

app.setName("Claudex");
// Windows agrupa a barra de tarefas e escolhe o ícone pelo AppUserModelID (mesmo appId do instalador).
if (process.platform === "win32") app.setAppUserModelId("ai.claudex.app");

let mainWindow = null;
let appServer = null;
let autoUpdater = null;
let shuttingDown = false;

const isDev = !app.isPackaged;

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("update-status", payload);
}

function setupAutoUpdate() {
  if (isDev) return;
  autoUpdater = updater.autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ status: "checking" }));
  autoUpdater.on("update-available", (info) =>
    sendUpdateStatus({ status: "available", version: info?.version }),
  );
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ status: "none" }));
  autoUpdater.on("download-progress", (p) =>
    sendUpdateStatus({ status: "downloading", percent: Math.round(p?.percent ?? 0) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendUpdateStatus({ status: "downloaded", version: info?.version }),
  );
  autoUpdater.on("error", (err) =>
    sendUpdateStatus({ status: "error", message: err?.message ?? String(err) }),
  );
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
  // Sem a barra "File, Edit, View, Window, Help". No macOS o menu do sistema mantém os atalhos de edição.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  process.env["CLAUDEX_DATA_DIR"] = app.getPath("userData");
  const config = getConfig();
  await bootstrapDataDir(config.projectRoot, config.dataDir, config.logsDir);

  const sessions = new SessionService(config.dataDir, config, new JevClient(config));
  await sessions.load();
  appServer = createSessionServer({ sessions, config });
  const port = await appServer.listen(0);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Claudex",
    icon: path.join(
      app.getAppPath(),
      "build",
      process.platform === "win32" ? "icon.ico" : "icon.png",
    ),
    autoHideMenuBar: true,
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
    title: "Escolha a pasta do projeto",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app
  .whenReady()
  .then(start)
  .catch((err) => {
    console.error("failed to start Claudex app:", err);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!appServer || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void appServer.close().finally(() => app.quit());
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void start();
});
