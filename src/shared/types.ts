export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'embarrassed' | 'scared' | 'serious'
export type InputMode = 'reply' | 'action'

export interface Settings {
  apiKey?: string
  textModel: string
  imageModel: string
  imageQuality: 'low' | 'medium' | 'high'
  textSpeed: number
  uiScale: number
  musicVolume: number
  fullscreen: boolean
}

export interface Character {
  id: string
  name: string
  ageRange: string
  role: string
  personality: string
  appearance: string
  secret: string
  relationship: number
  emotion: Emotion
  imagePrompt: string
  portraitPath?: string
  portraitPaths?: Partial<Record<Emotion, string>>
  portraitStyle?: string
}

export interface Location {
  id: string
  name: string
  description: string
  timeOfDay: string
  mood: string
  backgroundPrompt: string
  backgroundPath?: string
}

export interface StoryMessage {
  id: string
  kind: 'narration' | 'dialogue' | 'player' | 'system'
  text: string
  speaker?: string
  createdAt: string
}

export interface Scene {
  sceneText: string
  speaker?: string
  dialogue?: string
  currentLocation: string
  requiredBackground: string
  charactersOnScreen: string[]
  characterEmotions: Record<string, Emotion>
  isImportantChoice: boolean
  allowedActionType: string
  playerPrompt?: string
  worldRuleCheck: string
  relationshipChanges: Record<string, number>
  newFlags: string[]
  needsNewBackground: boolean
  needsNewCharacter: boolean
  imageGenerationTasks: Array<{ type: 'background' | 'character'; subject: string; prompt: string }>
  autosaveNeeded: boolean
}

export interface SessionState {
  id: string
  title: string
  theme: string
  genre: string
  darkness: number
  romance: number
  mystery: number
  worldSummary: string
  worldRules: string[]
  storySkeleton: string[]
  currentScene: Scene
  currentLocationId: string
  activeCharacterIds: string[]
  characters: Character[]
  locations: Location[]
  openBranches: string[]
  closedBranches: string[]
  flags: string[]
  playerActions: Array<{ text: string; important: boolean; createdAt: string }>
  messages: StoryMessage[]
  memorySummary: string
  assets: Asset[]
  saves: SaveSlot[]
  createdAt: string
  updatedAt: string
}

export interface Asset { id: string; kind: 'background' | 'character' | 'cg'; label: string; path: string; prompt: string; createdAt: string }
export interface SaveSlot { id: string; label: string; createdAt: string; scenePreview: string; locationName: string; snapshot: SessionState }
export interface NewStoryInput { theme: string; genre: string; darkness: number; romance: number; mystery: number }
export interface GenerationProgress { stage: string; detail: string; percent: number }

export interface NovelApi {
  createStory(input: NewStoryInput): Promise<SessionState>
  continueStory(id: string, text: string, important: boolean): Promise<SessionState>
  listSessions(): Promise<SessionState[]>
  getSession(id: string): Promise<SessionState | null>
  prepareAssets(id: string): Promise<SessionState>
  saveSession(id: string, label?: string): Promise<SessionState>
  restoreSave(sessionId: string, saveId: string): Promise<SessionState>
  getSettings(): Promise<Omit<Settings, 'apiKey'> & { hasApiKey: boolean }>
  updateSettings(settings: Partial<Settings>): Promise<Omit<Settings, 'apiKey'> & { hasApiKey: boolean }>
  revealAsset(path: string): Promise<string>
  toggleFullscreen(): Promise<boolean>
  onProgress(callback: (progress: GenerationProgress) => void): () => void
}
