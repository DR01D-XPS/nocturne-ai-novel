import { randomUUID } from 'crypto'
import type { Character, Emotion, NewStoryInput, Scene, SessionState, StoryMessage } from '../../shared/types'
import { PORTRAIT_ART_DIRECTION, PORTRAIT_STYLE_VERSION } from '../../shared/portrait'
import type { Storage } from '../storage/storage'
import { OpenAIStoryService } from '../openai/openai-service'

export class StoryService {
  private ai: OpenAIStoryService
  constructor(private storage: Storage, private progress: (v: { stage: string; detail: string; percent: number }) => void) { this.ai = new OpenAIStoryService(storage) }
  private say(stage: string, detail: string, percent: number): void { this.progress({ stage, detail, percent }) }
  async create(input: NewStoryInput): Promise<SessionState> {
    this.say('Создаём мир', 'Собираем правила и первые локации…', 12)
    let session: SessionState
    try {
      const world = await this.ai.generateWorld(input); this.say('Готовим персонажей', 'Ищем их слабости и недосказанности…', 35)
      const characters = await this.ai.generateInitialCharacters({ ...input, worldSummary: world.worldSummary }); this.say('Прокладываем ветви', 'Намечаем последствия…', 58)
      const skeleton = await this.ai.generateStorySkeleton({ worldSummary: world.worldSummary, characters }); this.say('Пишем первую сцену', 'Зажигается свет в первой локации…', 78)
      const scene = await this.ai.generateOpeningScene({ worldSummary: world.worldSummary, worldRules: world.worldRules, characters, locations: world.locations, skeleton })
      session = this.assemble(input, world.title, world.worldSummary, world.worldRules, characters, world.locations, skeleton, scene)
      await this.generateOpeningBackground(session)
      await this.generateCharacterPortraits(session)
    } catch (error) {
      // A usable offline story is preferable to a dead start screen when a key/network is unavailable.
      session = this.fallback(input, error instanceof Error ? error.message : 'AI временно недоступен')
    }
    this.say('Сохраняем историю', 'Первое автосохранение готово.', 96)
    await this.storage.saveSession(session); this.say('Готово', 'Сцена открыта.', 100)
    return session
  }
  async continue(id: string, text: string, important: boolean): Promise<SessionState> {
    const session = await this.require(id); const now = new Date().toISOString()
    session.messages.push({ id: randomUUID(), kind: 'player', text, createdAt: now })
    session.playerActions.push({ text, important, createdAt: now })
    try {
      const next = await this.ai.generateNextScene(session, text, important)
      const locationChanged = this.applyScene(session, next)
      // A location keeps its cached backdrop; a fresh one is requested only after an actual move.
      if (locationChanged && next.needsNewBackground) await this.generateOpeningBackground(session)
      if (session.messages.length % 8 === 0) session.memorySummary = (await this.ai.summarizeSessionMemory(session)).summary
    } catch (error) { this.applyScene(session, this.fallbackNext(session, text, important, error instanceof Error ? error.message : 'сбой')) }
    session.updatedAt = new Date().toISOString(); await this.storage.saveSession(session)
    return session
  }
  async save(id: string, label = 'Ручное сохранение'): Promise<SessionState> { const session = await this.require(id); const snapshot = structuredClone(session); snapshot.saves = []; session.saves.unshift({ id: randomUUID(), label, createdAt: new Date().toISOString(), scenePreview: session.currentScene.sceneText.slice(0, 100), locationName: this.location(session).name, snapshot }); session.updatedAt = new Date().toISOString(); await this.storage.saveSession(session); return session }
  async prepareAssets(id: string): Promise<SessionState> { const session = await this.require(id); const settings = await this.storage.settings(); const outdated = session.characters.some((character) => character.portraitStyle !== PORTRAIT_STYLE_VERSION); if (outdated && settings.apiKey) { await this.generateCharacterPortraits(session, true, false); session.updatedAt = new Date().toISOString(); await this.storage.saveSession(session) } return session }
  async restore(sessionId: string, saveId: string): Promise<SessionState> { const session = await this.require(sessionId); const slot = session.saves.find((s) => s.id === saveId); if (!slot) throw new Error('Сохранение не найдено'); const restored = structuredClone(slot.snapshot); restored.saves = session.saves; restored.updatedAt = new Date().toISOString(); await this.storage.saveSession(restored); return restored }
  private assemble(input: NewStoryInput, title: string, worldSummary: string, worldRules: string[], characters: Character[], locations: SessionState['locations'], storySkeleton: string[], currentScene: Scene): SessionState { const now = new Date().toISOString(); const safeScene = normalizeScene(currentScene); const location = locations.find((x) => x.name === safeScene.currentLocation) || locations[0]; return { id: randomUUID(), title, ...input, worldSummary, worldRules, storySkeleton, currentScene: safeScene, currentLocationId: location?.id || '', activeCharacterIds: safeScene.charactersOnScreen, characters, locations, openBranches: storySkeleton.slice(0, 2), closedBranches: [], flags: safeScene.newFlags, playerActions: [], messages: sceneMessages(safeScene), memorySummary: 'История только началась.', assets: [], saves: [], createdAt: now, updatedAt: now } }
  private applyScene(session: SessionState, scene: Scene): boolean { const safeScene = normalizeScene(scene, session.currentScene); const previousLocationId = session.currentLocationId; session.currentScene = safeScene; const location = session.locations.find((x) => x.name === safeScene.currentLocation); if (location) session.currentLocationId = location.id; session.activeCharacterIds = safeScene.charactersOnScreen; session.flags = [...new Set([...session.flags, ...safeScene.newFlags])]; for (const char of session.characters) { const requestedEmotion = emotionForCharacter(safeScene.characterEmotions, char); if (requestedEmotion) char.emotion = requestedEmotion; const relationshipDelta = numberForCharacter(safeScene.relationshipChanges, char); if (relationshipDelta) char.relationship += relationshipDelta } session.messages.push(...sceneMessages(safeScene)); return previousLocationId !== session.currentLocationId }
  private async generateOpeningBackground(session: SessionState): Promise<void> { const location = this.location(session); if (location.backgroundPath) return; this.say('Создаём фон', 'Пока свет собирается в кадр…', 82); try { const prompt = (await this.ai.generateLocationBackgroundPrompt(location)).prompt; const path = await this.ai.generateImage(prompt, `bg-${session.id}-${location.id}`); location.backgroundPath = path; session.assets.push({ id: randomUUID(), kind: 'background', label: location.name, path, prompt, createdAt: new Date().toISOString() }) } catch { /* the CSS atmosphere remains as a graceful visual fallback */ } }
  private async generateCharacterPortraits(session: SessionState, refresh = false, announce = true): Promise<void> {
    const emotions: Character['emotion'][] = ['neutral', 'happy', 'sad', 'angry', 'embarrassed', 'scared', 'serious']
    const total = session.characters.length * emotions.length; let completed = 0
    for (const character of session.characters) {
      if (refresh) { character.portraitPaths = {}; character.portraitPath = undefined }
      character.portraitPaths ||= {}
      for (const emotion of emotions) {
        if (character.portraitPaths[emotion]) { completed++; continue }
        if (announce) this.say('Готовим портреты', `${character.name}: ${emotion}`, 82 + Math.round((completed / Math.max(total, 1)) * 13))
        const prompt = `Adult visual novel character sprite, three-quarter body, ${character.imagePrompt}. Visual anchor: ${character.appearance}. Expression: ${emotion}. ${PORTRAIT_ART_DIRECTION}. Isolated character on a fully transparent background, no scenery, no room, no landscape, no props behind the person, no frame, no text, no cast shadow. Keep the exact same adult person, hairstyle, clothing, accessories and proportions.`
        try {
          const key = `char-${session.id}-${character.id}-${emotion}-${PORTRAIT_STYLE_VERSION}`
          const neutralPath = character.portraitPaths.neutral
          const path = emotion !== 'neutral' && neutralPath
            ? await this.ai.editCharacterEmotion(neutralPath, `Edit only the facial expression of this exact character to ${emotion}. Preserve the character identity, pose, outfit, transparent background, framing and ${PORTRAIT_ART_DIRECTION}.`, key)
            : await this.ai.generateImage(prompt, key, true)
          character.portraitPaths[emotion] = path
          if (emotion === 'neutral') character.portraitPath = path
          session.assets.push({ id: randomUUID(), kind: 'character', label: `${character.name} — ${emotion}`, path, prompt, createdAt: new Date().toISOString() })
        } catch { /* The narrator remains playable while a portrait is unavailable. */ }
        completed++
      }
      if (Object.keys(character.portraitPaths).length > 0) character.portraitStyle = PORTRAIT_STYLE_VERSION
    }
  }
  private location(session: SessionState) { return session.locations.find((x) => x.id === session.currentLocationId) || session.locations[0] }
  private async require(id: string): Promise<SessionState> { const value = await this.storage.getSession(id); if (!value) throw new Error('История не найдена'); return value }
  private fallback(input: NewStoryInput, reason: string): SessionState { const locations = [{ id: 'pier', name: 'Старый пирс', description: 'Влажные доски, тусклый маяк и вода, в которой не видно дна.', timeOfDay: 'сумерки', mood: 'тревожное ожидание', backgroundPrompt: 'rainy sea pier at twilight, cinematic visual novel background, no text' }]; const characters: Character[] = [{ id: 'mira', name: 'Мира Вельская', ageRange: '24–29', role: 'смотрительница маяка', personality: 'Резкая, наблюдательная, не терпит пустых обещаний.', appearance: 'Тёмная куртка, мокрые волосы, серебряная серьга в форме рыбьей кости.', secret: 'Она знает, кто оставляет свет в маяке после полуночи.', relationship: 0, emotion: 'serious', imagePrompt: 'adult lighthouse keeper, dark jacket, visual novel portrait' }, { id: 'lev', name: 'Лев Ордынцев', ageRange: '26–33', role: 'приезжий фотограф', personality: 'Ироничный, осторожный, слишком часто прячет руки в карманы.', appearance: 'Выцветшая рубашка, старый фотоаппарат на ремне.', secret: 'На его плёнке есть снимок, сделанный до приезда в город.', relationship: 0, emotion: 'neutral', imagePrompt: 'adult photographer, old camera, visual novel portrait' }]; const scene = { sceneText: `Сумерки сгущаются над пирсом. Солёная вода щёлкает по сваям, как кто-то, кому не открывают дверь. На дальнем маяке на секунду вспыхивает свет — хотя здесь уверяют, что он давно не работает.`, speaker: 'Мира Вельская', dialogue: 'Если пришли смотреть на море — поздно. Оно сегодня смотрит в ответ.', currentLocation: 'Старый пирс', requiredBackground: 'pier', charactersOnScreen: ['mira'], characterEmotions: { mira: 'serious' as const }, isImportantChoice: false, allowedActionType: 'свободная реплика', worldRuleCheck: 'Мир подчиняется бытовой логике, но море хранит старые долги.', relationshipChanges: {}, newFlags: ['маяк_зажёгся'], needsNewBackground: false, needsNewCharacter: false, imageGenerationTasks: [], autosaveNeeded: true }; const session = this.assemble(input, 'Там, где не гаснет свет', `В прибрежном городке люди привыкли не задавать вопросов о маяке. ${reason.includes('OPENAI') ? 'История запущена в локальном режиме: добавьте ключ в настройках, чтобы включить генерацию.' : 'AI временно недоступен; локальный рассказчик продолжит историю.'}`, ['Невозможное не случается без цены.', 'У каждого есть причина молчать.', 'События оставляют след.'], characters, locations, ['Узнать, почему загорается маяк.', 'Решить, кому из незнакомцев верить.', 'Найти связь между плёнкой и морем.'], scene); return session }
  private fallbackNext(session: SessionState, text: string, important: boolean, reason: string): Scene { const activeIds = Array.isArray(session.activeCharacterIds) ? session.activeCharacterIds : []; const characters = Array.isArray(session.characters) ? session.characters : []; const speaker = characters.find((c) => activeIds.includes(c.id)) || characters[0]; const name = speaker?.name || 'Незнакомец'; return normalizeScene({ ...session.currentScene, sceneText: `Ваши слова — «${text}» — растворяются между ветром и водой. ${name} не отвечает сразу: смотрит туда, где маяк снова на миг режет туман белой полосой. В этой паузе становится ясно: город услышал вас.`, speaker: name, dialogue: important ? 'Красивое решение. Но красивые решения чаще всего дорого обходятся.' : 'Не торопитесь. Здесь поспешность умеет возвращаться.', isImportantChoice: important || session.messages.length % 4 === 0, allowedActionType: important ? 'свободное важное действие' : 'свободная реплика', relationshipChanges: speaker && text.includes('спасибо') ? { [speaker.id]: 2 } : {}, newFlags: important ? [`выбор_${session.playerActions.length}`] : [], autosaveNeeded: true, worldRuleCheck: `Локальный рассказчик: ${reason}` }, session.currentScene) }
}

function sceneMessages(scene: Scene): StoryMessage[] { const now = new Date().toISOString(); const result: StoryMessage[] = [{ id: randomUUID(), kind: 'narration', text: scene.sceneText, createdAt: now }]; if (scene.dialogue) result.push({ id: randomUUID(), kind: 'dialogue', speaker: scene.speaker, text: scene.dialogue, createdAt: now }); return result }

function normalizeScene(value: Partial<Scene>, previous?: Scene): Scene {
  const fallback = previous || { sceneText: '', speaker: '', dialogue: '', currentLocation: '', requiredBackground: '', charactersOnScreen: [], characterEmotions: {}, isImportantChoice: false, allowedActionType: 'свободная реплика', playerPrompt: '', worldRuleCheck: '', relationshipChanges: {}, newFlags: [], needsNewBackground: false, needsNewCharacter: false, imageGenerationTasks: [], autosaveNeeded: true }
  return { ...fallback, ...value, charactersOnScreen: Array.isArray(value.charactersOnScreen) ? value.charactersOnScreen.filter((x): x is string => typeof x === 'string') : fallback.charactersOnScreen, characterEmotions: value.characterEmotions && typeof value.characterEmotions === 'object' ? value.characterEmotions : fallback.characterEmotions, relationshipChanges: value.relationshipChanges && typeof value.relationshipChanges === 'object' ? value.relationshipChanges : {}, newFlags: Array.isArray(value.newFlags) ? value.newFlags.filter((x): x is string => typeof x === 'string') : [], imageGenerationTasks: Array.isArray(value.imageGenerationTasks) ? value.imageGenerationTasks : [], isImportantChoice: value.isImportantChoice === true, needsNewBackground: value.needsNewBackground === true, needsNewCharacter: value.needsNewCharacter === true, autosaveNeeded: value.autosaveNeeded !== false }
}

function emotionForCharacter(changes: Record<string, Emotion>, character: Character): Emotion | undefined {
  const raw = changes[character.id] ?? changes[character.name] ?? changes[character.name.toLowerCase()]
  return raw ? normalizeEmotion(raw) : undefined
}
function numberForCharacter(changes: Record<string, number>, character: Character): number | undefined { return changes[character.id] ?? changes[character.name] ?? changes[character.name.toLowerCase()] }
function normalizeEmotion(value: unknown): Emotion {
  const text = String(value).toLowerCase()
  if (['neutral', 'happy', 'sad', 'angry', 'embarrassed', 'scared', 'serious'].includes(text)) return text as Emotion
  if (/рад|улыб|счаст/.test(text)) return 'happy'
  if (/гнев|зл|ярост/.test(text)) return 'angry'
  if (/груст|печал|тоск/.test(text)) return 'sad'
  if (/смущ|неловк/.test(text)) return 'embarrassed'
  if (/страх|тревог|растер|испуг/.test(text)) return 'scared'
  if (/решим|серьез|серьёз|насторож/.test(text)) return 'serious'
  return 'neutral'
}
