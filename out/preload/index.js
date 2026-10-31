"use strict";
const electron = require("electron");
const api = {
  createStory: (input) => electron.ipcRenderer.invoke("novel:create", input),
  continueStory: (id, text, important) => electron.ipcRenderer.invoke("novel:continue", id, text, important),
  listSessions: () => electron.ipcRenderer.invoke("novel:list"),
  getSession: (id) => electron.ipcRenderer.invoke("novel:get", id),
  prepareAssets: (id) => electron.ipcRenderer.invoke("novel:prepare-assets", id),
  saveSession: (id, label) => electron.ipcRenderer.invoke("novel:save", id, label),
  restoreSave: (sessionId, saveId) => electron.ipcRenderer.invoke("novel:restore", sessionId, saveId),
  getSettings: () => electron.ipcRenderer.invoke("novel:settings:get"),
  updateSettings: (settings) => electron.ipcRenderer.invoke("novel:settings:update", settings),
  revealAsset: (path) => electron.ipcRenderer.invoke("novel:asset:url", path),
  toggleFullscreen: () => electron.ipcRenderer.invoke("novel:fullscreen"),
  onProgress: (callback) => {
    const listener = (_, value) => callback(value);
    electron.ipcRenderer.on("novel:progress", listener);
    return () => electron.ipcRenderer.removeListener("novel:progress", listener);
  }
};
electron.contextBridge.exposeInMainWorld("novel", api);
