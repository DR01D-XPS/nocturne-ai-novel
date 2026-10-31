import OpenAI from 'openai'
import { writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import { join } from 'path'
import type { Character, NewStoryInput, Scene, SessionState } from '../../shared/types'
import type { Storage } from '../storage/storage'

const SYSTEM = `Ты — Game Master оригинальной русскоязычной AI-визуальной новеллы. Пиши атмосферно, кинематографично, с драмой, бытовыми деталями и недосказанностью. Не копируй существующие игры, персонажей или тексты. Все персонажи — совершеннолетние. Не создавай запрещённый контент. Держи правила мира и характеры устойчивыми. Подача компактная: одна сцена — 70–130 слов прозы, реплика персонажа — 1–3 короткие фразы. Не повторяй экспозицию после стартовой сцены. Отвечай только валидным JSON без markdown.`

function cleanJson(raw: string): string {
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = fenced.indexOf('{'); const end = fenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Ответ модели не содержит JSON')
  return fenced.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
}

export class OpenAIStoryService {
  constructor(private storage: Storage) {}
  private async json<T>(task: string, payload: unknown): Promise<T> {
    const settings = await this.storage.settings()
    if (!settings.apiKey) throw new Error('OPENAI_API_KEY не настроен')
    const client = new OpenAI({ apiKey: settings.apiKey })
    const prompt = `${SYSTEM}\n\nЗадача: ${task}\nДанные:\n${JSON.stringify(payload)}\nJSON:`
    let raw = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.responses.create({ model: settings.textModel, input: prompt, text: { format: { type: 'json_object' } } } as any)
        raw = response.output_text
        return JSON.parse(cleanJson(raw)) as T
      } catch (error) {
        if (attempt === 1) throw new Error(`Не удалось получить корректный JSON от AI: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error('AI не вернул ответ')
  }
  generateWorld(input: NewStoryInput): Promise<{ title: string; worldSummary: string; worldRules: string[]; locations: Array<Pick<SessionState['locations'][number], 'id' | 'name' | 'description' | 'timeOfDay' | 'mood' | 'backgroundPrompt'>> }> { return this.json('Создай мир и 2–3 начальные локации. Поля: title, worldSummary, worldRules, locations.', input) }
  async generateInitialCharacters(input: NewStoryInput & { worldSummary: string }): Promise<Character[]> {
    const result = await this.json<Character[] | { characters: Character[] }>('Создай 2–3 взрослых персонажа. Верни объект {"characters":[...]}. Поля каждого: id,name,ageRange,role,personality,appearance,secret,relationship,emotion,imagePrompt. relationship от -100 до 100.', input)
    const characters = Array.isArray(result) ? result : result.characters
    if (!Array.isArray(characters)) throw new Error('AI вернул персонажей в неверном формате')
    return characters
  }
  async generateStorySkeleton(input: { worldSummary: string; characters: Character[] }): Promise<string[]> { const result = await this.json<{ skeleton: string[] }>('Создай сценарный скелет из 4 оригинальных веток с конфликтами. Верни {"skeleton":[...]}.', input); return result.skeleton }
  generateOpeningScene(input: { worldSummary: string; worldRules: string[]; characters: Character[]; locations: SessionState['locations']; skeleton: string[] }): Promise<Scene> { return this.json('Напиши стартовую сцену с полноценной, но компактной экспозицией (120–180 слов): ясно обозначь, кто игрок в этой ситуации, что уже известно, где он находится, в чём немедленная проблема и что он может попробовать сделать. Экспозицию вплетай в действие, без сухого справочника. playerPrompt — конкретный вопрос или понятная задача игроку на следующий ход, не общая фраза. В dialogue заверши речь прямым обращением/вопросом к игроку. В кадре 1–2 персонажа, только физически присутствующие. Верни все поля Scene. Для первой сцены isImportantChoice=false и needsNewBackground=false. charactersOnScreen — массив id, не имён.', input) }
  generateNextScene(session: SessionState, playerText: string, important: boolean): Promise<Scene> { return this.json('Продолжи сцену после действия игрока. Сцена: 70–130 слов; dialogue: до 35 слов, без пересказа уже известного. playerPrompt — ясный конкретный вопрос или задача для следующего хода игрока; не пиши «ответьте персонажу» без контекста. Проверь возможность действия через логику мира; невозможное обыграй прозой. isImportantChoice=true ТОЛЬКО когда следующий ход действительно необратим или открывает/закрывает ветку; иначе false. needsNewBackground=true ТОЛЬКО при реальном переходе в новую локацию; для той же локации false. characterEmotions указывай только для персонажей, чья эмоция заметно изменилась. Ключ — строго id персонажа; значение — строго одно из neutral, happy, sad, angry, embarrassed, scared, serious. charactersOnScreen — 1–2 id персонажей, которые именно сейчас находятся в кадре; не добавляй весь каст. Верни полный Scene JSON.', { memory: compact(session), playerText, important }) }
  validatePlayerAction(session: SessionState, action: string): Promise<{ possible: boolean; reason: string }> { return this.json('Проверь, допустимо ли действие в ситуации. Верни {possible,reason}.', { memory: compact(session), action }) }
  generateCharacterDialogue(session: SessionState, characterId: string, playerText: string): Promise<Scene> { return this.generateNextScene(session, `${characterId}: ${playerText}`, false) }
  generateLocationBackgroundPrompt(location: SessionState['locations'][number]): Promise<{ prompt: string }> { return this.json('Сделай безопасный лаконичный английский prompt для фоновой иллюстрации visual novel, без текста в кадре. Верни {prompt}.', location) }
  generateCharacterImagePrompt(character: Character): Promise<{ prompt: string }> { return this.json('Сделай безопасный английский prompt для взрослого персонажа visual novel, портрет по пояс, без текста. Верни {prompt}.', character) }
  summarizeSessionMemory(session: SessionState): Promise<{ summary: string }> { return this.json('Кратко обнови память Game Master: факты, отношения, флаги, незакрытые конфликты. Верни {summary}.', compact(session)) }
  async generateImage(prompt: string, key: string, transparent = false): Promise<string> {
    const settings = await this.storage.settings()
    if (!settings.apiKey) throw new Error('OPENAI_API_KEY не настроен')
    const client = new OpenAI({ apiKey: settings.apiKey })
    const options: Record<string, unknown> = { model: settings.imageModel, prompt, size: transparent ? '1024x1536' : '1536x1024', quality: settings.imageQuality, output_format: 'png' }
    // gpt-image-2 currently rejects transparent output; budget image models support it.
    if (transparent && settings.imageModel !== 'gpt-image-2') options.background = 'transparent'
    const result = await client.images.generate(options as any)
    const base64 = result.data?.[0]?.b64_json
    if (!base64) throw new Error('Генератор изображений не вернул данные')
    const path = join(this.storage.assetsPath(), `${key}.png`)
    await writeFile(path, Buffer.from(base64, 'base64'))
    return path
  }
  async editCharacterEmotion(basePath: string, prompt: string, key: string): Promise<string> {
    const settings = await this.storage.settings()
    if (!settings.apiKey) throw new Error('OPENAI_API_KEY не настроен')
    const client = new OpenAI({ apiKey: settings.apiKey })
    const options: Record<string, unknown> = { model: settings.imageModel, image: createReadStream(basePath), prompt, size: '1024x1536', quality: settings.imageQuality, output_format: 'png' }
    if (settings.imageModel !== 'gpt-image-2') options.background = 'transparent'
    const result = await client.images.edit(options as any)
    const base64 = result.data?.[0]?.b64_json
    if (!base64) throw new Error('Редактор портретов не вернул данные')
    const path = join(this.storage.assetsPath(), `${key}.png`)
    await writeFile(path, Buffer.from(base64, 'base64'))
    return path
  }
}

function compact(session: SessionState): object {
  return { worldSummary: session.worldSummary, worldRules: session.worldRules, currentScene: session.currentScene, characters: session.characters.map(({ id, name, personality, secret, relationship, emotion }) => ({ id, name, personality, secret, relationship, emotion })), flags: session.flags, memorySummary: session.memorySummary, recentMessages: session.messages.slice(-16), openBranches: session.openBranches }
}
