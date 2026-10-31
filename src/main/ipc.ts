import { ipcMain, app } from 'electron'
import { Storage } from '../services/storage/storage'
import { StoryService } from '../services/story/story-service'
import type { GenerationProgress, NewStoryInput, Settings } from '../shared/types'

export function registerNovelHandlers(progress: (p: GenerationProgress) => void): void {
  const storage = new Storage(app.getPath('userData'))
  const story = new StoryService(storage, progress)
  ipcMain.handle('novel:create', (_, input: NewStoryInput) => story.create(input))
  ipcMain.handle('novel:continue', (_, id: string, text: string, important: boolean) => story.continue(id, text, important))
  ipcMain.handle('novel:list', () => storage.listSessions())
  ipcMain.handle('novel:get', (_, id: string) => storage.getSession(id))
  ipcMain.handle('novel:prepare-assets', (_, id: string) => story.prepareAssets(id))
  ipcMain.handle('novel:save', (_, id: string, label?: string) => story.save(id, label))
  ipcMain.handle('novel:restore', (_, sessionId: string, saveId: string) => story.restore(sessionId, saveId))
  ipcMain.handle('novel:settings:get', () => storage.publicSettings())
  ipcMain.handle('novel:settings:update', (_, settings: Partial<Settings>) => storage.updateSettings(settings).then(() => storage.publicSettings()))
  ipcMain.handle('novel:asset:url', (_, path: string) => storage.assetUrl(path))
}
