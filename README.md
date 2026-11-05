# Калории

[Открыть приложение](https://kolpakov-uz.github.io/kalorii/)

Статическое приложение для дневника питания. Интерфейс находится в `index.html`, браузерные уведомления — в `sw.js`, серверная логика Gemini и push-уведомлений — в `worker/index.js`.

## Публикация

GitHub Pages автоматически публикует корень ветки `main`. Worker `kalorii-ai` публикуется через Wrangler с конфигурацией `worker/wrangler.jsonc`.

На настроенном компьютере из папки репозитория:

```powershell
npm.cmd --prefix worker ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish.ps1 -CheckOnly
```

После проверки и коммита изменений:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish.ps1
```

Скрипт проверяет исходники, собирает Worker без публикации, требует чистую ветку `main`, проверяет удалённую ветку, публикует Worker и отправляет код в GitHub. После завершения нужно дождаться успешной сборки Pages. Публикации Cloudflare и GitHub не являются одной транзакцией: ошибка второго этапа оставляет уже опубликованный Worker.

Для изменения только приложения достаточно проверок, коммита и `git push origin main`; обновление Worker выполняется, когда меняется серверная логика или нужен совместный выпуск.

## Cloudflare

Конфигурация перенесена из действующего Dashboard, включая существующее KV-хранилище `SUBS` и расписание раз в минуту. Секреты `GEMINI_KEY` и `VAPID_KEY` остаются в Cloudflare. `keep_vars` сохраняет дополнительные переменные, заданные в Dashboard.

Авторизация сохранена локально и не включена в репозиторий. На другом компьютере потребуется вход в GitHub и Cloudflare:

```powershell
git credential-manager github login --device --no-ui
cd worker
.\node_modules\.bin\wrangler.cmd login --device --browser=false --use-keyring
```

Дальнейшие изменения Worker следует вносить в репозиторий. Если код или настройки изменены через Dashboard, перед следующим выпуском их нужно сверить с локальными файлами.
