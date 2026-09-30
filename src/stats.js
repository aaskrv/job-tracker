import { query } from './db.js';
import { readCollectorConfig } from './config.js';

const FUNNEL_SQL = (groupExpr) => `
  SELECT ${groupExpr} AS key,
         COUNT(*)                                             AS applied,
         COUNT(*) FILTER (WHERE s.first_response_at IS NOT NULL) AS responded,
         COUNT(*) FILTER (WHERE s.max_rank >= 30)             AS screening,
         COUNT(*) FILTER (WHERE s.max_rank >= 50)             AS tech,
         COUNT(*) FILTER (WHERE s.max_rank >= 70)             AS offer,
         COUNT(*) FILTER (WHERE s.last_event = 'rejected')    AS rejected,
         COUNT(*) FILTER (WHERE NOT s.is_closed
                            AND COALESCE(s.last_event_at, s.applied_at) < now() - ($1 || ' days')::interval) AS ghosted,
         ROUND(AVG(EXTRACT(EPOCH FROM (s.first_response_at - s.applied_at)) / 86400)::numeric, 1) AS avg_days_to_response
  FROM application_state s
  JOIN applications a ON a.id = s.application_id
  JOIN vacancies v    ON v.id = s.vacancy_id`;

export async function dashboardStats() {
  const cfg = readCollectorConfig();
  const ghostDays = cfg.ghosted_after_days;

  const [totals, bySource, byFit, byRemote, byCountry, funnel, funnelBySource, funnelByCv, byMonth, runs] = await Promise.all([
    query(`SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE first_seen_at > now() - interval '7 days') AS new_7d,
                  COUNT(*) FILTER (WHERE status = 'new')         AS status_new,
                  COUNT(*) FILTER (WHERE status = 'shortlisted') AS shortlisted,
                  COUNT(*) FILTER (WHERE match_score >= 70)      AS strong_match
           FROM vacancies WHERE duplicate_of IS NULL`),
    query(`SELECT source AS key, COUNT(*) AS n FROM vacancies WHERE duplicate_of IS NULL GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT salary_fit AS key, COUNT(*) AS n FROM vacancies WHERE duplicate_of IS NULL GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT remote_type AS key, COUNT(*) AS n FROM vacancies WHERE duplicate_of IS NULL GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT COALESCE(location_country, '?') AS key, COUNT(*) AS n FROM vacancies
           WHERE duplicate_of IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query(FUNNEL_SQL(`'all'`) + ' GROUP BY 1', [ghostDays]),
    query(FUNNEL_SQL('v.source') + ' GROUP BY 1 ORDER BY 2 DESC', [ghostDays]),
    query(FUNNEL_SQL(`COALESCE(a.cv_version, '(не указана)')`) + ' GROUP BY 1 ORDER BY 2 DESC', [ghostDays]),
    query(`SELECT to_char(date_trunc('month', s.applied_at), 'YYYY-MM') AS key,
                  COUNT(*) AS applied,
                  COUNT(*) FILTER (WHERE s.first_response_at IS NOT NULL) AS responded,
                  COUNT(*) FILTER (WHERE s.max_rank >= 50) AS tech,
                  COUNT(*) FILTER (WHERE s.max_rank >= 70) AS offer
           FROM application_state s GROUP BY 1 ORDER BY 1`),
    query(`SELECT * FROM scrape_runs ORDER BY imported_at DESC LIMIT 5`),
  ]);

  const f = funnel.rows[0] || { applied: 0, responded: 0, screening: 0, tech: 0, offer: 0, rejected: 0, ghosted: 0, avg_days_to_response: null };
  return {
    ghostDays,
    totals: totals.rows[0],
    bySource: bySource.rows,
    byFit: byFit.rows,
    byRemote: byRemote.rows,
    byCountry: byCountry.rows,
    funnel: f,
    funnelBySource: funnelBySource.rows,
    funnelByCv: funnelByCv.rows,
    byMonth: byMonth.rows,
    runs: runs.rows,
  };
}

export const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-');
