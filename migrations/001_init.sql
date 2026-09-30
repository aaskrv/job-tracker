-- Job tracker: initial schema

CREATE TABLE scrape_runs (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT        NOT NULL,              -- linkedin | indeed | manual | ...
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    query         JSONB,                             -- search params used by the collector
    file_name     TEXT,
    found         INT NOT NULL DEFAULT 0,
    inserted      INT NOT NULL DEFAULT 0,
    updated       INT NOT NULL DEFAULT 0,
    duplicates    INT NOT NULL DEFAULT 0,
    errors        INT NOT NULL DEFAULT 0,
    notes         TEXT
);

CREATE TABLE vacancies (
    id                  BIGSERIAL PRIMARY KEY,
    source              TEXT NOT NULL,
    external_id         TEXT NOT NULL,
    url                 TEXT,
    title               TEXT NOT NULL,
    company             TEXT,
    title_norm          TEXT,
    company_norm        TEXT,

    location_country    TEXT,                        -- ISO-2 where possible (DE, NL, AE ...)
    location_city       TEXT,
    remote_type         TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (remote_type IN ('remote','hybrid','onsite','unknown')),
    remote_region       TEXT,                        -- e.g. "EU only", "Worldwide", "EMEA"
    relocation          BOOLEAN,                     -- relocation package offered
    visa_sponsorship    BOOLEAN,
    open_to_kz          TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (open_to_kz IN ('yes','no','unknown')),

    salary_min          NUMERIC,
    salary_max          NUMERIC,
    salary_currency     TEXT,
    salary_period       TEXT CHECK (salary_period IN ('hour','month','year')),
    salary_type         TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (salary_type IN ('gross','net','unknown')),
    salary_net_usd_min  NUMERIC,                     -- normalized: USD per month, estimated net
    salary_net_usd_max  NUMERIC,
    salary_fit          TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (salary_fit IN ('yes','maybe','no','unknown')),

    seniority           TEXT,
    employment_type     TEXT,                        -- full-time, contract, ...
    stack               TEXT[] NOT NULL DEFAULT '{}',
    description         TEXT,

    match_score         INT CHECK (match_score BETWEEN 0 AND 100),
    match_reason        TEXT,

    status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','shortlisted','skipped','closed')),
    notes               TEXT,
    duplicate_of        BIGINT REFERENCES vacancies(id) ON DELETE SET NULL,

    posted_at           TIMESTAMPTZ,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_id         BIGINT REFERENCES scrape_runs(id) ON DELETE SET NULL,
    raw                 JSONB,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, external_id)
);

CREATE INDEX vacancies_norm_idx     ON vacancies (company_norm, title_norm);
CREATE INDEX vacancies_status_idx   ON vacancies (status);
CREATE INDEX vacancies_first_seen   ON vacancies (first_seen_at DESC);
CREATE INDEX vacancies_score_idx    ON vacancies (match_score DESC NULLS LAST);

CREATE TABLE applications (
    id          BIGSERIAL PRIMARY KEY,
    vacancy_id  BIGINT NOT NULL UNIQUE REFERENCES vacancies(id) ON DELETE CASCADE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    channel     TEXT,                                -- easy apply, company site, referral, email ...
    cv_version  TEXT,                                -- file name / label of the CV used
    contact     TEXT,                                -- recruiter name / email
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordered stages; "rank" drives the funnel, terminal outcomes have their own flag
CREATE TABLE event_types (
    code        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    rank        INT  NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO event_types (code, label, rank, is_terminal) VALUES
    ('applied',          'Отклик отправлен',       10, false),
    ('hr_response',      'Ответ HR / рекрутера',   20, false),
    ('screening',        'Скрининг',               30, false),
    ('test_task',        'Тестовое задание',       40, false),
    ('tech_interview',   'Тех. собеседование',     50, false),
    ('final_interview',  'Финальное интервью',     60, false),
    ('offer',            'Оффер',                  70, false),
    ('offer_accepted',   'Оффер принят',           80, true),
    ('offer_declined',   'Оффер отклонён мной',    80, true),
    ('rejected',         'Отказ',                  90, true),
    ('withdrawn',        'Отозвал отклик',         90, true);

CREATE TABLE application_events (
    id              BIGSERIAL PRIMARY KEY,
    application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type            TEXT   NOT NULL REFERENCES event_types(code),
    happened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX application_events_app_idx ON application_events (application_id, happened_at);

-- Current state of each application: last event, highest stage reached, terminal flag
CREATE VIEW application_state AS
SELECT
    a.id                                   AS application_id,
    a.vacancy_id,
    a.applied_at,
    last_ev.type                           AS last_event,
    last_ev.happened_at                    AS last_event_at,
    COALESCE(max_rank.rank, 10)            AS max_rank,
    COALESCE(term.is_terminal, false)      AS is_closed,
    first_resp.happened_at                 AS first_response_at
FROM applications a
LEFT JOIN LATERAL (
    SELECT e.type, e.happened_at FROM application_events e
    WHERE e.application_id = a.id
    ORDER BY e.happened_at DESC, e.id DESC LIMIT 1
) last_ev ON true
LEFT JOIN LATERAL (
    SELECT MAX(t.rank) AS rank FROM application_events e
    JOIN event_types t ON t.code = e.type
    WHERE e.application_id = a.id AND t.rank < 90   -- rejected/withdrawn do not advance the funnel
) max_rank ON true
LEFT JOIN LATERAL (
    SELECT bool_or(t.is_terminal) AS is_terminal FROM application_events e
    JOIN event_types t ON t.code = e.type
    WHERE e.application_id = a.id
) term ON true
LEFT JOIN LATERAL (
    SELECT MIN(e.happened_at) AS happened_at FROM application_events e
    WHERE e.application_id = a.id AND e.type <> 'applied'
) first_resp ON true;
