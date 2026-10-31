import { contextBridge, ipcRenderer } from 'electron'
import type { NovelApi } from '../shared/types'

const api: NovelApi = {
  createStory: (input) => ipcRenderer.invoke('novel:create', input),
  continueStory: (id, text, important) => ipcRenderer.invoke('novel:continue', id, text, important),
  listSessions: () => ipcRenderer.invoke('novel:list'),
  getSession: (id) => ipcRenderer.invoke('novel:get', id),
  prepareAssets: (id) => ipcRenderer.invoke('novel:prepare-assets', id),
  saveSession: (id, label) => ipcRenderer.invoke('novel:save', id, label),
  restoreSave: (sessionId, saveId) => ipcRenderer.invoke('novel:restore', sessionId, saveId),
  getSettings: () => ipcRenderer.invoke('novel:settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('novel:settings:update', settings),
  revealAsset: (path) => ipcRenderer.invoke('novel:asset:url', path),
  toggleFullscreen: () => ipcRenderer.invoke('novel:fullscreen'),
  onProgress: (callback) => { const listener = (_: unknown, value: unknown) => callback(value as never); ipcRenderer.on('novel:progress', listener); return () => ipcRenderer.removeListener('novel:progress', listener) }
}
contextBridge.exposeInMainWorld('novel', api)
