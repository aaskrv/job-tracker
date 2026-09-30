import crypto from 'node:crypto';
import { query } from './db.js';
import { readCollectorConfig } from './config.js';
import {
  normCompany, normTitle, normCountry, normRemote, normTriState, normBool, normalizeSalary,
} from './normalize.js';

const DEDUP_WINDOW_DAYS = 60;

function externalIdFor(v) {
  if (v.external_id) return String(v.external_id);
  if (v.url) return 'url:' + crypto.createHash('sha1').update(v.url).digest('hex').slice(0, 16);
  return null;
}

function toTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be a JSON object');
  if (!Array.isArray(payload.vacancies)) throw new Error('payload.vacancies must be an array');
}

/**
 * Imports a collector payload: { run: {...}, vacancies: [...] }.
 * Upserts by (source, external_id); user-owned fields (status, notes) are never overwritten.
 */
export async function importPayload(payload, { fileName = null } = {}) {
  validatePayload(payload);
  const cfg = readCollectorConfig();
  const run = payload.run || {};
  const defaultSource = run.source || 'manual';

  const { rows: [runRow] } = await query(
    `INSERT INTO scrape_runs (source, started_at, finished_at, query, file_name, found, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [defaultSource, toTimestamp(run.started_at), toTimestamp(run.finished_at),
      run.query ? JSON.stringify(run.query) : null, fileName, payload.vacancies.length, run.notes || null],
  );
  const runId = runRow.id;
  const stats = { runId, found: payload.vacancies.length, inserted: 0, updated: 0, duplicates: 0, errors: 0, errorMessages: [] };

  for (const [i, v] of payload.vacancies.entries()) {
    try {
      const source = (v.source || defaultSource).toLowerCase();
      const externalId = externalIdFor(v);
      if (!externalId) throw new Error('external_id or url is required');
      if (!v.title) throw new Error('title is required');

      const country = normCountry(v.location_country);
      const s = normalizeSalary(v.salary, country, cfg);
      const score = Number.isFinite(Number(v.match_score)) ? Math.max(0, Math.min(100, Math.round(Number(v.match_score)))) : null;

      const { rows: [row] } = await query(
        `INSERT INTO vacancies (
            source, external_id, url, title, company, title_norm, company_norm,
            location_country, location_city, remote_type, remote_region, relocation, visa_sponsorship, open_to_kz,
            salary_min, salary_max, salary_currency, salary_period, salary_type,
            salary_net_usd_min, salary_net_usd_max, salary_fit,
            seniority, employment_type, stack, description, match_score, match_reason,
            posted_at, last_run_id, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         ON CONFLICT (source, external_id) DO UPDATE SET
            url = EXCLUDED.url, title = EXCLUDED.title, company = EXCLUDED.company,
            title_norm = EXCLUDED.title_norm, company_norm = EXCLUDED.company_norm,
            location_country = EXCLUDED.location_country, location_city = EXCLUDED.location_city,
            remote_type = EXCLUDED.remote_type, remote_region = EXCLUDED.remote_region,
            relocation = COALESCE(EXCLUDED.relocation, vacancies.relocation),
            visa_sponsorship = COALESCE(EXCLUDED.visa_sponsorship, vacancies.visa_sponsorship),
            open_to_kz = CASE WHEN EXCLUDED.open_to_kz = 'unknown' THEN vacancies.open_to_kz ELSE EXCLUDED.open_to_kz END,
            salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max,
            salary_currency = EXCLUDED.salary_currency, salary_period = EXCLUDED.salary_period,
            salary_type = EXCLUDED.salary_type, salary_net_usd_min = EXCLUDED.salary_net_usd_min,
            salary_net_usd_max = EXCLUDED.salary_net_usd_max, salary_fit = EXCLUDED.salary_fit,
            seniority = EXCLUDED.seniority, employment_type = EXCLUDED.employment_type,
            stack = EXCLUDED.stack, description = COALESCE(EXCLUDED.description, vacancies.description),
            match_score = COALESCE(EXCLUDED.match_score, vacancies.match_score),
            match_reason = COALESCE(EXCLUDED.match_reason, vacancies.match_reason),
            posted_at = COALESCE(EXCLUDED.posted_at, vacancies.posted_at),
            last_seen_at = now(), last_run_id = EXCLUDED.last_run_id, raw = EXCLUDED.raw, updated_at = now()
         RETURNING id, (xmax = 0) AS inserted, duplicate_of, company_norm, title_norm`,
        [source, externalId, v.url || null, v.title, v.company || null, normTitle(v.title), normCompany(v.company),
          country, v.location_city || null, normRemote(v.remote_type), v.remote_region || null,
          normBool(v.relocation), normBool(v.visa_sponsorship), normTriState(v.open_to_kz),
          s.min, s.max, s.currency, s.min == null && s.max == null ? null : s.period, s.type,
          s.netMin, s.netMax, s.fit,
          v.seniority || null, v.employment_type || null,
          Array.isArray(v.stack) ? v.stack.map(String) : [], v.description || null, score, v.match_reason || null,
          toTimestamp(v.posted_at), runId, JSON.stringify(v)],
      );

      if (row.inserted) stats.inserted++; else stats.updated++;

      // Cross-source duplicate: same normalized company + title seen recently under another source
      if (row.inserted && row.duplicate_of == null && row.company_norm && row.title_norm) {
        const { rows: dup } = await query(
          `SELECT id FROM vacancies
           WHERE id <> $1 AND duplicate_of IS NULL AND source <> $2
             AND company_norm = $3 AND title_norm = $4
             AND first_seen_at > now() - ($5 || ' days')::interval
           ORDER BY id LIMIT 1`,
          [row.id, source, row.company_norm, row.title_norm, DEDUP_WINDOW_DAYS],
        );
        if (dup.length) {
          await query('UPDATE vacancies SET duplicate_of = $1 WHERE id = $2', [dup[0].id, row.id]);
          stats.duplicates++;
        }
      }
    } catch (e) {
      stats.errors++;
      stats.errorMessages.push(`#${i} ${v?.title || ''}: ${e.message}`);
    }
  }

  const notes = [run.notes, ...stats.errorMessages.slice(0, 20)].filter(Boolean).join('\n') || null;
  await query(
    'UPDATE scrape_runs SET inserted=$2, updated=$3, duplicates=$4, errors=$5, notes=$6 WHERE id=$1',
    [runId, stats.inserted, stats.updated, stats.duplicates, stats.errors, notes],
  );
  return stats;
}
