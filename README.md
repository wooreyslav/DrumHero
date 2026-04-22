# 🥁 Drum Hero

MIDI drum trainer с хранением треков в Supabase. PWA — устанавливается на Android/iOS.

## Структура файлов

```
drumhero/
├── index.html     ← Основной файл (UI + логика)
├── player.js      ← Движок: канвас, рендер, воспроизведение
├── midi.js        ← Парсер MIDI файлов
├── db.js          ← Supabase: база + storage
├── config.js      ← URL и ключ Supabase
├── sw.js          ← Service Worker (офлайн кэш)
├── manifest.json  ← PWA манифест
└── icons/
    ├── icon-192.png   ← Нужно создать!
    └── icon-512.png   ← Нужно создать!
```

## Деплой на GitHub Pages

```bash
git init
git add .
git commit -m "init drum hero"
git branch -M main
git remote add origin https://github.com/USERNAME/drum-hero.git
git push -u origin main
```

GitHub → Settings → Pages → Source: **main / root** → Save

URL приложения: `https://USERNAME.github.io/drum-hero/`

## Иконки PWA (нужны для установки)

Создай два PNG файла и положи в папку `icons/`:
- `icon-192.png` — 192×192 px
- `icon-512.png` — 512×512 px

Можно сгенерировать на: https://favicon.io/favicon-generator/

## Добавление трека (через приложение)

1. Открой приложение → вкладка **ADD TRACK**
2. Введи название и исполнителя
3. Выбери MP3/WAV файл и MIDI файл
4. Нажми **ЗАГРУЗИТЬ В SUPABASE**
5. BPM и длительность определяются автоматически
6. Трек появится в LIBRARY

## MIDI Map

По умолчанию настроен под GGD Metal.
Изменить можно в вкладке **MIDI MAP** — ввести номера нот через запятую.

| Инструмент | Ноты (GGD Metal) |
|------------|-----------------|
| Kick       | 36, 35          |
| Snare      | 38, 40, 37      |
| HH Closed  | 42, 22          |
| HH Open    | 46, 26          |
| HH Foot    | 44              |
| Ride       | 51, 59, 53      |
| Crash      | 49, 57, 55      |
| Tom 1      | 48, 50          |
| Tom 2      | 45, 47          |
| China      | 52              |

## Supabase Storage Policy

Если загрузка не работает, проверь Storage → Policies в Supabase:
Bucket `tracks` должен иметь политику INSERT для `anon` роли.

```sql
CREATE POLICY "Allow public uploads" ON storage.objects
FOR INSERT TO anon WITH CHECK (bucket_id = 'tracks');

CREATE POLICY "Allow public reads" ON storage.objects
FOR SELECT TO anon USING (bucket_id = 'tracks');

CREATE POLICY "Allow public deletes" ON storage.objects
FOR DELETE TO anon USING (bucket_id = 'tracks');
```
