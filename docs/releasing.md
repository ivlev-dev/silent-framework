# Версионирование и релизы

## Правила semver

Проект находится в стадии `0.x`. В `0.x`-линейке принято:

| Тип изменения | Какая цифра меняется | Пример |
|---|---|---|
| Ломающее изменение публичного API | вторая (`minor`) | `0.6.0` → `0.7.0` |
| Новая функциональность | вторая (`minor`) | `0.6.0` → `0.7.0` |
| Исправления, производительность, внутренний рефакторинг без изменения публичного API | третья (`patch`) | `0.6.0` → `0.6.1` |

Правило про третью цифру фиксируется явно: патч-версии обязательны. Рефакторинг и оптимизация без изменения публичного API не требуют `minor` — достаточно `patch`. Например, рефакторинг и оптимизация без изменения публичного API: `0.6.0` → `0.6.1`.

## Версии и зависимости

- Версия одна на все пакеты `@ivlev-dev/silent*` и `Cargo.toml`; рассинхрон не допускается.
- Внутренние зависимости библиотечных пакетов (`core`, `server`, `router`, `form` и др.) объявлены как `peerDependencies` с диапазоном `>=0.X.0 <0.(X+1).0`; для локальной разработки те же пакеты продублированы в `devDependencies` со значением `workspace:*`.
- Метапакет `@ivlev-dev/silent` держит в `dependencies` шесть пакетов (core, di, reactivity, router, swc, vite) с диапазоном `>=0.X.0 <0.(X+1).0`. `server`, `validation`, `validation-vite` и `form` устанавливаются отдельно.
- Диапазон описывает всю текущую `0.X`-линейку: патч-релизы (`0.X.Y`) совместимы между собой, а `minor` (`0.(X+1).0`) требует согласованного обновления.
- `pnpm version:bump` обновляет поле `version`, диапазоны внутренних зависимостей и peer-зависимостей в манифестах, затем запускает `pnpm install --lockfile-only`, чтобы `pnpm-lock.yaml` не разошёлся с манифестами.

## Пошаговый релиз

1. Определить тип изменения и нужную цифру.
2. Поднять версию синхронно во всех пакетах и `Cargo.toml`:

   ```bash
   pnpm version:bump patch   # или minor / major
   ```

   Скрипт обновляет 11 `package.json` (`reactivity`, `di`, `core`, `swc`, `vite`, `server`, `router`, `validation`, `validation-vite`, `form`, `silent`), диапазоны внутренних зависимостей, `[workspace.package] version` в `Cargo.toml`, `pnpm-lock.yaml` (через `pnpm install --lockfile-only`) и переносит заметки из `## Unreleased` в новый раздел `## X.Y.Z`, оставляя `## Unreleased` пустым. Если `pnpm` не найден или обновление lockfile упало, скрипт завершается ошибкой — выполните `pnpm install --lockfile-only` вручную и проверьте `git diff pnpm-lock.yaml`. После этого обновите `Cargo.lock` командой `cargo check -p silent-transform`.

   Для точечной установки версии и проверки без изменений:

   ```bash
   node scripts/version.mjs --set X.Y.Z --dry-run
   ```

3. Проверить diff:

   ```bash
   git diff
   ```

4. Дополнить раздел новой версии в `CHANGELOG.md` списком изменений.
5. Закоммитить:

   ```bash
   git add -A
   git commit -m "chore(release): vX.Y.Z"
   ```

6. Поставить тег и запушить:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

7. Что делает CI (`.github/workflows/release.yml`, запуск по тегу `v*`):
   - проверяет совпадение тега с версиями всех 13 пакетов и что `pnpm-lock.yaml` не разошёлся с диапазонами (`pnpm version:check`);
   - собирает нативные бинарники для Linux x64 (`x86_64-unknown-linux-gnu`) и Windows x64 (`x86_64-pc-windows-msvc`); остальные платформы требуют локальной сборки;
   - прогоняет `build`, `typecheck`, `cargo fmt`, `cargo test`, `pnpm test`, `pnpm api:check`, `pnpm pack:check`, `pnpm install:check`;
   - публикует пакеты в npm (требуется секрет `NPM_TOKEN`);
   - проверяет, что все 13 пакетов имеют опубликованную версию (`pnpm published:check`; до 30 попыток по 15 с — npm отдаёт обновление не сразу). `dist-tag` `latest` не проверяется, а только печатается в логе рядом с версией.

   Параметры `published:check` задаются переменными окружения: `PUBLISH_ATTEMPTS` (по умолчанию `30`), `PUBLISH_DELAY_MS` (пауза между попытками, `15000`) и `PUBLISH_TIMEOUT_MS` (таймаут запроса к реестру, `15000`).

## Чек-лист релиза

- [ ] `pnpm version:check` зелёный (версии пакетов, `Cargo.toml` и `pnpm-lock.yaml` согласованы).
- [ ] `pnpm install --frozen-lockfile` проходит после bump.
- [ ] `git diff pnpm-lock.yaml` содержит только ожидаемые изменения диапазонов.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test` зелёные.
- [ ] `pnpm api:check` и `pnpm api:check:self` зелёные.
- [ ] `pnpm pack:check` и `pnpm install:check` проходят, включая subpath `@ivlev-dev/silent-server/pool`.
- [ ] `pnpm test:ssr-pool` зелёный (воркер-пул SSR).
- [ ] `pnpm test:ssr` и `pnpm test:e2e` зелёные.
- [ ] `core` и `server` выпускаются парой: сервер импортирует внутренний subpath core (`@ivlev-dev/silent-core/runtime-context-provider`), одного совпадения peer-диапазона недостаточно.

## Протокол

Пакеты `@ivlev-dev/silent-protocol` и `@ivlev-dev/silent-protocol-vite` публикуются в npm вместе с остальными (`pnpm -r publish`). Rust-крейты `silent-protocol`/`silent-protocol-macros` и Kotlin-артефакты `dev.ivlev.silent:silent-protocol`/`silent-protocol-ksp` в этот workflow не входят:

- Rust: `cargo publish -p silent-protocol-macros` затем `cargo publish -p silent-protocol` (нужен `CARGO_REGISTRY_TOKEN`; координаты проверяются отдельно).
- Kotlin: `cd kotlin && gradle :protocol:publishToMavenLocal` для локальной проверки; для Maven Central нужны OSSRH/Central Portal, GPG-подпись и sources/javadoc (см. `kotlin/README.md`).

Версия Kotlin задаётся в `kotlin/gradle.properties` (`protocolVersion`) и должна совпадать с версией пакетов.

## Требования к релизу

- Версия одна во всех 13 пакетах `packages/{core,di,reactivity,server,router,validation,validation-vite,protocol,protocol-vite,form,silent,swc,vite}/package.json` и в `Cargo.toml` (`[workspace.package] version`).
- `pnpm-lock.yaml` обновлён тем же bump'ом и проходит `pnpm install --frozen-lockfile`.
- `pnpm version:check` зелёный.
- `pnpm api:check` зелёный.
- Тег имеет вид `vX.Y.Z` и совпадает с версией в пакетах.

## Частые ошибки

- Подняли `minor` вместо `patch` для изменений производительности или рефакторинга без изменения публичного API.
- Забыли обновить версию в `Cargo.toml`.
- Забыли закоммитить `pnpm-lock.yaml` после bump — `pnpm install --frozen-lockfile` в release CI падает.
- Тег не совпадает с версией в `package.json` (CI прервёт релиз).
- Обновили не все 13 пакетов или часть версий осталась старой.
- Забыли пересчитать диапазоны `>=0.X.0 <0.(X+1).0` после `minor`-бампа (это делает `pnpm version:bump`).
- Выпустили `server` без парного `core` (или наоборот): сервер использует внутренний subpath core, которого может не быть в опубликованной версии.
