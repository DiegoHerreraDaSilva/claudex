const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudexApp", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  checkForUpdates: () => ipcRenderer.invoke("check-updates"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
  },
  platform: process.platform,
});
