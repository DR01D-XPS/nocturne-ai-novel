"use strict";
const electron = require("electron");
require("dotenv/config");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const promises = require("fs/promises");
const fs = require("fs");
const url = require("url");
const crypto = require("crypto");
const OpenAI = require("openai");
const defaults = {
  apiKey: process.env.OPENAI_API_KEY || "",
  textModel: process.env.DEFAULT_TEXT_MODEL || process.env.TEXT_MODEL_BUDGET || "gpt-4.1-mini",
  imageModel: process.env.DEFAULT_IMAGE_MODEL || process.env.IMAGE_MODEL_BUDGET || "gpt-image-1-mini",
  imageQuality: "low",
  textSpeed: 28,
  uiScale: 1,
  musicVolume: 35,
  fullscreen: false
};
class Storage {
  dataDir;
  sessionsDir;
  assetsDir;
  settingsFile;
  constructor(userData) {
    this.dataDir = path.join(userData, "nocturne-novel");
    this.sessionsDir = path.join(this.dataDir, "sessions");
    this.assetsDir = path.join(this.dataDir, "assets");
    this.settingsFile = path.join(this.dataDir, "settings.json");
  }
  async ready() {
    await Promise.all([promises.mkdir(this.sessionsDir, { recursive: true }), promises.mkdir(this.assetsDir, { recursive: true })]);
  }
  async settings() {
    await this.ready();
    if (!fs.existsSync(this.settingsFile)) return { ...defaults };
    try {
      return { ...defaults, ...JSON.parse(await promises.readFile(this.settingsFile, "utf8")) };
    } catch {
      return { ...defaults };
    }
  }
  async updateSettings(patch) {
    const value = { ...await this.settings(), ...patch };
    await promises.writeFile(this.settingsFile, JSON.stringify(value, null, 2), "utf8");
    return value;
  }
  async publicSettings() {
    const { apiKey, ...safe } = await this.settings();
    return { ...safe, hasApiKey: Boolean(apiKey) };
  }
  async saveSession(session) {
    await this.ready();
    await promises.writeFile(path.join(this.sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf8");
  }
  async getSession(id) {
    await this.ready();
    const file = path.join(this.sessionsDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return normalizeSession(JSON.parse(await promises.readFile(file, "utf8")));
    } catch {
      return null;
    }
  }
  async listSessions() {
    await this.ready();
    const files = (await promises.readdir(this.sessionsDir)).filter((f) => f.endsWith(".json"));
    const sessions = await Promise.all(files.map((file) => this.getSession(file.slice(0, -5))));
    return sessions.filter((x) => Boolean(x)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  assetsPath() {
    return this.assetsDir;
  }
  assetUrl(file) {
    const absolute = path.resolve(file);
    if (!absolute.startsWith(path.resolve(this.assetsDir))) throw new Error("Недопустимый путь к ассету");
    return url.pathToFileURL(absolute).toString();
  }
}
function normalizeSession(value) {
  const session = value;
  const scene = normalizeScene$1(session.currentScene);
  const activeCharacterIds = unwrapList(session.activeCharacterIds, "activeCharacterIds");
  const normalized = {
    ...session,
    characters: unwrapList(session.characters, "characters"),
    locations: unwrapList(session.locations, "locations"),
    messages: unwrapList(session.messages, "messages"),
    assets: unwrapList(session.assets, "assets"),
    saves: unwrapList(session.saves, "saves"),
    activeCharacterIds: activeCharacterIds.length ? activeCharacterIds : scene.charactersOnScreen,
    openBranches: unwrapList(session.openBranches, "openBranches"),
    closedBranches: unwrapList(session.closedBranches, "closedBranches"),
    flags: unwrapList(session.flags, "flags"),
    playerActions: unwrapList(session.playerActions, "playerActions"),
    currentScene: scene
  };
  return normalized;
}
function unwrapList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value[key])) return value[key];
  return [];
}
function normalizeScene$1(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    sceneText: typeof raw.sceneText === "string" ? raw.sceneText : "",
    speaker: typeof raw.speaker === "string" ? raw.speaker : "",
    dialogue: typeof raw.dialogue === "string" ? raw.dialogue : "",
    currentLocation: typeof raw.currentLocation === "string" ? raw.currentLocation : "",
    requiredBackground: typeof raw.requiredBackground === "string" ? raw.requiredBackground : "",
    charactersOnScreen: unwrapList(raw.charactersOnScreen, "charactersOnScreen").filter((x) => typeof x === "string"),
    characterEmotions: raw.characterEmotions && typeof raw.characterEmotions === "object" ? raw.characterEmotions : {},
    isImportantChoice: raw.isImportantChoice === true,
    allowedActionType: typeof raw.allowedActionType === "string" ? raw.allowedActionType : "свободная реплика",
    playerPrompt: typeof raw.playerPrompt === "string" ? raw.playerPrompt : "",
    worldRuleCheck: typeof raw.worldRuleCheck === "string" ? raw.worldRuleCheck : "",
    relationshipChanges: raw.relationshipChanges && typeof raw.relationshipChanges === "object" ? raw.relationshipChanges : {},
    newFlags: unwrapList(raw.newFlags, "newFlags").filter((x) => typeof x === "string"),
    needsNewBackground: raw.needsNewBackground === true,
    needsNewCharacter: raw.needsNewCharacter === true,
    imageGenerationTasks: unwrapList(raw.imageGenerationTasks, "imageGenerationTasks"),
    autosaveNeeded: raw.autosaveNeeded !== false
  };
}
const PORTRAIT_STYLE_VERSION = "transparent-portrait-v2";
const PORTRAIT_ART_DIRECTION = "original dark contemporary visual novel, semi-realistic painted anime, muted cinematic palette, soft rim light, clean detailed linework, cohesive character-design bible, no photorealism";
const SYSTEM = `Ты — Game Master оригинальной русскоязычной AI-визуальной новеллы. Пиши атмосферно, кинематографично, с драмой, бытовыми деталями и недосказанностью. Не копируй существующие игры, персонажей или тексты. Все персонажи — совершеннолетние. Не создавай запрещённый контент. Держи правила мира и характеры устойчивыми. Подача компактная: одна сцена — 70–130 слов прозы, реплика персонажа — 1–3 короткие фразы. Не повторяй экспозицию после стартовой сцены. Отвечай только валидным JSON без markdown.`;
function cleanJson(raw) {
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Ответ модели не содержит JSON");
  return fenced.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
}
class OpenAIStoryService {
  constructor(storage) {
    this.storage = storage;
  }
  async json(task, payload) {
    const settings = await this.storage.settings();
    if (!settings.apiKey) throw new Error("OPENAI_API_KEY не настроен");
    const client = new OpenAI({ apiKey: settings.apiKey });
    const prompt = `${SYSTEM}

Задача: ${task}
Данные:
${JSON.stringify(payload)}
JSON:`;
    let raw = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.responses.create({ model: settings.textModel, input: prompt, text: { format: { type: "json_object" } } });
        raw = response.output_text;
        return JSON.parse(cleanJson(raw));
      } catch (error) {
        if (attempt === 1) throw new Error(`Не удалось получить корректный JSON от AI: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error("AI не вернул ответ");
  }
  generateWorld(input) {
    return this.json("Создай мир и 2–3 начальные локации. Поля: title, worldSummary, worldRules, locations.", input);
  }
  async generateInitialCharacters(input) {
    const result = await this.json('Создай 2–3 взрослых персонажа. Верни объект {"characters":[...]}. Поля каждого: id,name,ageRange,role,personality,appearance,secret,relationship,emotion,imagePrompt. relationship от -100 до 100.', input);
    const characters = Array.isArray(result) ? result : result.characters;
    if (!Array.isArray(characters)) throw new Error("AI вернул персонажей в неверном формате");
    return characters;
  }
  async generateStorySkeleton(input) {
    const result = await this.json('Создай сценарный скелет из 4 оригинальных веток с конфликтами. Верни {"skeleton":[...]}.', input);
    return result.skeleton;
  }
  generateOpeningScene(input) {
    return this.json("Напиши стартовую сцену с полноценной, но компактной экспозицией (120–180 слов): ясно обозначь, кто игрок в этой ситуации, что уже известно, где он находится, в чём немедленная проблема и что он может попробовать сделать. Экспозицию вплетай в действие, без сухого справочника. playerPrompt — конкретный вопрос или понятная задача игроку на следующий ход, не общая фраза. В dialogue заверши речь прямым обращением/вопросом к игроку. В кадре 1–2 персонажа, только физически присутствующие. Верни все поля Scene. Для первой сцены isImportantChoice=false и needsNewBackground=false. charactersOnScreen — массив id, не имён.", input);
  }
  generateNextScene(session, playerText, important) {
    return this.json("Продолжи сцену после действия игрока. Сцена: 70–130 слов; dialogue: до 35 слов, без пересказа уже известного. playerPrompt — ясный конкретный вопрос или задача для следующего хода игрока; не пиши «ответьте персонажу» без контекста. Проверь возможность действия через логику мира; невозможное обыграй прозой. isImportantChoice=true ТОЛЬКО когда следующий ход действительно необратим или открывает/закрывает ветку; иначе false. needsNewBackground=true ТОЛЬКО при реальном переходе в новую локацию; для той же локации false. characterEmotions указывай только для персонажей, чья эмоция заметно изменилась. Ключ — строго id персонажа; значение — строго одно из neutral, happy, sad, angry, embarrassed, scared, serious. charactersOnScreen — 1–2 id персонажей, которые именно сейчас находятся в кадре; не добавляй весь каст. Верни полный Scene JSON.", { memory: compact(session), playerText, important });
  }
  validatePlayerAction(session, action) {
    return this.json("Проверь, допустимо ли действие в ситуации. Верни {possible,reason}.", { memory: compact(session), action });
  }
  generateCharacterDialogue(session, characterId, playerText) {
    return this.generateNextScene(session, `${characterId}: ${playerText}`, false);
  }
  generateLocationBackgroundPrompt(location) {
    return this.json("Сделай безопасный лаконичный английский prompt для фоновой иллюстрации visual novel, без текста в кадре. Верни {prompt}.", location);
  }
  generateCharacterImagePrompt(character) {
    return this.json("Сделай безопасный английский prompt для взрослого персонажа visual novel, портрет по пояс, без текста. Верни {prompt}.", character);
  }
  summarizeSessionMemory(session) {
    return this.json("Кратко обнови память Game Master: факты, отношения, флаги, незакрытые конфликты. Верни {summary}.", compact(session));
  }
  async generateImage(prompt, key, transparent = false) {
    const settings = await this.storage.settings();
    if (!settings.apiKey) throw new Error("OPENAI_API_KEY не настроен");
    const client = new OpenAI({ apiKey: settings.apiKey });
    const options = { model: settings.imageModel, prompt, size: transparent ? "1024x1536" : "1536x1024", quality: settings.imageQuality, output_format: "png" };
    if (transparent && settings.imageModel !== "gpt-image-2") options.background = "transparent";
    const result = await client.images.generate(options);
    const base64 = result.data?.[0]?.b64_json;
    if (!base64) throw new Error("Генератор изображений не вернул данные");
    const path$1 = path.join(this.storage.assetsPath(), `${key}.png`);
    await promises.writeFile(path$1, Buffer.from(base64, "base64"));
    return path$1;
  }
  async editCharacterEmotion(basePath, prompt, key) {
    const settings = await this.storage.settings();
    if (!settings.apiKey) throw new Error("OPENAI_API_KEY не настроен");
    const client = new OpenAI({ apiKey: settings.apiKey });
    const options = { model: settings.imageModel, image: fs.createReadStream(basePath), prompt, size: "1024x1536", quality: settings.imageQuality, output_format: "png" };
    if (settings.imageModel !== "gpt-image-2") options.background = "transparent";
    const result = await client.images.edit(options);
    const base64 = result.data?.[0]?.b64_json;
    if (!base64) throw new Error("Редактор портретов не вернул данные");
    const path$1 = path.join(this.storage.assetsPath(), `${key}.png`);
    await promises.writeFile(path$1, Buffer.from(base64, "base64"));
    return path$1;
  }
}
function compact(session) {
  return { worldSummary: session.worldSummary, worldRules: session.worldRules, currentScene: session.currentScene, characters: session.characters.map(({ id, name, personality, secret, relationship, emotion }) => ({ id, name, personality, secret, relationship, emotion })), flags: session.flags, memorySummary: session.memorySummary, recentMessages: session.messages.slice(-16), openBranches: session.openBranches };
}
class StoryService {
  constructor(storage, progress) {
    this.storage = storage;
    this.progress = progress;
    this.ai = new OpenAIStoryService(storage);
  }
  ai;
  say(stage, detail, percent) {
    this.progress({ stage, detail, percent });
  }
  async create(input) {
    this.say("Создаём мир", "Собираем правила и первые локации…", 12);
    let session;
    try {
      const world = await this.ai.generateWorld(input);
      this.say("Готовим персонажей", "Ищем их слабости и недосказанности…", 35);
      const characters = await this.ai.generateInitialCharacters({ ...input, worldSummary: world.worldSummary });
      this.say("Прокладываем ветви", "Намечаем последствия…", 58);
      const skeleton = await this.ai.generateStorySkeleton({ worldSummary: world.worldSummary, characters });
      this.say("Пишем первую сцену", "Зажигается свет в первой локации…", 78);
      const scene = await this.ai.generateOpeningScene({ worldSummary: world.worldSummary, worldRules: world.worldRules, characters, locations: world.locations, skeleton });
      session = this.assemble(input, world.title, world.worldSummary, world.worldRules, characters, world.locations, skeleton, scene);
      await this.generateOpeningBackground(session);
      await this.generateCharacterPortraits(session);
    } catch (error) {
      session = this.fallback(input, error instanceof Error ? error.message : "AI временно недоступен");
    }
    this.say("Сохраняем историю", "Первое автосохранение готово.", 96);
    await this.storage.saveSession(session);
    this.say("Готово", "Сцена открыта.", 100);
    return session;
  }
  async continue(id, text, important) {
    const session = await this.require(id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    session.messages.push({ id: crypto.randomUUID(), kind: "player", text, createdAt: now });
    session.playerActions.push({ text, important, createdAt: now });
    try {
      const next = await this.ai.generateNextScene(session, text, important);
      const locationChanged = this.applyScene(session, next);
      if (locationChanged && next.needsNewBackground) await this.generateOpeningBackground(session);
      if (session.messages.length % 8 === 0) session.memorySummary = (await this.ai.summarizeSessionMemory(session)).summary;
    } catch (error) {
      this.applyScene(session, this.fallbackNext(session, text, important, error instanceof Error ? error.message : "сбой"));
    }
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await this.storage.saveSession(session);
    return session;
  }
  async save(id, label = "Ручное сохранение") {
    const session = await this.require(id);
    const snapshot = structuredClone(session);
    snapshot.saves = [];
    session.saves.unshift({ id: crypto.randomUUID(), label, createdAt: (/* @__PURE__ */ new Date()).toISOString(), scenePreview: session.currentScene.sceneText.slice(0, 100), locationName: this.location(session).name, snapshot });
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await this.storage.saveSession(session);
    return session;
  }
  async prepareAssets(id) {
    const session = await this.require(id);
    const settings = await this.storage.settings();
    const outdated = session.characters.some((character) => character.portraitStyle !== PORTRAIT_STYLE_VERSION);
    if (outdated && settings.apiKey) {
      await this.generateCharacterPortraits(session, true, false);
      session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.storage.saveSession(session);
    }
    return session;
  }
  async restore(sessionId, saveId) {
    const session = await this.require(sessionId);
    const slot = session.saves.find((s) => s.id === saveId);
    if (!slot) throw new Error("Сохранение не найдено");
    const restored = structuredClone(slot.snapshot);
    restored.saves = session.saves;
    restored.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await this.storage.saveSession(restored);
    return restored;
  }
  assemble(input, title, worldSummary, worldRules, characters, locations, storySkeleton, currentScene) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const safeScene = normalizeScene(currentScene);
    const location = locations.find((x) => x.name === safeScene.currentLocation) || locations[0];
    return { id: crypto.randomUUID(), title, ...input, worldSummary, worldRules, storySkeleton, currentScene: safeScene, currentLocationId: location?.id || "", activeCharacterIds: safeScene.charactersOnScreen, characters, locations, openBranches: storySkeleton.slice(0, 2), closedBranches: [], flags: safeScene.newFlags, playerActions: [], messages: sceneMessages(safeScene), memorySummary: "История только началась.", assets: [], saves: [], createdAt: now, updatedAt: now };
  }
  applyScene(session, scene) {
    const safeScene = normalizeScene(scene, session.currentScene);
    const previousLocationId = session.currentLocationId;
    session.currentScene = safeScene;
    const location = session.locations.find((x) => x.name === safeScene.currentLocation);
    if (location) session.currentLocationId = location.id;
    session.activeCharacterIds = safeScene.charactersOnScreen;
    session.flags = [.../* @__PURE__ */ new Set([...session.flags, ...safeScene.newFlags])];
    for (const char of session.characters) {
      const requestedEmotion = emotionForCharacter(safeScene.characterEmotions, char);
      if (requestedEmotion) char.emotion = requestedEmotion;
      const relationshipDelta = numberForCharacter(safeScene.relationshipChanges, char);
      if (relationshipDelta) char.relationship += relationshipDelta;
    }
    session.messages.push(...sceneMessages(safeScene));
    return previousLocationId !== session.currentLocationId;
  }
  async generateOpeningBackground(session) {
    const location = this.location(session);
    if (location.backgroundPath) return;
    this.say("Создаём фон", "Пока свет собирается в кадр…", 82);
    try {
      const prompt = (await this.ai.generateLocationBackgroundPrompt(location)).prompt;
      const path2 = await this.ai.generateImage(prompt, `bg-${session.id}-${location.id}`);
      location.backgroundPath = path2;
      session.assets.push({ id: crypto.randomUUID(), kind: "background", label: location.name, path: path2, prompt, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch {
    }
  }
  async generateCharacterPortraits(session, refresh = false, announce = true) {
    const emotions = ["neutral", "happy", "sad", "angry", "embarrassed", "scared", "serious"];
    const total = session.characters.length * emotions.length;
    let completed = 0;
    for (const character of session.characters) {
      if (refresh) {
        character.portraitPaths = {};
        character.portraitPath = void 0;
      }
      character.portraitPaths ||= {};
      for (const emotion of emotions) {
        if (character.portraitPaths[emotion]) {
          completed++;
          continue;
        }
        if (announce) this.say("Готовим портреты", `${character.name}: ${emotion}`, 82 + Math.round(completed / Math.max(total, 1) * 13));
        const prompt = `Adult visual novel character sprite, three-quarter body, ${character.imagePrompt}. Visual anchor: ${character.appearance}. Expression: ${emotion}. ${PORTRAIT_ART_DIRECTION}. Isolated character on a fully transparent background, no scenery, no room, no landscape, no props behind the person, no frame, no text, no cast shadow. Keep the exact same adult person, hairstyle, clothing, accessories and proportions.`;
        try {
          const key = `char-${session.id}-${character.id}-${emotion}-${PORTRAIT_STYLE_VERSION}`;
          const neutralPath = character.portraitPaths.neutral;
          const path2 = emotion !== "neutral" && neutralPath ? await this.ai.editCharacterEmotion(neutralPath, `Edit only the facial expression of this exact character to ${emotion}. Preserve the character identity, pose, outfit, transparent background, framing and ${PORTRAIT_ART_DIRECTION}.`, key) : await this.ai.generateImage(prompt, key, true);
          character.portraitPaths[emotion] = path2;
          if (emotion === "neutral") character.portraitPath = path2;
          session.assets.push({ id: crypto.randomUUID(), kind: "character", label: `${character.name} — ${emotion}`, path: path2, prompt, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
        } catch {
        }
        completed++;
      }
      if (Object.keys(character.portraitPaths).length > 0) character.portraitStyle = PORTRAIT_STYLE_VERSION;
    }
  }
  location(session) {
    return session.locations.find((x) => x.id === session.currentLocationId) || session.locations[0];
  }
  async require(id) {
    const value = await this.storage.getSession(id);
    if (!value) throw new Error("История не найдена");
    return value;
  }
  fallback(input, reason) {
    const locations = [{ id: "pier", name: "Старый пирс", description: "Влажные доски, тусклый маяк и вода, в которой не видно дна.", timeOfDay: "сумерки", mood: "тревожное ожидание", backgroundPrompt: "rainy sea pier at twilight, cinematic visual novel background, no text" }];
    const characters = [{ id: "mira", name: "Мира Вельская", ageRange: "24–29", role: "смотрительница маяка", personality: "Резкая, наблюдательная, не терпит пустых обещаний.", appearance: "Тёмная куртка, мокрые волосы, серебряная серьга в форме рыбьей кости.", secret: "Она знает, кто оставляет свет в маяке после полуночи.", relationship: 0, emotion: "serious", imagePrompt: "adult lighthouse keeper, dark jacket, visual novel portrait" }, { id: "lev", name: "Лев Ордынцев", ageRange: "26–33", role: "приезжий фотограф", personality: "Ироничный, осторожный, слишком часто прячет руки в карманы.", appearance: "Выцветшая рубашка, старый фотоаппарат на ремне.", secret: "На его плёнке есть снимок, сделанный до приезда в город.", relationship: 0, emotion: "neutral", imagePrompt: "adult photographer, old camera, visual novel portrait" }];
    const scene = { sceneText: `Сумерки сгущаются над пирсом. Солёная вода щёлкает по сваям, как кто-то, кому не открывают дверь. На дальнем маяке на секунду вспыхивает свет — хотя здесь уверяют, что он давно не работает.`, speaker: "Мира Вельская", dialogue: "Если пришли смотреть на море — поздно. Оно сегодня смотрит в ответ.", currentLocation: "Старый пирс", requiredBackground: "pier", charactersOnScreen: ["mira"], characterEmotions: { mira: "serious" }, isImportantChoice: false, allowedActionType: "свободная реплика", worldRuleCheck: "Мир подчиняется бытовой логике, но море хранит старые долги.", relationshipChanges: {}, newFlags: ["маяк_зажёгся"], needsNewBackground: false, needsNewCharacter: false, imageGenerationTasks: [], autosaveNeeded: true };
    const session = this.assemble(input, "Там, где не гаснет свет", `В прибрежном городке люди привыкли не задавать вопросов о маяке. ${reason.includes("OPENAI") ? "История запущена в локальном режиме: добавьте ключ в настройках, чтобы включить генерацию." : "AI временно недоступен; локальный рассказчик продолжит историю."}`, ["Невозможное не случается без цены.", "У каждого есть причина молчать.", "События оставляют след."], characters, locations, ["Узнать, почему загорается маяк.", "Решить, кому из незнакомцев верить.", "Найти связь между плёнкой и морем."], scene);
    return session;
  }
  fallbackNext(session, text, important, reason) {
    const activeIds = Array.isArray(session.activeCharacterIds) ? session.activeCharacterIds : [];
    const characters = Array.isArray(session.characters) ? session.characters : [];
    const speaker = characters.find((c) => activeIds.includes(c.id)) || characters[0];
    const name = speaker?.name || "Незнакомец";
    return normalizeScene({ ...session.currentScene, sceneText: `Ваши слова — «${text}» — растворяются между ветром и водой. ${name} не отвечает сразу: смотрит туда, где маяк снова на миг режет туман белой полосой. В этой паузе становится ясно: город услышал вас.`, speaker: name, dialogue: important ? "Красивое решение. Но красивые решения чаще всего дорого обходятся." : "Не торопитесь. Здесь поспешность умеет возвращаться.", isImportantChoice: important || session.messages.length % 4 === 0, allowedActionType: important ? "свободное важное действие" : "свободная реплика", relationshipChanges: speaker && text.includes("спасибо") ? { [speaker.id]: 2 } : {}, newFlags: important ? [`выбор_${session.playerActions.length}`] : [], autosaveNeeded: true, worldRuleCheck: `Локальный рассказчик: ${reason}` }, session.currentScene);
  }
}
function sceneMessages(scene) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = [{ id: crypto.randomUUID(), kind: "narration", text: scene.sceneText, createdAt: now }];
  if (scene.dialogue) result.push({ id: crypto.randomUUID(), kind: "dialogue", speaker: scene.speaker, text: scene.dialogue, createdAt: now });
  return result;
}
function normalizeScene(value, previous) {
  const fallback = previous || { sceneText: "", speaker: "", dialogue: "", currentLocation: "", requiredBackground: "", charactersOnScreen: [], characterEmotions: {}, isImportantChoice: false, allowedActionType: "свободная реплика", playerPrompt: "", worldRuleCheck: "", relationshipChanges: {}, newFlags: [], needsNewBackground: false, needsNewCharacter: false, imageGenerationTasks: [], autosaveNeeded: true };
  return { ...fallback, ...value, charactersOnScreen: Array.isArray(value.charactersOnScreen) ? value.charactersOnScreen.filter((x) => typeof x === "string") : fallback.charactersOnScreen, characterEmotions: value.characterEmotions && typeof value.characterEmotions === "object" ? value.characterEmotions : fallback.characterEmotions, relationshipChanges: value.relationshipChanges && typeof value.relationshipChanges === "object" ? value.relationshipChanges : {}, newFlags: Array.isArray(value.newFlags) ? value.newFlags.filter((x) => typeof x === "string") : [], imageGenerationTasks: Array.isArray(value.imageGenerationTasks) ? value.imageGenerationTasks : [], isImportantChoice: value.isImportantChoice === true, needsNewBackground: value.needsNewBackground === true, needsNewCharacter: value.needsNewCharacter === true, autosaveNeeded: value.autosaveNeeded !== false };
}
function emotionForCharacter(changes, character) {
  const raw = changes[character.id] ?? changes[character.name] ?? changes[character.name.toLowerCase()];
  return raw ? normalizeEmotion(raw) : void 0;
}
function numberForCharacter(changes, character) {
  return changes[character.id] ?? changes[character.name] ?? changes[character.name.toLowerCase()];
}
function normalizeEmotion(value) {
  const text = String(value).toLowerCase();
  if (["neutral", "happy", "sad", "angry", "embarrassed", "scared", "serious"].includes(text)) return text;
  if (/рад|улыб|счаст/.test(text)) return "happy";
  if (/гнев|зл|ярост/.test(text)) return "angry";
  if (/груст|печал|тоск/.test(text)) return "sad";
  if (/смущ|неловк/.test(text)) return "embarrassed";
  if (/страх|тревог|растер|испуг/.test(text)) return "scared";
  if (/решим|серьез|серьёз|насторож/.test(text)) return "serious";
  return "neutral";
}
function registerNovelHandlers(progress) {
  const storage = new Storage(electron.app.getPath("userData"));
  const story = new StoryService(storage, progress);
  electron.ipcMain.handle("novel:create", (_, input) => story.create(input));
  electron.ipcMain.handle("novel:continue", (_, id, text, important) => story.continue(id, text, important));
  electron.ipcMain.handle("novel:list", () => storage.listSessions());
  electron.ipcMain.handle("novel:get", (_, id) => storage.getSession(id));
  electron.ipcMain.handle("novel:prepare-assets", (_, id) => story.prepareAssets(id));
  electron.ipcMain.handle("novel:save", (_, id, label) => story.save(id, label));
  electron.ipcMain.handle("novel:restore", (_, sessionId, saveId) => story.restore(sessionId, saveId));
  electron.ipcMain.handle("novel:settings:get", () => storage.publicSettings());
  electron.ipcMain.handle("novel:settings:update", (_, settings) => storage.updateSettings(settings).then(() => storage.publicSettings()));
  electron.ipcMain.handle("novel:asset:url", (_, path2) => storage.assetUrl(path2));
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#10101b",
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.setMenuBarVisibility(false);
  if (utils.is.dev && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}
electron.app.whenReady().then(() => {
  registerNovelHandlers((progress) => mainWindow?.webContents.send("novel:progress", progress));
  electron.ipcMain.handle("novel:fullscreen", () => {
    const next = !mainWindow?.isFullScreen();
    mainWindow?.setFullScreen(next);
    return next;
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
