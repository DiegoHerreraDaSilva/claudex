const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudexApp", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  platform: process.platform,
});
