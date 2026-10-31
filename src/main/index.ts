import { app, BrowserWindow, ipcMain } from 'electron'
import 'dotenv/config'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerNovelHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: '#10101b',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  })
  mainWindow.setMenuBarVisibility(false)
  if (is.dev && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerNovelHandlers((progress) => mainWindow?.webContents.send('novel:progress', progress))
  ipcMain.handle('novel:fullscreen', () => {
    const next = !mainWindow?.isFullScreen()
    mainWindow?.setFullScreen(next)
    return next
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
