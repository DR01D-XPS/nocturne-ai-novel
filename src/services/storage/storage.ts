import { mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { Scene, SessionState, Settings } from '../../shared/types'

const defaults: Settings = {
  apiKey: process.env.OPENAI_API_KEY || '', textModel: process.env.DEFAULT_TEXT_MODEL || process.env.TEXT_MODEL_BUDGET || 'gpt-4.1-mini',
  imageModel: process.env.DEFAULT_IMAGE_MODEL || process.env.IMAGE_MODEL_BUDGET || 'gpt-image-1-mini', imageQuality: 'low', textSpeed: 28, uiScale: 1, musicVolume: 35, fullscreen: false
}

export class Storage {
  private dataDir: string; private sessionsDir: string; private assetsDir: string; private settingsFile: string
  constructor(userData: string) { this.dataDir = join(userData, 'nocturne-novel'); this.sessionsDir = join(this.dataDir, 'sessions'); this.assetsDir = join(this.dataDir, 'assets'); this.settingsFile = join(this.dataDir, 'settings.json') }
  private async ready(): Promise<void> { await Promise.all([mkdir(this.sessionsDir, { recursive: true }), mkdir(this.assetsDir, { recursive: true })]) }
  async settings(): Promise<Settings> { await this.ready(); if (!existsSync(this.settingsFile)) return { ...defaults }; try { return { ...defaults, ...JSON.parse(await readFile(this.settingsFile, 'utf8')) } } catch { return { ...defaults } } }
  async updateSettings(patch: Partial<Settings>): Promise<Settings> { const value = { ...(await this.settings()), ...patch }; await writeFile(this.settingsFile, JSON.stringify(value, null, 2), 'utf8'); return value }
  async publicSettings(): Promise<Omit<Settings, 'apiKey'> & { hasApiKey: boolean }> { const { apiKey, ...safe } = await this.settings(); return { ...safe, hasApiKey: Boolean(apiKey) } }
  async saveSession(session: SessionState): Promise<void> { await this.ready(); await writeFile(join(this.sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf8') }
  async getSession(id: string): Promise<SessionState | null> { await this.ready(); const file = join(this.sessionsDir, `${id}.json`); if (!existsSync(file)) return null; try { return normalizeSession(JSON.parse(await readFile(file, 'utf8'))) } catch { return null } }
  async listSessions(): Promise<SessionState[]> { await this.ready(); const files = (await readdir(this.sessionsDir)).filter((f) => f.endsWith('.json')); const sessions = await Promise.all(files.map((file) => this.getSession(file.slice(0, -5)))); return sessions.filter((x): x is SessionState => Boolean(x)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
  assetsPath(): string { return this.assetsDir }
  assetUrl(file: string): string { const absolute = resolve(file); if (!absolute.startsWith(resolve(this.assetsDir))) throw new Error('Недопустимый путь к ассету'); return pathToFileURL(absolute).toString() }
}

/** Old AI responses could wrap lists as { characters: [...] }; normalize them on read. */
function normalizeSession(value: SessionState): SessionState {
  const session = value as SessionState & Record<string, unknown>
  const scene = normalizeScene(session.currentScene)
  const activeCharacterIds = unwrapList(session.activeCharacterIds, 'activeCharacterIds')
  const normalized = {
    ...session,
    characters: unwrapList(session.characters, 'characters'),
    locations: unwrapList(session.locations, 'locations'),
    messages: unwrapList(session.messages, 'messages'),
    assets: unwrapList(session.assets, 'assets'),
    saves: unwrapList(session.saves, 'saves'),
    activeCharacterIds: activeCharacterIds.length ? activeCharacterIds : scene.charactersOnScreen,
    openBranches: unwrapList(session.openBranches, 'openBranches'),
    closedBranches: unwrapList(session.closedBranches, 'closedBranches'),
    flags: unwrapList(session.flags, 'flags'),
    playerActions: unwrapList(session.playerActions, 'playerActions'),
    currentScene: scene
  } as SessionState
  return normalized
}

function unwrapList(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key])) return (value as Record<string, unknown>)[key] as unknown[]
  return []
}

function normalizeScene(value: unknown): Scene {
  const raw = value && typeof value === 'object' ? value as Partial<Scene> : {}
  return {
    sceneText: typeof raw.sceneText === 'string' ? raw.sceneText : '', speaker: typeof raw.speaker === 'string' ? raw.speaker : '', dialogue: typeof raw.dialogue === 'string' ? raw.dialogue : '', currentLocation: typeof raw.currentLocation === 'string' ? raw.currentLocation : '', requiredBackground: typeof raw.requiredBackground === 'string' ? raw.requiredBackground : '', charactersOnScreen: unwrapList(raw.charactersOnScreen, 'charactersOnScreen').filter((x): x is string => typeof x === 'string'), characterEmotions: raw.characterEmotions && typeof raw.characterEmotions === 'object' ? raw.characterEmotions : {}, isImportantChoice: raw.isImportantChoice === true, allowedActionType: typeof raw.allowedActionType === 'string' ? raw.allowedActionType : 'свободная реплика', playerPrompt: typeof raw.playerPrompt === 'string' ? raw.playerPrompt : '', worldRuleCheck: typeof raw.worldRuleCheck === 'string' ? raw.worldRuleCheck : '', relationshipChanges: raw.relationshipChanges && typeof raw.relationshipChanges === 'object' ? raw.relationshipChanges : {}, newFlags: unwrapList(raw.newFlags, 'newFlags').filter((x): x is string => typeof x === 'string'), needsNewBackground: raw.needsNewBackground === true, needsNewCharacter: raw.needsNewCharacter === true, imageGenerationTasks: unwrapList(raw.imageGenerationTasks, 'imageGenerationTasks') as Scene['imageGenerationTasks'], autosaveNeeded: raw.autosaveNeeded !== false
  }
}
