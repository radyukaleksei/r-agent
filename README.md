# Site Network Agent

Веб-агент для исследования технических взаимосвязей между сайтами:
поиск по ключевым словам → анализ технической инфраструктуры (GTM, tracking
ID, скрипты, внешние домены, endpoints) → поиск сайтов с похожей
инфраструктурой → построение графа связей и кластеров.

> Результат кластеризации — это гипотеза, а не обвинение. Интерфейс и API
> всегда используют формулировку **«Potentially related infrastructure»**;
> окончательный вывод о природе связи делает пользователь.

## 1. Архитектура

```
                    INTERNET
                       │
                       ▼
                ┌─────────────┐
                │   Vercel    │  apps/web (Next.js)
                │             │  — UI, auth, API routes, создание jobs
                └──────┬──────┘
                       │ create job (Firestore)
             ┌─────────┴──────────┐
             ▼                    ▼
      ┌─────────────┐      ┌─────────────────┐
      │  Firebase   │◄────►│  Browser Worker  │  services/browser-worker
      │ Auth        │      │  Cloud Run       │  — Playwright, анализаторы,
      │ Firestore   │      │  Playwright      │    job runner (polling)
      └─────────────┘      └─────────────────┘
```

Разделение ответственности:

| Компонент | Где | Отвечает за |
|---|---|---|
| **apps/web** | Vercel | UI, Firebase Auth, валидация запросов, создание `AnalysisJob`, чтение статусов/результатов |
| **Firebase** | — | Auth, Firestore (данные), Security Rules |
| **browser-worker** | Cloud Run | Playwright-навигация, все анализаторы (GTM/domains/tracking/fingerprint), Google Search, запись результатов обратно в Firestore |
| **packages/types** | — | Общие TS-типы (единый источник истины для схемы Firestore) |
| **packages/shared** | — | SSRF-защита, normalize URL, similarity scoring, кластеризация — переиспользуются web и worker |

Почему так: HTTP-запрос к Vercel обязан быстро вернуть ответ (иначе timeout
serverless-функции), а анализ одного сайта — секунды, анализ 50 сайтов —
минуты. Поэтому Vercel только **создаёт задачу** в Firestore и сразу
отвечает `202 Accepted`; всю тяжёлую работу с браузером делает отдельный
всегда-живой (или scale-to-zero, но без HTTP-таймаута Vercel) сервис на
Cloud Run.

## 2. Структура проекта

```
/apps
  /web                    Next.js — UI + API routes
/services
  /browser-worker         Playwright worker (Cloud Run)
    /src/analyzers         GTM / external domains / tracking / fingerprint / pageAnalyzer
    /src/google             Google Search провайдеры
    /src/jobs/handlers       6 обработчиков job'ов
/packages
  /types                  Общие TypeScript-типы
  /shared                 SSRF, normalize URL, similarity, clustering
firestore.rules
.env.example
```

## 3. Схема данных (Firestore)

```
users/{userId}
  /projects/{projectId}
    /searches/{searchId}
      /results/{resultId}          ← SearchResultItem
    /websites/{websiteId}          ← Website
      /gtmContainers/{id}          ← GTMContainer
      /externalResources/{id}      ← ExternalResource
      /trackingIdentifiers/{id}    ← TrackingIdentifier
      /scripts/{id}                ← ScriptRecord
      /endpoints/{id}              ← EndpointRecord
      /fingerprint/current         ← WebsiteFingerprint (singleton-документ)
    /relationships/{id}            ← Relationship (source↔target, score, evidence)
    /clusters/{id}                 ← Cluster

jobs/{jobId}                       ← AnalysisJob (единственная top-level коллекция)
```

Почему `jobs` — не вложена под `users`: worker должен эффективно опрашивать
**все** `QUEUED` задачи всех пользователей одним запросом
(`collectionGroup` по глубоко вложенной коллекции для этого не подходит так
же хорошо, как плоская top-level коллекция с полем `userId`). Владение
проверяется явным полем `userId` + отдельным правилом в `firestore.rules`.

Почему `fingerprint` — не массив в документе `Website`, а отдельная
подколлекция из одного документа `current`: список уникальных скриптов и
внешних доменов у сайта с сотнями ресурсов может быть большим — вынесение в
отдельный документ ограничивает то, что читается при обычных операциях со
списком сайтов (где fingerprint не нужен).

## 4. Алгоритмы

### 4.1 Обнаружение GTM (`gtmDetector.ts`)

Пять независимых способов обнаружения (сайты внедряют GTM по-разному):
1. `<script src="...googletagmanager.com/gtm.js?id=GTM-XXXX">`
2. Сетевой запрос к `gtm.js`/`gtag/js` — ловит динамическую загрузку тега,
   даже если в исходном HTML тега нет.
3. `<noscript><iframe src=".../ns.html?id=GTM-XXXX">`
4. Инлайн-скрипт с классическим сниппетом (`dataLayer` + `GTM-XXXX`).
5. Fallback — любое упоминание `GTM-XXXX` в HTML, не пойманное выше
   (например, нестандартная обёртка).

Каждая находка хранит **способ обнаружения** — это не только диагностика,
но и сигнал уверенности (сетевой запрос надёжнее, чем текстовое совпадение).

### 4.2 Извлечение внешних доменов (`externalDomainExtractor.ts`)

Собирает домены из перехваченных Playwright сетевых запросов
(script/iframe/image/stylesheet/xhr/fetch) и DOM (`<script src>`),
исключает домен самого анализируемого сайта, классифицирует каждый домен
(`ANALYTICS`/`ADVERTISING`/`CDN`/`SOCIAL`/`UNKNOWN`) по справочнику
известных провайдеров (`knownProviders.ts`) — классификация используется
и в UI (иконки/группировка), и в скоринге (общий CDN весит намного меньше
общего уникального трекера).

### 4.3 Fingerprinting (`fingerprintEngine.ts`)

Технический отпечаток сайта = `{gtmIds, trackingIds, uniqueScriptHashes,
externalDomains, apiEndpoints}`, где:
- `uniqueScriptHashes` — sha256 содержимого скриптов **за вычетом**
  распознанных общих библиотек (jQuery, Bootstrap, gtag.js и т.п. —
  см. `COMMON_SCRIPT_FILENAME_PATTERNS`), иначе два случайных сайта на
  jQuery считались бы "похожими".
- `externalDomains` — за вычетом популярных CDN общего пользования.

Fingerprint пересчитывается при каждом анализе и хранится отдельно от
"сырых" находок — так similarity scoring работает с уже отфильтрованными
от шума признаками.

### 4.4 Similarity scoring (`similarity.ts`)

Попарное сравнение двух `WebsiteFingerprint`:

| Признак | Вес |
|---|---|
| Общий GTM ID | 40 |
| Общий tracking ID | 35 |
| Общий уникальный JS (по хэшу) | 25 |
| Общий API endpoint | 15 |
| Общий внешний домен (не CDN) | 6 за домен, максимум 24 суммарно |
| Общий CDN/популярная библиотека | 0 |

Итог капается на 100. Возвращается вместе со списком `evidence` — то, что
показывается в UI как «87/100: + Same GTM ID, + Same tracking ID, …»
(п.6 ТЗ). Веса — стартовая эвристика для MVP; если появится размеченный
датасет "точно связаны / точно не связаны", веса стоит подбирать через
логистическую регрессию по evidence-фичам, а не вручную.

### 4.5 Кластеризация (`clustering.ts`)

Connected components через **Union-Find** по графу `Relationship`, где
ребро учитывается только при `score >= minEdgeScore` (по умолчанию 50).
Каждый кластер — это одна компонента связности из ≥2 сайтов. Для каждого
кластера агрегируются общие GTM/домены/tracking ID/скрипты и средняя
confidence по внутренним рёбрам.

Выбор Union-Find, а не более сложной графовой кластеризации (Louvain и
т.п.), осознан для MVP: связи в этой предметной области либо явно сильные
(общий уникальный ID), либо их нет — "мягкой" модулярности с постепенными
переходами здесь меньше, чем в соцсетях. Если понадобится отделять
подкластеры внутри большой компоненты (например, у хостинг-провайдера,
который сам стал "общим доменом" для тысяч несвязанных сайтов) — следующий
шаг эволюции: взвешенная модулярность или удаление "хабовых" рёбер перед
кластеризацией.

### 4.6 Поиск похожих / расширение сети (п.4, п.8 ТЗ)

- **«Искать схожее»** (`FIND_SIMILAR`) — сравнивает fingerprint выбранных
  сайтов со всеми уже проанализированными сайтами **того же проекта** и
  сохраняет связи выше порога. O(выбранные × все) — приемлемо для MVP;
  при росте проекта до тысяч сайтов стоит перейти на inverted index
  `gtmId → websiteIds[]` / `trackingId → websiteIds[]`, чтобы сначала
  находить кандидатов, а score считать только для них.
- **«Расширить сеть»** (`EXPAND_NETWORK`) — берёт самые характерные
  идентификаторы (GTM ID, tracking ID) уже найденных сайтов и использует
  их как **поисковые запросы** (реальная OSINT-техника: искать по
  литеральной строке `"GTM-XXXXXXX"`), находит новых кандидатов, ставит их
  в очередь на анализ через новый `ANALYZE_BATCH` job. Глубина
  (`Depth: 1/2/3`) ограничивает, сколько раз это может повториться —
  в MVP каждый уровень запускается отдельным job'ом после завершения
  анализа предыдущего уровня (полностью автоматическая цепочка через
  Firestore-триггеры/Cloud Tasks — следующий шаг, см. §6).

### 4.7 Google Search — доступные варианты (честно, как просили в п.13 ТЗ)

**Важное обновление после реальной попытки настройки**: изначальный план (Google
Programmable Search Engine, "искать по всему интернету") оказался неприменим
для новых аккаунтов — Google перестал разрешать НОВЫМ Custom Search Engine
включать полный веб-поиск (официально: "you have the option to set your
custom search engine to search the entire web (no new creation supported)").
Новый engine может искать только по явно перечисленным доменам (до 50) —
это не годится для задачи "искать произвольные сайты по ключевым словам".

| Вариант | Статус | Плюсы | Ограничения |
|---|---|---|---|
| **Serper.dev** — используется как основной | ✅ Работает | Простая регистрация (только email), 2500 бесплатных запросов, дальше ~$0.30-1/1000, чистый JSON с реальной Google-выдачей | Сторонний посредник, а не официальный Google API; нет разделения Desktop/Mobile SERP |
| **Google Programmable Search (Custom Search JSON API)** | ⚠️ Только для старых аккаунтов | Официальный Google API, если у вас уже есть старый engine с включённым веб-поиском | Для новых engine — не работает вообще (см. выше) |
| **Управляемая браузерная автоматизация** (`BrowserAutomationSearchProvider`, stub) | Экспериментально, не реализовано | "Живая" SERP с device-специфичным рендерингом | Хрупкий, вопрос ToS, обязательная остановка при CAPTCHA без попыток обхода |

Реализация: `SerperSearchProvider` в `searchProvider.ts`, используется в
`searchGoogle.ts` и `expandNetwork.ts` через `process.env.SERPER_API_KEY`.
`GoogleProgrammableSearchProvider` оставлен в коде как легаси-опция.

## 5. Безопасность

### SSRF-защита (`packages/shared/src/ssrf.ts`)

`assertPublicUrl()` вызывается **до** любого `page.goto()`:
- запрещает нестандартные схемы (только `http`/`https`);
- запрещает URL с embedded credentials;
- резолвит **все** A/AAAA записи хоста и блокирует, если хотя бы один
  адрес попадает в приватные/зарезервированные диапазоны (RFC1918,
  loopback, link-local — включая `169.254.169.254`, cloud metadata),
  multicast, TEST-NET;
- повторно проверяется при финальном URL после редиректов (защита от
  DNS rebinding между первой проверкой и навигацией).

### Sandbox / лимиты worker'а

- Каждый анализируемый сайт получает собственный Playwright **browser
  context** (изоляция cookies/storage между сайтами одного job'а).
- Контейнер запускается от непривилегированного пользователя
  (см. `Dockerfile`), `--no-sandbox` у Chromium **не** используется.
- Лимиты (`FETCH_LIMITS` в `ssrf.ts`): timeout навигации, максимум
  редиректов, максимальный суммарный размер ответа, максимум ресурсов на
  страницу — все проверяются во время анализа (`pageAnalyzer.ts`).
- `robots.txt` уважается по умолчанию (`respectRobotsTxt: true`); если
  disallow — статус сайта становится `BLOCKED_BY_ROBOTS`, анализ не
  выполняется.
- Агент **не** пытается обходить CAPTCHA, авторизацию или другие
  контроли доступа — при таких препятствиях фиксируется соответствующий
  статус ошибки, а не производится попытка обхода.

### Firestore Security Rules (`firestore.rules`)

- Всё под `users/{userId}/...` — доступ только при `request.auth.uid ==
  userId` на каждом уровне вложенности.
- `jobs/{jobId}` (top-level) — чтение только владельцу по полю `userId`
  в документе; запись **запрещена клиенту полностью** — job'ы создаются
  только через API routes с Firebase Admin SDK (который обходит правила),
  что гарантирует применение rate limiting и валидации на сервере
  до создания задачи.

### Rate limiting (`apps/web/lib/rateLimit.ts`)

Ограничение на пользователя: одновременно активных job'ов и job'ов в час
(конфигурируется через `.env`). Реализовано через подсчёт документов в
Firestore — для MVP достаточно; при высокой нагрузке стоит вынести в
отдельный сервис (Redis/Upstash).

## 6. Известные ограничения и как их закрывать при росте

- **Race condition при claim job** — снижена через Firestore transaction
  при захвате (`jobRunner.ts`), но при десятках worker-инстансов
  одновременно лучше перейти на **Cloud Tasks** для диспетчеризации
  вместо polling.
- **`getRegistrableDomain()`** — упрощённая версия (без полного списка
  публичных суффиксов, т.е. `example.co.uk` даст `co.uk` вместо
  `example.co.uk`). Для production — библиотека `tldts` или `psl`.
- **`FIND_SIMILAR`** сравнивает O(N×M) пар — заменить на inverted index
  при росте числа сайтов в проекте (см. §4.6).
- **`EXPAND_NETWORK`** на глубину >1 требует ручного связывания job'ов
  между собой на стороне API — полная автоматизация через Firestore
  Trigger (Cloud Function, срабатывающая на `status: COMPLETED` у
  `ANALYZE_BATCH`, которая сама создаёт следующий `EXPAND_NETWORK`)
  — следующий шаг эволюции.
- **Geolocation для Google-запросов** эмулируется через параметры `gl`/`hl`
  API и `Accept-Language`/`locale` браузера — это не то же самое, что
  реальный IP из нужной страны; для точной гео-эмуляции нужны
  region-specific residential-прокси.
- **Cluster rebuild** — текущая реализация полностью пересобирает все
  кластеры проекта при каждом `BUILD_CLUSTER`. При большом числе сайтов
  стоит перейти на инкрементальное добавление одного сайта в существующий
  кластер вместо полного пересчёта.

## 7. Локальный запуск (кратко)

```bash
cp .env.example .env
npm install   # из корня — устанавливает все workspaces

# Сначала собрать общие пакеты (types/shared) — их компилируют в dist/,
# и web/worker резолвят их через node_modules, а не напрямую из .ts
npm run build:packages

# Web (Vercel dev)
npm run dev --workspace=apps/web

# Worker (локально, без Docker)
npm run dev --workspace=services/browser-worker

# Worker (как в Cloud Run)
docker build -f services/browser-worker/Dockerfile -t browser-worker .
docker run -p 8080:8080 --env-file .env browser-worker
```

Деплой Firestore-правил: `firebase deploy --only firestore:rules`.
