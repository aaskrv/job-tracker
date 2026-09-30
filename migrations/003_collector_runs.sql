-- Manual collector runs started from /settings, with the Claude usage reported by `claude -p --output-format json`
CREATE TABLE collector_runs (
    id                  BIGSERIAL PRIMARY KEY,
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    exit_code           INT,
    error               TEXT,                              -- NULL when the run succeeded
    input_tokens        BIGINT,
    output_tokens       BIGINT,
    cache_read_tokens   BIGINT,
    cache_write_tokens  BIGINT,
    cost_usd            NUMERIC(10,4),                     -- API list price, not what the subscription bills
    num_turns           INT,
    result              TEXT                               -- collector's final report
);
