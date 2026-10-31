# Nocturne — AI Visual Novel

Рабочий desktop MVP интерактивной русскоязычной визуальной новеллы. Игрок задаёт тему, получает оригинальный мир и сцену, отвечает свободным текстом или описывает важное действие. История ведёт локальную память, автосохранения, журнал отношений/флагов и галерею ассетов.

## Запуск

```bash
npm install
copy .env.example .env
npm run dev
```

На macOS/Linux вместо `copy` используйте `cp .env.example .env`. Без ключа приложение запускает полностью проходимую локальную fallback-историю: интерфейс, свободный ввод, последствия и сохранения работают. Добавьте ключ, чтобы включить генерацию мира, сцен и фонов через OpenAI.

## Переменные окружения

```env
OPENAI_API_KEY=sk-...
TEXT_MODEL_BUDGET=gpt-4.1-mini
TEXT_MODEL_QUALITY=gpt-4.1
IMAGE_MODEL_BUDGET=gpt-image-1-mini
IMAGE_MODEL_QUALITY=gpt-image-2
DEFAULT_TEXT_MODEL=gpt-4.1-mini
DEFAULT_IMAGE_MODEL=gpt-image-1-mini
```

Модели также можно поменять в настройках приложения. Настройки и сессии сохраняются в Electron `userData/nocturne-novel`; API-ключ не передаётся в React UI и не возвращается через IPC. Не коммитьте `.env`.

## Что реализовано

- Electron + React + TypeScript + Vite (`electron-vite`), строгий `contextIsolation` и allow-list IPC.
- Сессия с правилами мира, персонажами, сценами, ветками, отношениями, флагами, журналом и ручными/автосохранениями.
- OpenAI service с отдельными вызовами `generateWorld`, `generateInitialCharacters`, `generateStorySkeleton`, `generateOpeningScene`, `generateNextScene`, `validatePlayerAction`, `generateCharacterDialogue`, `generateLocationBackgroundPrompt`, `generateCharacterImagePrompt`, `summarizeSessionMemory`.
- JSON-only ответы, повтор при некорректном JSON и локальная fallback-сцена при сетевой/API ошибке.
- Компактная память для API: summary, правила, текущая сцена, персонажи, флаги и последние 16 сообщений. Полная история остаётся локально.
- Кэш ассетов: фон локации создаётся только при необходимости, сохраняется в userData и доступен из галереи.
- Экран ожидания с canvas-мини-игрой, прогрессом стадий и мягкими визуальными переходами.

## Структура

```text
src/main                 Electron window + IPC handlers
src/preload              безопасный мост renderer ↔ main
src/renderer             React-экраны и стили
src/shared               единые TypeScript-типы
src/services/openai      OpenAI SDK и JSON recovery
src/services/storage     JSON-сессии, настройки, ассеты
src/services/story       игровой цикл, fallback и автосохранение
```

## Проверка и сборка

```bash
npm run typecheck
npm run build
```

`npm run build` собирает production-ресурсы. Для установки приложения в ОС можно добавить `electron-builder` или другой упаковщик, не меняя игровой код.
