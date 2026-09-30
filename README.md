# Job Tracker

Локальная база вакансий и трекер откликов. Node.js + Express + EJS, PostgreSQL в Docker.

Вакансии собирает Claude через Chrome (LinkedIn, Indeed) и кладёт JSON-файлы в `data/inbox/`.
Приложение само ничего не скрапит: оно раз в минуту подхватывает файлы из inbox, импортирует их,
убирает дубли и считает статистику по откликам.

## Запуск

Нужны Node.js 20+ и Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 16 на localhost:5433
npm start            # миграции применяются автоматически, админка на http://localhost:3000
```

Для разработки: `npm run dev` (перезапуск при изменении файлов).

Проверить на тестовых данных (вымышленные компании с пометкой SAMPLE):

```bash
npm run import -- samples/sample-import.json
npm run import -- samples/sample-import-indeed.json   # первая вакансия станет дублем
```

Удалить всё и начать с чистой базы: `docker compose down -v && npm run db:up`.

## Страницы

| Путь | Что там |
|---|---|
| `/` | Дашборд: вакансии, воронка откликов, конверсии, разрезы по источнику, версии CV и месяцам |
| `/vacancies` | Список с фильтрами: источник, формат, страна, зарплата vs порог, открыто ли для KZ, есть ли отклик, score |
| `/vacancies/:id` | Карточка: описание, почему такой score, отклик и таймлайн этапов, ручные правки |
| `/applications` | Отклики: в процессе, без ответа дольше N дней, закрытые; быстрое добавление события |
| `/import` | Загрузка JSON вручную, содержимое inbox, история сборов |
| `/settings` | Флаг регулярного сбора и параметры (`collector.config.json`), пересчёт зарплат |

JSON API: `GET /api/stats`, `GET /api/collector-config`, `POST /import` (тело: payload ниже).

## Этапы отклика

`applied` → `hr_response` → `screening` → `test_task` → `tech_interview` → `final_interview` → `offer`,
плюс исходы `offer_accepted`, `offer_declined`, `rejected`, `withdrawn`.
Воронка считается по самому дальнему достигнутому этапу, так что отказ после тех. собеса
всё равно засчитывается как "дошёл до тех. собеса". "Без ответа" это открытый отклик,
по которому нет событий дольше `ghosted_after_days` (по умолчанию 21 день).

## Зарплата

Порог задаётся в `collector.config.json` (`salary.min_net_usd_month`).
Каждая вилка приводится к USD в месяц, а gross переводится в net по примерной доле для страны
(`net_ratio_by_country`). Если тип не указан, считается gross. Результат в поле `salary_fit`:

- `yes`: нижняя граница не ниже порога
- `maybe`: верхняя граница в пределах 10% от порога или выше
- `no`: ниже
- `unknown`: вилка не указана или валюта не знакома

Курсы и налоговые доли примерные, их стоит время от времени обновлять на странице настроек
и нажимать "Пересчитать зарплаты".

## Дубли

- Та же вакансия на той же площадке: upsert по `(source, external_id)`, обновляются данные и `last_seen_at`,
  а твои `status` и `notes` не трогаются.
- Та же вакансия на другой площадке: совпадение нормализованных компании и названия в пределах 60 дней,
  новая запись помечается `duplicate_of` и по умолчанию скрыта из списка.

## Формат файла для импорта

```json
{
  "run": {
    "source": "linkedin",
    "started_at": "2026-09-30T05:00:00Z",
    "finished_at": "2026-09-30T05:20:00Z",
    "query": { "keywords": "Senior Backend Engineer Kotlin", "location": "European Union", "remote": true },
    "notes": "optional"
  },
  "vacancies": [
    {
      "source": "linkedin",
      "external_id": "4012345678",
      "url": "https://www.linkedin.com/jobs/view/4012345678",
      "title": "Senior Backend Engineer (Kotlin)",
      "company": "Acme GmbH",
      "location_country": "DE",
      "location_city": "Berlin",
      "remote_type": "remote | hybrid | onsite | unknown",
      "remote_region": "EU only",
      "relocation": true,
      "visa_sponsorship": null,
      "open_to_kz": "yes | no | unknown",
      "salary": { "min": 80000, "max": 95000, "currency": "EUR", "period": "year | month | hour", "type": "gross | net | unknown" },
      "seniority": "Senior",
      "employment_type": "Full-time",
      "stack": ["Kotlin", "Spring Boot", "PostgreSQL"],
      "description": "full text of the posting",
      "posted_at": "2026-09-27",
      "match_score": 85,
      "match_reason": "why this score"
    }
  ]
}
```

Обязательны только `title` и `external_id` (или `url`). `source` берётся из `run.source`, если не указан у вакансии.
Страна: ISO-код (`DE`, `AE`) или название на английском. Для удалёнки без страны можно `EU`, `EMEA`, `WW`.

## Сбор вакансий

Как собирать и оценивать вакансии описано в [docs/COLLECTOR.md](docs/COLLECTOR.md).
Регулярный запуск пока выключен флагом `enabled` в `collector.config.json`.

## Структура

```
migrations/        SQL-миграции (применяются при старте и через npm run migrate)
src/server.js      Express-приложение и опрос inbox
src/importer.js    импорт payload, upsert, поиск дублей
src/normalize.js   нормализация названий, компаний, стран, зарплат
src/stats.js       запросы для дашборда
src/routes/        страницы
views/             EJS-шаблоны
data/inbox/        сюда сборщик кладёт файлы; после импорта они уезжают в data/imported или data/failed
```
